"use client";

/* eslint-disable @next/next/no-img-element -- Story previews use the protected media URL returned by the API. */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  apiRequest,
  formatBytes,
  formatDateTime,
  localDateTimeValue,
  timezone,
  type InstagramAccountOption,
  type MediaAsset,
} from "@/components/scheduling/shared";
import { summarizeStorySequence } from "@/lib/story-metrics";
import { StoryPlayer } from "@/components/stories/story-player";

type StoryStatus = "DRAFT" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "PARTIAL" | "FAILED" | "CANCELED";
interface StoryMetric {
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  follows: number | null;
  profileVisits: number | null;
  totalInteractions: number | null;
  navigation: Record<string, number> | null;
  capturedAt: string;
}
interface StorySlide {
  id: string;
  position: number;
  status: string;
  lastError: string | null;
  mediaAsset: MediaAsset;
  mediaUrl: string | null;
  metrics: StoryMetric[];
}
interface StorySequence {
  id: string;
  title: string;
  status: StoryStatus;
  scheduledAt: string | null;
  timeZone: string;
  publishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  instagramAccountId: string;
  instagramAccount: { id: string; username: string };
  slides: StorySlide[];
}

const CHUNK_SIZE = 8 * 1024 * 1024;
const STATUS_LABEL: Record<StoryStatus, string> = {
  DRAFT: "Rascunho", SCHEDULED: "Agendado", PUBLISHING: "Publicando", PUBLISHED: "Publicado",
  PARTIAL: "Parcial", FAILED: "Falhou", CANCELED: "Cancelado",
};

function moveItem(ids: string[], index: number, offset: -1 | 1): string[] {
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function pct(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

async function prepareStoryFile(file: File): Promise<File> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const type = file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" } as Record<string, string>)[extension ?? ""] || "";
  if (type === "image/jpeg") return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  if (type === "image/png" || type === "image/webp") {
    if (file.size > 25 * 1024 * 1024) throw new Error("A imagem original pode ter até 25 MB antes da conversão.");
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Seu navegador não conseguiu preparar a imagem.");
      context.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Não foi possível converter a imagem para JPEG.")), "image/jpeg", 0.92));
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "story"}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } finally { bitmap.close(); }
  }
  if (type === "video/mp4" || type === "video/quicktime") return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  if (extension === "mp4" || extension === "mov") return new File([file], file.name, { type: extension === "mov" ? "video/quicktime" : "video/mp4", lastModified: file.lastModified });
  throw new Error("Use uma imagem JPG, PNG ou WebP, ou um vídeo MP4/MOV.");
}

async function validateStoryVideo(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata"; video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Não foi possível ler os dados deste vídeo."));
    });
    if (!Number.isFinite(video.duration) || video.duration < 1 || video.duration > 60) throw new Error("Cada vídeo de Story precisa ter até 60 segundos.");
    if (video.videoWidth > 1920 || video.videoHeight > 1920) throw new Error("A resolução do vídeo precisa ser de até 1.920 pixels por dimensão.");
  } finally { video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
}

export default function StoriesWorkspace() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<InstagramAccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [sequences, setSequences] = useState<StorySequence[]>([]);
  const [title, setTitle] = useState("Nova sequência");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scheduleValue, setScheduleValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const account = accounts.find((item) => item.id === accountId) ?? null;
  const orderedAssets = useMemo(() => selectedIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is MediaAsset => Boolean(asset)), [assets, selectedIds]);
  const publishedSequences = sequences.filter((sequence) => sequence.status === "PUBLISHED");
  const activeSequences = sequences.filter((sequence) => ["DRAFT", "SCHEDULED", "PUBLISHING", "PARTIAL", "FAILED"].includes(sequence.status));
  const publishedMetrics = useMemo(() => publishedSequences.map((sequence) => summarizeStorySequence(sequence.slides.map((slide) => slide.metrics[0] ?? {
    reach: null, views: null, replies: null, shares: null, follows: null, profileVisits: null, totalInteractions: null, navigation: null,
  }))), [publishedSequences]);
  const totals = useMemo(() => ({
    sequences: publishedSequences.length,
    reach: publishedMetrics.reduce((sum, item) => sum + (item.firstReach ?? 0), 0),
    replies: publishedMetrics.reduce((sum, item) => sum + item.replies, 0),
    averageCompletion: publishedMetrics.filter((item) => item.completionRate !== null).length
      ? publishedMetrics.reduce((sum, item) => sum + (item.completionRate ?? 0), 0) / publishedMetrics.filter((item) => item.completionRate !== null).length
      : null,
  }), [publishedMetrics, publishedSequences.length]);

  const refresh = useCallback(async (id: string) => {
    if (!id) { setSequences([]); setAssets([]); return; }
    const [sequenceData, assetData] = await Promise.all([
      apiRequest<StorySequence[]>(`/api/instagram/stories?instagramAccountId=${encodeURIComponent(id)}`),
      apiRequest<MediaAsset[]>(`/api/media-assets?instagramAccountId=${encodeURIComponent(id)}`),
    ]);
    setSequences(sequenceData);
    setAssets(assetData);
  }, []);

  useEffect(() => {
    let mounted = true;
    apiRequest<{ instagramAccounts: InstagramAccountOption[]; selectedInstagramAccountId: string | null }>("/api/instagram/stories/accounts")
      .then(async (data) => {
        if (!mounted) return;
        setAccounts(data.instagramAccounts);
        const selected = data.selectedInstagramAccountId ?? "";
        setAccountId(selected);
        if (selected) await refresh(selected);
      })
      .catch((reason: unknown) => { if (mounted) setError(reason instanceof Error ? reason.message : "Não foi possível carregar Stories."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [refresh]);

  useEffect(() => {
    if (!accountId) return;
    const timer = window.setInterval(() => { void refresh(accountId).catch(() => undefined); }, 30_000);
    return () => window.clearInterval(timer);
  }, [accountId, refresh]);

  async function changeAccount(id: string) {
    setAccountId(id); setError(""); setNotice(""); setEditingId(null); setTitle("Nova sequência"); setSelectedIds([]); setScheduleValue("");
    setLoading(true);
    try { await refresh(id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar a conta."); }
    finally { setLoading(false); }
  }

  function editSequence(sequence: StorySequence) {
    setEditingId(sequence.id); setTitle(sequence.title); setSelectedIds(sequence.slides.map((slide) => slide.mediaAsset.id));
    setScheduleValue(localDateTimeValue(sequence.scheduledAt)); setError(""); setNotice("Revise os quadros e salve a sequência.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetComposer() {
    setEditingId(null); setTitle("Nova sequência"); setSelectedIds([]); setScheduleValue(""); setError(""); setNotice("");
  }

  async function uploadOne(file: File) {
    if (!accountId) throw new Error("Selecione uma conta do Instagram primeiro.");
    if (selectedIds.length >= 20) throw new Error("Uma sequência pode ter até 20 quadros.");
    const prepared = await prepareStoryFile(file);
    const isImage = prepared.type === "image/jpeg";
    if (isImage && prepared.size > 8 * 1024 * 1024) throw new Error("A imagem precisa ter até 8 MB depois da conversão.");
    if (!isImage) {
      if (prepared.size > 1024 * 1024 * 1024) throw new Error("O vídeo precisa ter até 1 GB.");
      await validateStoryVideo(prepared);
    }
    const asset = await apiRequest<MediaAsset>("/api/media-assets", {
      method: "POST",
      body: JSON.stringify({ instagramAccountId: accountId, fileName: prepared.name, contentType: prepared.type, byteSize: prepared.size }),
    });
    try {
      let offset = 0;
      setUploadProgress(0);
      while (offset < prepared.size) {
        const response = await fetch(`/api/media-assets/${encodeURIComponent(asset.id)}/upload`, {
          method: "PUT", headers: { "Upload-Offset": String(offset), "Content-Type": "application/octet-stream" },
          body: prepared.slice(offset, Math.min(offset + CHUNK_SIZE, prepared.size)),
        });
        const result = await response.json().catch(() => null) as { success?: boolean; data?: { uploadedBytes: number }; error?: string } | null;
        if (!response.ok || !result?.success || !result.data) throw new Error(result?.error || "A conexão caiu durante o envio. Envie o arquivo novamente.");
        offset = result.data.uploadedBytes;
        setUploadProgress(Math.round(offset / prepared.size * 100));
      }
      await apiRequest<MediaAsset>(`/api/media-assets/${encodeURIComponent(asset.id)}/complete`, { method: "POST" });
    } catch (reason) {
      await apiRequest(`/api/media-assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" }).catch(() => undefined);
      throw reason;
    }
    await refresh(accountId);
    setSelectedIds((current) => [...current, asset.id]);
    setNotice("Arquivo pronto e adicionado ao final da sequência.");
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setBusy(true); setError(""); setNotice("");
    try {
      for (const file of files.slice(0, Math.max(0, 20 - selectedIds.length))) await uploadOne(file);
      if (files.length + selectedIds.length > 20) setNotice("Foram adicionados até completar o limite de 20 quadros.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar o arquivo."); }
    finally { setBusy(false); setUploadProgress(null); }
  }

  async function save(mode: "DRAFT" | "SCHEDULE" | "NOW") {
    if (!accountId || !title.trim() || selectedIds.length === 0) { setError("Informe o título e adicione pelo menos um quadro."); return; }
    if (mode === "SCHEDULE" && !scheduleValue) { setError("Escolha a data e o horário para agendar."); return; }
    setBusy(true); setError(""); setNotice("");
    const payload = {
      ...(editingId ? {} : { instagramAccountId: accountId }),
      title: title.trim(), mediaAssetIds: selectedIds, mode,
      ...(mode === "SCHEDULE" ? { scheduledAt: new Date(scheduleValue).toISOString() } : {}),
      timeZone: timezone(),
    };
    try {
      if (editingId) await apiRequest(`/api/instagram/stories?id=${encodeURIComponent(editingId)}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await apiRequest<StorySequence>("/api/instagram/stories", { method: "POST", body: JSON.stringify(payload) });
      await refresh(accountId);
      setNotice(mode === "DRAFT" ? "Rascunho salvo." : mode === "NOW" ? "Sequência enviada para publicação." : "Sequência agendada.");
      resetComposer();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a sequência."); }
    finally { setBusy(false); }
  }

  async function cancelSequence(sequence: StorySequence) {
    if (!window.confirm(`Cancelar “${sequence.title}”?`)) return;
    setBusy(true); setError("");
    try { await apiRequest(`/api/instagram/stories/${encodeURIComponent(sequence.id)}`, { method: "DELETE" }); await refresh(accountId); setNotice("Sequência cancelada."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível cancelar."); }
    finally { setBusy(false); }
  }

  async function duplicateSequence(sequence: StorySequence) {
    setBusy(true); setError(""); setNotice("");
    try {
      const copy = await apiRequest<{ id: string }>(`/api/instagram/stories/${encodeURIComponent(sequence.id)}/duplicate`, { method: "POST" });
      await refresh(accountId);
      const created = sequences.find((item) => item.id === copy.id);
      if (created) editSequence(created);
      else {
        const fresh = await apiRequest<StorySequence[]>(`/api/instagram/stories?instagramAccountId=${encodeURIComponent(accountId)}`);
        setSequences(fresh);
        const draft = fresh.find((item) => item.id === copy.id);
        if (draft) editSequence(draft);
      }
      setNotice("Cópia criada como rascunho. Revise antes de publicar.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível duplicar a sequência."); }
    finally { setBusy(false); }
  }

  function cardClass(status: StoryStatus) {
    if (status === "PUBLISHED") return "bg-success/10 text-success";
    if (["FAILED", "PARTIAL"].includes(status)) return "bg-error/10 text-error";
    if (["SCHEDULED", "PUBLISHING"].includes(status)) return "bg-accent/10 text-accent";
    return "bg-sidebar text-muted";
  }

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
      <header className="mb-7 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-muted">FISGA / Publicação</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground">Stories</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Monte sequências, programe cada quadro e acompanhe os resultados enquanto as métricas estiverem disponíveis no Instagram.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="sr-only" htmlFor="story-account">Conta do Instagram</label>
          <select id="story-account" value={accountId} onChange={(event) => void changeAccount(event.target.value)} className="min-w-48 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent">
            {accounts.length === 0 && <option value="">Nenhuma conta</option>}
            {accounts.map((item) => <option key={item.id} value={item.id}>@{item.username}</option>)}
          </select>
          <button type="button" onClick={resetComposer} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95" disabled={!accountId}>＋ Novo story</button>
        </div>
      </header>

      {error && <div role="alert" className="mb-5 rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>}
      {notice && <div role="status" className="mb-5 rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">{notice}</div>}
      {account && !account.storyPublishingReady && <div className="mb-5 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-foreground">Você pode montar e salvar rascunhos. Para publicar Stories, conecte em Configurações a Página do Facebook vinculada a esta conta Business do Instagram.</div>}

      <section aria-label="Resumo de Stories publicados" className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Sequências publicadas", totals.sequences.toLocaleString("pt-BR")],
          ["Alcance inicial somado", totals.reach.toLocaleString("pt-BR")],
          ["Conclusão média", pct(totals.averageCompletion)],
          ["Respostas", publishedMetrics.reduce((sum, item) => sum + item.replies, 0).toLocaleString("pt-BR")],
        ].map(([label, value]) => <div key={label} className="rounded-2xl border border-border bg-surface p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 font-display text-2xl font-bold tabular-nums text-foreground">{value}</p></div>)}
      </section>

      <section className="mb-9 rounded-2xl border border-border bg-surface p-4 shadow-[0_2px_10px_rgba(22,24,29,0.03)] sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{editingId ? "Editar sequência" : "Nova sequência"}</p><h2 className="mt-1 font-display text-xl font-bold text-foreground">Prepare os quadros</h2></div>
          {editingId && <button type="button" onClick={resetComposer} className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground">Sair da edição</button>}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="sequence-title">Nome da sequência</label>
            <input id="sequence-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} className="mb-5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent" />
            <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-foreground">Quadros <span className="font-normal text-muted">{selectedIds.length}/20</span></h3><button type="button" onClick={() => fileRef.current?.click()} disabled={busy || selectedIds.length >= 20} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-accent hover:bg-sidebar disabled:opacity-50">＋ Enviar arquivo</button><input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.mp4,.mov" multiple onChange={(event) => void onFiles(event)} /></div>
            {uploadProgress !== null && <div className="mb-4" role="status"><div className="mb-1 flex justify-between text-xs text-muted"><span>Enviando mídia</span><span>{uploadProgress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full bg-accent transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>}
            {selectedIds.length > 0 ? <ol className="space-y-2">
              {orderedAssets.map((asset, index) => <li key={asset.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg p-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sidebar text-sm font-semibold text-muted">{index + 1}</span>
                <div className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-sidebar">
                  {asset.publicUrl && asset.contentType.startsWith("image/") ? <img src={asset.publicUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] font-semibold text-muted">VÍDEO</span>}
                </div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{asset.fileName}</p><p className="mt-0.5 text-xs text-muted">{asset.contentType.startsWith("image/") ? "Imagem" : "Vídeo"} · {formatBytes(asset.byteSize)}</p></div>
                <button type="button" aria-label={`Mover ${asset.fileName} para cima`} onClick={() => setSelectedIds((current) => moveItem(current, index, -1))} disabled={index === 0} className="rounded p-2 text-muted hover:bg-sidebar disabled:opacity-30">↑</button>
                <button type="button" aria-label={`Mover ${asset.fileName} para baixo`} onClick={() => setSelectedIds((current) => moveItem(current, index, 1))} disabled={index === selectedIds.length - 1} className="rounded p-2 text-muted hover:bg-sidebar disabled:opacity-30">↓</button>
                <button type="button" aria-label={`Remover ${asset.fileName}`} onClick={() => setSelectedIds((current) => current.filter((id) => id !== asset.id))} className="rounded p-2 text-muted hover:bg-error/10 hover:text-error">×</button>
              </li>)}
            </ol> : <button type="button" onClick={() => fileRef.current?.click()} className="grid min-h-40 w-full place-items-center rounded-2xl border border-dashed border-border bg-bg px-6 text-center hover:border-accent/50"><span><span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-xl text-accent">＋</span><span className="block text-sm font-semibold text-foreground">Envie ou escolha mídias da biblioteca</span><span className="mt-1 block text-xs text-muted">JPG, PNG, WebP, MP4 ou MOV. Até 20 quadros.</span></span></button>}
            {assets.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-medium text-muted">Biblioteca desta conta</p><div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">{assets.filter((asset) => !selectedIds.includes(asset.id)).map((asset) => <button key={asset.id} type="button" onClick={() => setSelectedIds((current) => current.length < 20 ? [...current, asset.id] : current)} className="max-w-full truncate rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-muted hover:border-accent hover:text-accent">＋ {asset.fileName}</button>)}</div></div>}
          </div>

          <aside className="rounded-2xl bg-sidebar p-4 sm:p-5">
            <StoryPlayer assets={orderedAssets} username={account?.username ?? null} />
          </aside>
        </div>

        <div className="mt-6 grid gap-3 border-t border-border pt-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div><label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="story-schedule">Agendar para <span className="font-normal text-muted">(opcional para salvar rascunho)</span></label><input id="story-schedule" type="datetime-local" value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent sm:max-w-xs" /><p className="mt-1 text-xs text-muted">Fuso horário: {timezone()}</p></div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button type="button" disabled={busy || selectedIds.length === 0} onClick={() => void save("DRAFT")} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-sidebar disabled:opacity-50">Salvar rascunho</button>
            <button type="button" disabled={busy || selectedIds.length === 0 || !scheduleValue || !account?.storyPublishingReady} onClick={() => void save("SCHEDULE")} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-sidebar disabled:opacity-50">Agendar</button>
            <button type="button" disabled={busy || selectedIds.length === 0 || !account?.storyPublishingReady} onClick={() => void save("NOW")} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">Publicar agora</button>
          </div>
        </div>
      </section>

      <section className="grid gap-8 xl:grid-cols-[1fr_1fr]">
        <div><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Planejador</p><h2 className="mt-1 font-display text-xl font-bold text-foreground">Suas sequências</h2></div><span className="text-xs text-muted">{activeSequences.length} em andamento</span></div>
          {loading ? <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">Carregando Stories…</p> : activeSequences.length === 0 ? <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">Ainda não há rascunhos nem sequências agendadas.</p> : <div className="space-y-3">{activeSequences.map((sequence) => <article key={sequence.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold text-foreground">{sequence.title}</h3><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${cardClass(sequence.status)}`}>{STATUS_LABEL[sequence.status]}</span></div><p className="mt-1 text-xs text-muted">@{sequence.instagramAccount.username} · {sequence.slides.length} quadros{sequence.scheduledAt ? ` · ${formatDateTime(sequence.scheduledAt, sequence.timeZone)}` : ""}</p></div><div className="flex gap-2">{["DRAFT", "SCHEDULED"].includes(sequence.status) && <button type="button" onClick={() => editSequence(sequence)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground">Editar</button>}{["DRAFT", "SCHEDULED", "FAILED"].includes(sequence.status) && <button type="button" disabled={busy} onClick={() => void cancelSequence(sequence)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-error">Cancelar</button>}</div></div>
            <div className="mt-3 flex gap-1.5">{sequence.slides.map((slide, index) => <div key={slide.id} className="h-1.5 flex-1 rounded-full bg-border" title={`Quadro ${index + 1}: ${slide.status}`}><div className={`h-full rounded-full ${slide.status === "PUBLISHED" ? "bg-success" : slide.status === "FAILED" ? "bg-error" : "bg-accent"}`} style={{ width: slide.status === "PUBLISHED" ? "100%" : "35%" }} /></div>)}</div>
            {sequence.lastError && <p className="mt-3 text-xs text-error">{sequence.lastError}</p>}
          </article>)}</div>}
        </div>

        <div><div className="mb-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Desempenho</p><h2 className="mt-1 font-display text-xl font-bold text-foreground">Sequências publicadas</h2></div>
          {publishedSequences.length === 0 ? <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">Depois de publicar, o alcance, as respostas e a retenção por quadro aparecem aqui.</p> : <div className="space-y-3">{publishedSequences.map((sequence) => {
            const summary = summarizeStorySequence(sequence.slides.map((slide) => slide.metrics[0] ?? { reach: null, views: null, replies: null, shares: null, follows: null, profileVisits: null, totalInteractions: null, navigation: null }));
            return <article key={sequence.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-foreground">{sequence.title}</h3><p className="mt-1 text-xs text-muted">@{sequence.instagramAccount.username} · {formatDateTime(sequence.publishedAt, sequence.timeZone)}</p></div><button type="button" disabled={busy} onClick={() => void duplicateSequence(sequence)} className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-accent hover:bg-sidebar">Duplicar para editar</button></div>
              <div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-lg bg-bg p-2.5"><p className="text-[11px] text-muted">Alcance inicial</p><p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{summary.firstReach?.toLocaleString("pt-BR") ?? "—"}</p></div><div className="rounded-lg bg-bg p-2.5"><p className="text-[11px] text-muted">Último quadro</p><p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{summary.lastReach?.toLocaleString("pt-BR") ?? "—"}</p></div><div className="rounded-lg bg-bg p-2.5"><p className="text-[11px] text-muted">Conclusão</p><p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{pct(summary.completionRate)}</p></div></div>
              <div className="mt-4 space-y-2">{sequence.slides.map((slide, index) => { const metric = slide.metrics[0]; const first = summary.firstReach ?? 0; const rate = metric?.reach !== null && metric?.reach !== undefined && first > 0 ? Math.min(1, metric.reach / first) : null; return <div key={slide.id} className="flex items-center gap-3"><span className="w-16 shrink-0 text-xs text-muted">Quadro {index + 1}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(rate === null ? 0 : 4, (rate ?? 0) * 100)}%` }} /></div><span className="w-14 text-right text-xs tabular-nums text-muted">{metric?.reach?.toLocaleString("pt-BR") ?? "—"}</span></div>; })}</div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>{summary.replies} respostas</span><span>{summary.shares} compartilhamentos</span><span>{summary.exits} saídas</span></div>
              <p className="mt-3 text-[11px] text-muted">Métricas consultadas periodicamente enquanto disponíveis pela Meta. A duplicação cria um rascunho editável.</p>
            </article>;
          })}</div>}
        </div>
      </section>
    </main>
  );
}
