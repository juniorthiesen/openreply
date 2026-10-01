"use client";

/* eslint-disable @next/next/no-img-element -- Account and uploaded-media URLs are served by the application. */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  apiRequest,
  localDayKey,
  timezone,
  type InstagramAccountOption,
  type InstagramMediaItem,
  type InstagramProfile,
  type MediaAsset,
  type ScheduledPost,
} from "@/components/scheduling/shared";
import { buildScheduleSlots, normalizeFilename, parseCaptionCsv, type BulkCadence } from "@/components/scheduling/bulk-utils";
import { CHUNK_SIZE, prepareUploadFile, validateReelFile } from "@/components/scheduling/upload-utils";
import {
  validateTrialReelAssets,
  type TrialReelGraduationStrategy,
} from "@/lib/scheduling/trial-reels";

type BulkDraft = {
  id: string;
  mediaAssets: MediaAsset[];
  caption: string;
  scheduledAt: string;
  shareToFeed: boolean;
  trialGraduationStrategy: TrialReelGraduationStrategy | null;
};

type UploadedFile = { asset: MediaAsset; relativePath: string; fromFolder: boolean };
type UploadProgress = { current: number; total: number; fileName: string; percent: number };
type BulkMode = "DRAFT" | "SCHEDULE";

const CADENCES: Array<{ id: BulkCadence; label: string; days: number[] }> = [
  { id: "daily", label: "Todo dia", days: [0, 1, 2, 3, 4, 5, 6] },
  { id: "mon-wed-fri", label: "Seg · Qua · Sex", days: [1, 3, 5] },
  { id: "tue-thu-sat", label: "Ter · Qui · Sáb", days: [2, 4, 6] },
  { id: "weekdays", label: "Dias úteis", days: [1, 2, 3, 4, 5] },
];

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function getTomorrow() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return localDayKey(tomorrow);
}

function getFolderKey(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
}

function filenameStem(filename: string) {
  return normalizeFilename(filename).replace(/\.[^.]+$/, "");
}

function imageFor(asset: MediaAsset) {
  return asset.publicUrl ?? null;
}

export default function BulkSchedule() {
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<InstagramAccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [previewState, setPreviewState] = useState<{ accountId: string; profile: InstagramProfile | null; instagramPosts: InstagramMediaItem[]; scheduledPosts: ScheduledPost[] } | null>(null);
  const [drafts, setDrafts] = useState<BulkDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [cadence, setCadence] = useState<BulkCadence>("daily");
  const [startDate, setStartDate] = useState(getTomorrow);
  const [time, setTime] = useState("12:00");
  const [skipWeekends, setSkipWeekends] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const account = accounts.find((item) => item.id === accountId) ?? null;
  const accountPreview = previewState?.accountId === accountId ? previewState : null;
  const profile = accountPreview?.profile ?? null;
  const missingCaptions = drafts.filter((draft) => !draft.caption.trim()).length;
  const totalMedia = drafts.reduce((total, draft) => total + draft.mediaAssets.length, 0);

  useEffect(() => {
    const input = folderInputRef.current;
    input?.setAttribute("webkitdirectory", "");
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<{ instagramAccounts: InstagramAccountOption[]; selectedInstagramAccountId: string | null }>("/api/instagram/accounts")
      .then((result) => {
        if (!active) return;
        setAccounts(result.instagramAccounts);
        setAccountId(result.selectedInstagramAccountId ?? "");
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Não foi possível carregar as contas do Instagram.");
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    Promise.allSettled([
      apiRequest<InstagramProfile>(`/api/instagram/profile?instagramAccountId=${encodeURIComponent(accountId)}`),
      apiRequest<InstagramMediaItem[]>(`/api/instagram/posts?instagramAccountId=${encodeURIComponent(accountId)}&all=true`),
      apiRequest<ScheduledPost[]>(`/api/scheduled-posts?instagramAccountId=${encodeURIComponent(accountId)}`),
    ]).then(([profileResult, feedResult, scheduleResult]) => {
      if (!active) return;
      setPreviewState({
        accountId,
        profile: profileResult.status === "fulfilled" ? profileResult.value : null,
        instagramPosts: feedResult.status === "fulfilled" ? feedResult.value : [],
        scheduledPosts: scheduleResult.status === "fulfilled" ? scheduleResult.value : [],
      });
    });
    return () => { active = false; };
  }, [accountId]);

  const uploadOne = useCallback(async (original: File, index: number, total: number): Promise<UploadedFile> => {
    const prepared = await prepareUploadFile(original);
    const isImage = prepared.type === "image/jpeg";
    const limit = isImage ? 8 * 1024 * 1024 : 1024 * 1024 * 1024;
    if (prepared.size > limit) throw new Error(isImage ? "A imagem precisa ter até 8 MB depois da conversão." : "O vídeo precisa ter até 1 GB.");
    if (!isImage) await validateReelFile(prepared);

    const asset = await apiRequest<MediaAsset>("/api/media-assets", {
      method: "POST",
      body: JSON.stringify({ instagramAccountId: accountId, fileName: prepared.name, contentType: prepared.type, byteSize: prepared.size }),
    });
    try {
      let offset = 0;
      while (offset < prepared.size) {
        const chunk = prepared.slice(offset, Math.min(offset + CHUNK_SIZE, prepared.size));
        const response = await fetch(`/api/media-assets/${encodeURIComponent(asset.id)}/upload`, {
          method: "PUT",
          headers: { "Upload-Offset": String(offset), "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        const result = await response.json().catch(() => null) as { success?: boolean; data?: { uploadedBytes: number }; error?: string } | null;
        if (!response.ok || !result?.success || !result.data) throw new Error(result?.error || "A conexão caiu durante o envio.");
        offset = result.data.uploadedBytes;
        setUploadProgress({ current: index + 1, total, fileName: original.name, percent: Math.round((offset / prepared.size) * 100) });
      }
      await apiRequest(`/api/media-assets/${encodeURIComponent(asset.id)}/complete`, { method: "POST" });
      const complete = await apiRequest<MediaAsset>(`/api/media-assets/${encodeURIComponent(asset.id)}`);
      return { asset: complete, relativePath: original.webkitRelativePath || original.name, fromFolder: Boolean(original.webkitRelativePath) };
    } catch (reason) {
      await apiRequest(`/api/media-assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" }).catch(() => undefined);
      throw reason;
    }
  }, [accountId]);

  function makeDraft(mediaAssets: MediaAsset[]): BulkDraft {
    return { id: makeId(), mediaAssets, caption: "", scheduledAt: "", shareToFeed: true, trialGraduationStrategy: null };
  }

  function makeDraftsFromUploads(uploads: UploadedFile[]): BulkDraft[] {
    const folderGroups = new Map<string, UploadedFile[]>();
    const singles: UploadedFile[] = [];
    for (const upload of uploads) {
      const folder = upload.fromFolder ? getFolderKey(upload.relativePath) : "";
      if (!folder) singles.push(upload);
      else folderGroups.set(folder, [...(folderGroups.get(folder) ?? []), upload]);
    }

    const result = singles.map(({ asset }) => makeDraft([asset]));
    for (const group of folderGroups.values()) {
      const ordered = group.slice().sort((a, b) => a.relativePath.localeCompare(b.relativePath, "pt-BR", { numeric: true }));
      if (ordered.length <= 10) result.push(makeDraft(ordered.map(({ asset }) => asset)));
      else {
        for (let index = 0; index < ordered.length; index += 10) {
          result.push(makeDraft(ordered.slice(index, index + 10).map(({ asset }) => asset)));
        }
      }
    }
    return result;
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>, fromFolder: boolean) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    if (!accountId) { setError("Escolha uma conta do Instagram antes de enviar as mídias."); return; }
    if (drafts.length + files.length > 60) { setError("O limite é de 60 publicações por lote."); return; }

    setBusy(true);
    setError("");
    setNotice("");
    const uploaded: UploadedFile[] = [];
    const failures: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setUploadProgress({ current: index + 1, total: files.length, fileName: file.name, percent: 0 });
      try {
        uploaded.push(await uploadOne(file, index, files.length));
      } catch (reason) {
        failures.push(`${file.name}: ${reason instanceof Error ? reason.message : "falha no envio"}`);
      }
    }
    if (uploaded.length) {
      const newDrafts = makeDraftsFromUploads(uploaded);
      setDrafts((current) => distributeDrafts([...current, ...newDrafts]));
      setNotice(`${uploaded.length} ${uploaded.length === 1 ? "mídia enviada" : "mídias enviadas"}. ${fromFolder ? "Arquivos da mesma pasta foram agrupados em carrosséis." : "Cada arquivo virou uma publicação; você pode agrupar imagens em carrosséis."}`);
    }
    if (failures.length) setError(`${failures.length} arquivo(s) não foram enviados. ${failures.slice(0, 3).join(" · ")}`);
    setUploadProgress(null);
    setBusy(false);
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const captions = parseCaptionCsv(await file.text());
      if (captions.size === 0) throw new Error("O CSV precisa ter as colunas arquivo e legenda, com pelo menos uma legenda preenchida.");
      const captionsByStem = new Map<string, string>();
      for (const [filename, caption] of captions) captionsByStem.set(filenameStem(filename), caption);
      const nextDrafts = drafts.map((draft) => {
        const caption = draft.mediaAssets.map((asset) => captions.get(normalizeFilename(asset.fileName)) ?? captionsByStem.get(filenameStem(asset.fileName))).find(Boolean);
        if (!caption) return draft;
        return { ...draft, caption };
      });
      const matches = nextDrafts.filter((draft, index) => draft.caption !== drafts[index].caption).length;
      if (matches === 0) throw new Error("Não encontrei nomes de arquivo do CSV entre os posts carregados.");
      setDrafts(nextDrafts);
      setError("");
      setNotice(`Legendas importadas para ${matches} ${matches === 1 ? "publicação" : "publicações"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível ler o CSV.");
    }
  }

  function downloadCsvTemplate() {
    const content = "arquivo,legenda\r\nfoto-01.jpg,Escreva a legenda desta publicação\r\n";
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "legendas-fisga.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function distributeDrafts(next: BulkDraft[]) {
    const dates = buildScheduleSlots(next.length, startDate, time, cadence, skipWeekends);
    return next.map((draft, index) => ({ ...draft, scheduledAt: dates[index] ?? draft.scheduledAt }));
  }

  function updateDistribution(update: { cadence?: BulkCadence; startDate?: string; time?: string; skipWeekends?: boolean }) {
    const nextCadence = update.cadence ?? cadence;
    const nextStartDate = update.startDate ?? startDate;
    const nextTime = update.time ?? time;
    const nextSkipWeekends = update.skipWeekends ?? skipWeekends;
    if (update.cadence !== undefined) setCadence(nextCadence);
    if (update.startDate !== undefined) setStartDate(nextStartDate);
    if (update.time !== undefined) setTime(nextTime);
    if (update.skipWeekends !== undefined) setSkipWeekends(nextSkipWeekends);
    const dates = buildScheduleSlots(drafts.length, nextStartDate, nextTime, nextCadence, nextSkipWeekends);
    setDrafts((current) => current.map((draft, index) => ({ ...draft, scheduledAt: dates[index] ?? draft.scheduledAt })));
  }

  function moveDraft(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= drafts.length) return;
    setDrafts((current) => {
      const next = current.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return distributeDrafts(next);
    });
  }

  function moveCarouselAsset(draft: BulkDraft, index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= draft.mediaAssets.length) return;
    const mediaAssets = draft.mediaAssets.slice();
    [mediaAssets[index], mediaAssets[target]] = [mediaAssets[target], mediaAssets[index]];
    updateDraft(draft.id, { mediaAssets });
  }

  function interleaveFormats() {
    const queues = new Map<string, BulkDraft[]>();
    for (const draft of drafts) {
      const kind = draft.mediaAssets.length > 1 ? "carousel" : draft.mediaAssets[0].contentType.startsWith("video/") ? "reel" : "image";
      queues.set(kind, [...(queues.get(kind) ?? []), draft]);
    }
    const next: BulkDraft[] = [];
    let lastKind = "";
    while ([...queues.values()].some((queue) => queue.length > 0)) {
      const available = [...queues.entries()].filter(([, queue]) => queue.length > 0);
      const [kind, queue] = available.find(([candidate]) => candidate !== lastKind) ?? available[0];
      next.push(queue.shift()!);
      lastKind = kind;
    }
    setDrafts(distributeDrafts(next));
    setNotice("Formatos alternados. Confira a sequência e os horários antes de agendar.");
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function groupSelected() {
    const selected = drafts.filter((draft) => selectedIds.includes(draft.id));
    const selectedMedia = selected.flatMap((draft) => draft.mediaAssets);
    if (selectedMedia.length < 2 || selectedMedia.length > 10) {
      setError("Selecione publicações com 2 a 10 mídias no total para formar um carrossel.");
      return;
    }
    const firstIndex = drafts.findIndex((draft) => selectedIds.includes(draft.id));
    const combined = makeDraft(selectedMedia);
    combined.caption = selected.find((draft) => draft.caption.trim())?.caption ?? "";
    combined.scheduledAt = selected[0]?.scheduledAt ?? "";
    setDrafts((current) => {
      const remaining = current.filter((draft) => !selectedIds.includes(draft.id));
      return distributeDrafts([...remaining.slice(0, firstIndex), combined, ...remaining.slice(firstIndex)]);
    });
    setSelectedIds([]);
    setError("");
    setNotice("Carrossel montado. Confira a sequência das mídias antes de agendar.");
  }

  function removeDraft(id: string) {
    setDrafts((current) => distributeDrafts(current.filter((draft) => draft.id !== id)));
    setSelectedIds((current) => current.filter((item) => item !== id));
  }

  function splitCarousel(draft: BulkDraft) {
    if (drafts.length - 1 + draft.mediaAssets.length > 60) {
      setError("Separar este carrossel ultrapassaria o limite de 60 publicações por lote.");
      return;
    }
    const index = drafts.findIndex((item) => item.id === draft.id);
    const split = draft.mediaAssets.map((asset) => ({ ...makeDraft([asset]), caption: draft.caption, shareToFeed: draft.shareToFeed }));
    const next = drafts.slice();
    next.splice(index, 1, ...split);
    setDrafts(distributeDrafts(next));
  }

  function updateDraft(id: string, update: Partial<BulkDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...update } : draft));
  }

  async function save(mode: BulkMode) {
    if (drafts.length === 0) { setError("Adicione ao menos uma mídia para continuar."); return; }
    if (!accountId) { setError("Escolha uma conta do Instagram."); return; }
    if (mode === "SCHEDULE" && !account?.publishingPermissionGranted) {
      setError("Reconecte a conta e aprove a permissão de publicar conteúdo antes de agendar.");
      return;
    }
    if (mode === "SCHEDULE" && drafts.some((draft) => !draft.scheduledAt || new Date(draft.scheduledAt).getTime() < Date.now() + 30_000)) {
      setError("Confira as datas: todas precisam estar pelo menos 30 segundos no futuro.");
      return;
    }
    const invalidTrial = drafts.find((draft) =>
      validateTrialReelAssets(draft.mediaAssets, draft.trialGraduationStrategy)
    );
    if (invalidTrial) {
      setError(validateTrialReelAssets(invalidTrial.mediaAssets, invalidTrial.trialGraduationStrategy)!);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ count: number; ids: string[]; queueSyncPending: boolean }>("/api/scheduled-posts/bulk", {
        method: "POST",
        body: JSON.stringify({
          instagramAccountId: accountId,
          mode,
          timeZone: timezone(),
          posts: drafts.map((draft) => ({
            mediaAssetIds: draft.mediaAssets.map((asset) => asset.id),
            caption: draft.caption,
            ...(mode === "SCHEDULE" ? { scheduledAt: new Date(draft.scheduledAt).toISOString() } : {}),
            shareToFeed: draft.trialGraduationStrategy ? false : draft.shareToFeed,
            trialGraduationStrategy: draft.trialGraduationStrategy,
          })),
        }),
      });
      setDrafts([]);
      setSelectedIds([]);
      setNotice(mode === "DRAFT"
        ? `${result.count} ${result.count === 1 ? "rascunho salvo" : "rascunhos salvos"}. Eles já aparecem na agenda.`
        : `${result.count} ${result.count === 1 ? "publicação agendada" : "publicações agendadas"}. A fila foi atualizada.`);
      if (result.queueSyncPending) setNotice((current) => `${current} A fila está sincronizando e será reconciliada automaticamente.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o lote.");
    } finally {
      setBusy(false);
    }
  }

  const instagramIds = new Set((accountPreview?.instagramPosts ?? []).map((post) => post.id));
  const existingTiles = [
    ...(accountPreview?.scheduledPosts ?? [])
      .filter((post) => ["SCHEDULED", "PUBLISHED", "PUBLISHING"].includes(post.status))
      .filter((post) => post.shareToFeed || post.mediaType !== "REEL")
      .filter((post) => !post.instagramMediaId || !instagramIds.has(post.instagramMediaId))
      .map((post) => ({ id: `scheduled-${post.id}`, url: post.mediaUrl ?? null, kind: post.mediaType === "CAROUSEL" ? "CARROSSEL" : "AGENDADO", video: post.mediaType === "REEL" })),
    ...(accountPreview?.instagramPosts ?? []).map((post) => ({
      id: `instagram-${post.id}`,
      url: post.media_type === "VIDEO" ? post.thumbnail_url ?? post.media_url ?? null : post.media_url ?? null,
      kind: post.media_type === "CAROUSEL_ALBUM" ? "CARROSSEL" : "PUBLICADO",
      video: false,
    })),
  ];
  const previewTiles = [
    ...drafts.map((draft, index) => ({ id: `draft-${draft.id}`, url: imageFor(draft.mediaAssets[0]), kind: draft.trialGraduationStrategy ? "REEL DE TESTE" : draft.mediaAssets.length > 1 ? "CARROSSEL" : "PRÓXIMO", video: draft.mediaAssets[0].contentType.startsWith("video/"), index })),
    ...existingTiles.map((tile) => ({ ...tile, index: null as number | null })),
  ].slice(0, 6);
  const canInterleave = new Set(drafts.map((draft) => draft.mediaAssets.length > 1 ? "carousel" : draft.mediaAssets[0].contentType.startsWith("video/") ? "reel" : "image")).size > 1;

  if (loading) return <div className="panel animate-pulse p-8"><div className="h-6 w-56 rounded bg-background" /><div className="mt-4 h-24 rounded-xl bg-background" /></div>;
  if (accounts.length === 0) return <section className="panel mx-auto max-w-3xl px-6 py-12 text-center sm:px-10"><h1 className="font-display text-2xl font-semibold tracking-tight">Envie posts em massa</h1><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Conecte uma conta profissional do Instagram para organizar e agendar publicações em lote.</p><a href="/api/instagram/connect" className="mt-6 inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-white">Conectar Instagram</a></section>;

  return <div className="space-y-6 pb-24">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Publicações</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-foreground">Subir posts em massa</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Envie vários arquivos, distribua as datas e revise cada legenda antes de agendar.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={accountId} disabled={busy} onChange={(event) => { setAccountId(event.target.value); setDrafts([]); setSelectedIds([]); setError(""); setNotice(""); }} aria-label="Conta do Instagram" className="h-10 min-w-40 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-foreground disabled:opacity-60">
          {accounts.map((item) => <option key={item.id} value={item.id}>@{item.username}</option>)}
        </select>
        <Link href="/schedule" className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-hover">Abrir agenda</Link>
      </div>
    </header>

    <div className="panel flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6" aria-label="Etapas do envio">
      <Step number="01" label="Enviar" active={true} />
      <span className="h-px min-w-4 flex-1 bg-border" />
      <Step number="02" label="Organizar" active={drafts.length > 0} />
      <span className="h-px min-w-4 flex-1 bg-border" />
      <Step number="03" label="Revisar e agendar" active={drafts.length > 0} />
    </div>

    {error && <div role="alert" className="rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">{notice}</div>}
    {!account?.publishingPermissionGranted && <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-sm leading-6 text-warning">Esta conta ainda não autorizou a publicação de conteúdo. Você pode salvar rascunhos, mas precisa reconectar a conta para agendar posts.</div>}

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_350px]">
      <main className="space-y-5">
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-xs font-medium text-muted">01 · Mídia</p><h2 className="mt-1 font-display text-[22px] font-bold tracking-[-0.015em]">Envie os arquivos</h2><p className="mt-1 max-w-xl text-xs leading-5 text-muted">Selecione vários arquivos de uma vez ou uma pasta. Arquivos da mesma pasta viram um carrossel, na ordem alfabética.</p></div>
            <span className="rounded-lg bg-sidebar px-2.5 py-1 text-xs font-medium text-muted">Até 60 posts · 10 mídias por carrossel</span>
          </div>
          <input ref={filesInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple className="sr-only" onChange={(event) => void handleFiles(event, false)} />
          <input ref={folderInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple className="sr-only" onChange={(event) => void handleFiles(event, true)} />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={busy} onClick={() => filesInputRef.current?.click()} className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border-hover bg-background p-5 text-center transition-colors hover:border-accent/50 hover:bg-accent/[0.025] disabled:opacity-60">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent"><UploadIcon /></span><span className="mt-3 text-sm font-semibold">Selecionar arquivos</span><span className="mt-1 text-xs text-muted">Cada mídia começa como uma publicação</span>
            </button>
            <button type="button" disabled={busy} onClick={() => folderInputRef.current?.click()} className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border-hover bg-background p-5 text-center transition-colors hover:border-accent/50 hover:bg-accent/[0.025] disabled:opacity-60">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent"><FolderIcon /></span><span className="mt-3 text-sm font-semibold">Selecionar pasta</span><span className="mt-1 text-xs text-muted">Arquivos na mesma pasta formam carrosséis</span>
            </button>
          </div>
          {uploadProgress && <div className="mt-4 rounded-xl bg-background px-4 py-3" aria-live="polite"><div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold">Enviando {uploadProgress.current} de {uploadProgress.total}: {uploadProgress.fileName}</span><span className="tabular-nums text-muted">{uploadProgress.percent}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${uploadProgress.percent}%` }} /></div></div>}
          <p className="mt-3 text-[11px] leading-5 text-muted">JPG até 8 MB · PNG/WebP convertidos para JPEG · MP4/MOV até 1 GB. Os arquivos enviados também ficam na biblioteca de mídia.</p>
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted">02 · Calendário</p><h2 className="mt-1 font-display text-[22px] font-bold tracking-[-0.015em]">Distribua as publicações</h2></div><span className="rounded-lg bg-sidebar px-2.5 py-1 text-xs font-medium text-muted">Fuso: {timezone()}</span></div>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Frequência das publicações">
            {CADENCES.map((item) => <button key={item.id} type="button" aria-pressed={cadence === item.id} onClick={() => updateDistribution({ cadence: item.id })} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${cadence === item.id ? "bg-accent text-white" : "border border-border bg-surface text-foreground hover:bg-surface-hover"}`}>{item.label}</button>)}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted">Começar em</span><input type="date" value={startDate} onChange={(event) => updateDistribution({ startDate: event.target.value })} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted">Horário padrão</span><input type="time" value={time} onChange={(event) => updateDistribution({ time: event.target.value })} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-background px-3 py-2.5 text-xs font-medium"><input type="checkbox" checked={skipWeekends} onChange={(event) => updateDistribution({ skipWeekends: event.target.checked })} className="accent-accent" /> Pular fins de semana</label>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted">As datas calculadas são sugestões. Você pode alterar o dia e o horário de cada publicação na lista abaixo.</p>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
            <div><p className="text-xs font-medium text-muted">03 · Revisão</p><h2 className="mt-1 text-base font-semibold">Posts deste lote <span className="ml-1 text-sm font-medium text-muted">{drafts.length}/60</span></h2></div>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void importCsv(event)} />
              <button type="button" onClick={() => csvInputRef.current?.click()} disabled={busy || drafts.length === 0} className="h-9 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground hover:bg-surface-hover disabled:opacity-50">Importar legendas CSV</button>
              <button type="button" onClick={downloadCsvTemplate} className="h-9 rounded-lg px-3 text-xs font-semibold text-accent hover:bg-accent/5">Baixar modelo</button>
            </div>
          </div>
          {selectedIds.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-accent/5 px-5 py-3 sm:px-6"><p className="text-xs font-medium">{selectedIds.length} publicação(ões) selecionada(s)</p><button type="button" onClick={groupSelected} className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover">Agrupar em carrossel</button></div>}

          {drafts.length === 0 ? <div className="px-5 py-12 text-center sm:px-6"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-sidebar text-muted"><GridIcon /></div><p className="mt-4 text-sm font-semibold">Os posts enviados aparecem aqui</p><p className="mt-1 text-xs text-muted">Você pode reorganizar, editar legendas e ajustar cada horário.</p></div> : <ol className="divide-y divide-border">
            {drafts.map((draft, index) => {
              const carousel = draft.mediaAssets.length > 1;
              const lead = draft.mediaAssets[0];
              return <li key={draft.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[28px_68px_minmax(0,1fr)] sm:items-start sm:px-5">
                <div className="flex items-center justify-between gap-2 sm:block"><label className="flex items-center gap-2 text-[11px] font-semibold tabular-nums text-muted sm:flex-col sm:gap-1"><input type="checkbox" checked={selectedIds.includes(draft.id)} onChange={() => toggleSelected(draft.id)} aria-label={`Selecionar publicação ${index + 1}`} className="accent-accent" />{String(index + 1).padStart(2, "0")}</label><div className="flex gap-1 sm:mt-2 sm:flex-col"><button type="button" disabled={index === 0 || busy} onClick={() => moveDraft(index, -1)} aria-label={`Mover publicação ${index + 1} para cima`} className="grid h-7 w-7 place-items-center rounded-md border border-border text-xs hover:bg-background disabled:opacity-30">↑</button><button type="button" disabled={index === drafts.length - 1 || busy} onClick={() => moveDraft(index, 1)} aria-label={`Mover publicação ${index + 1} para baixo`} className="grid h-7 w-7 place-items-center rounded-md border border-border text-xs hover:bg-background disabled:opacity-30">↓</button></div></div>
                <div className="relative ml-7 aspect-[3/4] w-[68px] overflow-hidden rounded-lg bg-sidebar sm:ml-0">{imageFor(lead) ? lead.contentType.startsWith("video/") ? <video src={imageFor(lead)!} className="h-full w-full object-cover" muted playsInline /> : <img src={imageFor(lead)!} alt={lead.fileName} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[9px] text-muted">Prévia</div>}{carousel && <span className="absolute right-1 top-1 rounded bg-foreground/80 px-1.5 py-0.5 text-[8px] font-semibold text-white">{draft.mediaAssets.length} itens</span>}</div>
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-semibold text-muted">{carousel ? `Carrossel · ${draft.mediaAssets.length} mídias` : lead.contentType.startsWith("video/") ? "Reel" : "Foto"}</span><span className="min-w-0 flex-1 truncate text-[11px] text-muted">{carousel ? draft.mediaAssets.map((asset) => asset.fileName).join(" · ") : lead.fileName}</span>{carousel && <button type="button" onClick={() => splitCarousel(draft)} className="text-[10px] font-semibold text-accent hover:underline">Separar</button>}<button type="button" onClick={() => removeDraft(draft.id)} aria-label={`Remover publicação ${index + 1}`} className="rounded-md px-2 py-1 text-[10px] font-medium text-muted hover:bg-error/5 hover:text-error">Remover</button></div>
                  {carousel && <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Ordem das mídias no carrossel">{draft.mediaAssets.map((asset, mediaIndex) => <div key={asset.id} className="flex w-[54px] shrink-0 flex-col items-center gap-1"><div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-sidebar">{asset.publicUrl && (asset.contentType.startsWith("video/") ? <video src={asset.publicUrl} className="h-full w-full object-cover" muted playsInline /> : <img src={asset.publicUrl} alt={asset.fileName} className="h-full w-full object-cover" />)}<span className="absolute left-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-foreground/80 text-[8px] font-semibold text-white">{mediaIndex + 1}</span></div><div className="flex gap-1"><button type="button" disabled={mediaIndex === 0} onClick={() => moveCarouselAsset(draft, mediaIndex, -1)} aria-label={`Mover mídia ${mediaIndex + 1} para a esquerda`} className="grid h-5 w-5 place-items-center rounded border border-border text-[9px] disabled:opacity-30">←</button><button type="button" disabled={mediaIndex === draft.mediaAssets.length - 1} onClick={() => moveCarouselAsset(draft, mediaIndex, 1)} aria-label={`Mover mídia ${mediaIndex + 1} para a direita`} className="grid h-5 w-5 place-items-center rounded border border-border text-[9px] disabled:opacity-30">→</button></div></div>)}</div>}
                  <label className="block"><span className="sr-only">Legenda para {lead.fileName}</span><textarea value={draft.caption} onChange={(event) => updateDraft(draft.id, { caption: event.target.value.slice(0, 2200) })} rows={2} maxLength={2200} placeholder="Adicione a legenda desta publicação…" className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 text-foreground placeholder:text-muted/70" /></label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted">Publicação</span><input type="datetime-local" value={draft.scheduledAt} onChange={(event) => updateDraft(draft.id, { scheduledAt: event.target.value })} className="w-full min-w-0 rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground" /></label>
                    {!carousel && lead.contentType.startsWith("video/") && <div className="space-y-2 rounded-lg bg-background p-3">
                      <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-4"><input type="checkbox" checked={draft.trialGraduationStrategy !== null} onChange={(event) => updateDraft(draft.id, { trialGraduationStrategy: event.target.checked ? "MANUAL" : null })} className="mt-0.5 accent-accent" /><span>Publicar como Reel de teste</span></label>
                      {draft.trialGraduationStrategy ? <label className="block pl-5"><span className="mb-1 block text-[10px] font-semibold text-muted">Compartilhamento posterior</span><select value={draft.trialGraduationStrategy} onChange={(event) => updateDraft(draft.id, { trialGraduationStrategy: event.target.value as TrialReelGraduationStrategy })} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] text-foreground"><option value="MANUAL">Manual</option><option value="SS_PERFORMANCE">Automático, se o desempenho for bom</option></select><span className="mt-1 block text-[10px] leading-4 text-muted">A Meta decide se compartilha com todos.</span></label> : <label className="flex cursor-pointer items-start gap-2 border-t border-border pt-2 text-[11px] leading-4"><input type="checkbox" checked={draft.shareToFeed} onChange={(event) => updateDraft(draft.id, { shareToFeed: event.target.checked })} className="mt-0.5 accent-accent" /><span>Mostrar também no feed</span></label>}
                    </div>}
                  </div>
                </div>
              </li>;
            })}
          </ol>}
        </section>
      </main>

      <aside className="space-y-5 xl:sticky xl:top-24">
        <section className="panel overflow-hidden">
          <div className="border-b border-border px-5 py-4"><p className="text-xs font-medium text-muted">Prévia do perfil</p><h2 className="mt-0.5 text-sm font-semibold">Grade depois de publicar</h2></div>
          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-3"><Avatar username={profile?.username ?? account?.username ?? "instagram"} url={profile?.profilePictureUrl} /><div className="min-w-0"><p className="truncate text-sm font-semibold">@{profile?.username ?? account?.username}</p><p className="text-xs text-muted">Novas publicações</p></div><span className="ml-auto rounded-lg bg-sidebar px-2.5 py-1.5 text-[11px] font-semibold">{drafts.length} posts</span></div>
            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {previewTiles.length ? previewTiles.map((tile) => <div key={tile.id} className="relative aspect-[3/4] overflow-hidden rounded-lg bg-sidebar">{tile.url && (tile.video ? <video src={tile.url} className="h-full w-full object-cover" muted playsInline /> : <img src={tile.url} alt={tile.kind} className="h-full w-full object-cover" />)}<span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-foreground/80 px-1.5 py-0.5 text-[8px] font-semibold text-white">{tile.kind}</span></div>) : <>{[0, 1, 2].map((item) => <div key={item} className="grid aspect-[3/4] place-items-center rounded-lg bg-sidebar px-1 text-center text-[10px] text-muted">Sem prévia</div>)}</>}
            </div>
            {drafts.length > 6 && <p className="mt-3 text-center text-[11px] text-muted">Prévia das primeiras 6 publicações de {drafts.length}.</p>}
            <p className="mt-3 text-center text-[11px] leading-5 text-muted">Prévia aproximada em 3:4. O Instagram pode ajustar o corte da grade.</p>
          </div>
        </section>

        <section className="panel p-5">
          <p className="text-xs font-medium text-muted">Resumo do lote</p><h2 className="mt-1 text-base font-semibold">Harmonia da grade</h2>
          <div className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-4"><span className="text-muted">Publicações</span><strong>{drafts.length}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Mídias no total</span><strong>{totalMedia}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Carrosséis</span><strong>{drafts.filter((draft) => draft.mediaAssets.length > 1).length}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Período previsto</span><strong className="text-right">{drafts.length && drafts[0].scheduledAt && drafts.at(-1)?.scheduledAt ? `${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(drafts[0].scheduledAt))} – ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(drafts.at(-1)!.scheduledAt))}` : "Aguardando arquivos"}</strong></div></div>
          <div className={`mt-4 rounded-xl px-3.5 py-3 text-xs leading-5 ${missingCaptions > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{missingCaptions ? `${missingCaptions} ${missingCaptions === 1 ? "publicação sem legenda" : "publicações sem legenda"}. Você ainda pode agendar assim.` : drafts.length ? "Todas as publicações têm legenda." : "As legendas e os horários aparecem aqui para revisão."}</div>
          <div className="mt-4 rounded-xl bg-background px-3.5 py-3 text-[11px] leading-5 text-muted">O Instagram pode levar alguns minutos para processar publicações agendadas. Reels sem “Mostrar Reel no feed” não aparecem na grade.</div>
          <button type="button" onClick={interleaveFormats} disabled={busy || drafts.length < 2 || !canInterleave} className="mt-3 h-9 w-full rounded-lg border border-border bg-surface text-xs font-semibold text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45">Intercalar formatos automaticamente</button>
        </section>
      </aside>
    </div>

    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6 lg:left-[268px]">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{drafts.length} {drafts.length === 1 ? "post" : "posts"} · {totalMedia} mídias</p><p className="text-[11px] text-muted">{drafts.length && drafts[0].scheduledAt ? `A partir de ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(drafts[0].scheduledAt))}` : "Adicione mídias para começar"}</p></div>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy || drafts.length === 0} onClick={() => void save("DRAFT")} className="h-10 rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-foreground hover:bg-surface-hover disabled:opacity-50">Salvar como rascunho</button><button type="button" disabled={busy || drafts.length === 0 || !account?.publishingPermissionGranted} onClick={() => void save("SCHEDULE")} className="h-10 rounded-xl bg-accent px-5 text-xs font-semibold text-white shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Salvando lote…" : `Agendar ${drafts.length} posts`}</button></div>
      </div>
    </div>
  </div>;
}

function Step({ number, label, active }: { number: string; label: string; active: boolean }) {
  return <div className={`flex items-center gap-2.5 text-xs font-semibold ${active ? "text-foreground" : "text-muted"}`}><span className={`grid h-7 w-7 place-items-center rounded-full text-[10px] ${active ? "bg-accent text-white" : "bg-sidebar text-muted"}`}>{number}</span>{label}</div>;
}

function Avatar({ username, url }: { username: string; url?: string | null }) {
  return url ? <img src={url} alt={`Foto do perfil de @${username}`} className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-sm font-bold text-accent">{username.slice(0, 1).toUpperCase()}</span>;
}

function UploadIcon() { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0L7 9m5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>; }
function FolderIcon() { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6.5h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9h18"/></svg>; }
function GridIcon() { return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>; }
