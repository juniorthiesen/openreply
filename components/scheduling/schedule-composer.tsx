"use client";

/* eslint-disable @next/next/no-img-element -- Instagram profile and media URLs come from each connected account. */

import Link from "next/link";
import InterfaceIcon from "@/components/interface-icon";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  apiRequest,
  formatBytes,
  formatDateTime,
  localDateTimeValue,
  timezone,
  type AutomationOption,
  type InstagramAccountOption,
  type InstagramMediaItem,
  type InstagramProfile,
  type MediaAsset,
  type ScheduledPost,
} from "@/components/scheduling/shared";
import { CHUNK_SIZE, prepareUploadFile, validateReelFile } from "@/components/scheduling/upload-utils";
import type { TrialReelGraduationStrategy } from "@/lib/scheduling/trial-reels";

function statusLabel(status: ScheduledPost["status"]): string {
  return {
    DRAFT: "Rascunho",
    SCHEDULED: "Agendado",
    PUBLISHING: "Publicando",
    PUBLISHED: "Publicado",
    FAILED: "Falhou",
    CANCELED: "Cancelado",
  }[status];
}

function statusColor(status: ScheduledPost["status"]): string {
  if (status === "PUBLISHED") return "bg-success/10 text-success";
  if (status === "FAILED") return "bg-error/10 text-error";
  if (status === "SCHEDULED" || status === "PUBLISHING") return "bg-accent/10 text-accent";
  return "bg-sidebar text-muted";
}

export default function ScheduleComposer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<InstagramAccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [automations, setAutomations] = useState<AutomationOption[]>([]);
  const [instagramPosts, setInstagramPosts] = useState<InstagramMediaItem[]>([]);
  const [profile, setProfile] = useState<InstagramProfile | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [isCarousel, setIsCarousel] = useState(false);
  const [carouselPreviewIndex, setCarouselPreviewIndex] = useState(0);
  const [pendingUpload, setPendingUpload] = useState<{ asset: MediaAsset; file: File } | null>(null);
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [trialGraduationStrategy, setTrialGraduationStrategy] = useState<TrialReelGraduationStrategy | null>(null);
  const [automationId, setAutomationId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [previewMode, setPreviewMode] = useState<"post" | "profile">("post");

  const account = accounts.find((item) => item.id === accountId) ?? null;
  const selectedAssets = selectedAssetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is MediaAsset => Boolean(asset));
  const selectedAsset = selectedAssets[0] ?? null;
  const previewAsset = selectedAssets[Math.min(carouselPreviewIndex, Math.max(0, selectedAssets.length - 1))] ?? null;
  const accountPosts = posts.filter((post) => post.instagramAccountId === accountId);
  const previewItems = useMemo(() => {
    const instagramPostIds = new Set(instagramPosts.map((post) => post.id));
    const savedPosts = accountPosts
      .filter((post) => post.id !== editingId)
      .filter((post) => ["SCHEDULED", "PUBLISHED", "PUBLISHING"].includes(post.status))
      .filter((post) => !post.trialGraduationStrategy)
      .filter((post) => !post.instagramMediaId || !instagramPostIds.has(post.instagramMediaId))
      .map((post) => ({
        id: post.id,
        url: post.mediaUrl ?? null,
        caption: post.caption,
        timestamp: post.publishedAt ?? post.scheduledAt ?? post.createdAt,
        kind: post.mediaType === "CAROUSEL" ? "Carrossel" : post.mediaType === "REEL" ? "Reel" : "Foto",
      }));
    const instagramFeed = instagramPosts.map((post) => ({
      id: post.id,
      url: post.media_type === "VIDEO" ? post.thumbnail_url ?? post.media_url ?? null : post.media_url ?? null,
      caption: post.caption ?? "",
      timestamp: post.timestamp,
      kind: post.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : post.media_type === "VIDEO" || post.media_product_type === "REELS" ? "Reel" : "Foto",
    }));
    return [...savedPosts, ...instagramFeed]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 8);
  }, [accountPosts, editingId, instagramPosts]);

  const refreshPosts = useCallback(async (selectedAccountId: string) => {
    const data = await apiRequest<ScheduledPost[]>(`/api/scheduled-posts?instagramAccountId=${encodeURIComponent(selectedAccountId)}`);
    setPosts((current) => [...current.filter((post) => post.instagramAccountId !== selectedAccountId), ...data]);
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<{ instagramAccounts: InstagramAccountOption[]; selectedInstagramAccountId: string | null }>("/api/instagram/accounts")
      .then((data) => {
        if (!active) return;
        setAccounts(data.instagramAccounts);
        setAccountId(data.selectedInstagramAccountId ?? "");
        if (data.instagramAccounts.length === 0) setLoading(false);
      })
      .catch((reason: unknown) => {
        if (active) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar as contas."); setLoading(false); }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    Promise.all([
      apiRequest<MediaAsset[]>(`/api/media-assets?instagramAccountId=${encodeURIComponent(accountId)}`),
      apiRequest<ScheduledPost[]>(`/api/scheduled-posts?instagramAccountId=${encodeURIComponent(accountId)}`),
    ]).then(async ([media, scheduled]) => {
      if (!active) return;
      setAssets(media);
      setPosts((current) => [...current.filter((post) => post.instagramAccountId !== accountId), ...scheduled]);
      const [campaignResult, feedResult, profileResult] = await Promise.allSettled([
        apiRequest<AutomationOption[]>(`/api/automations?instagramAccountId=${encodeURIComponent(accountId)}`),
        apiRequest<InstagramMediaItem[]>(`/api/instagram/posts?instagramAccountId=${encodeURIComponent(accountId)}&all=true`),
        apiRequest<InstagramProfile>(`/api/instagram/profile?instagramAccountId=${encodeURIComponent(accountId)}`),
      ]);
      if (active) {
        setAutomations(campaignResult.status === "fulfilled" ? campaignResult.value.map(({ id, name, isActive }) => ({ id, name, isActive })) : []);
        setInstagramPosts(feedResult.status === "fulfilled" ? feedResult.value : []);
        setProfile(profileResult.status === "fulfilled" ? profileResult.value : null);
      }
      setLoading(false);
    }).catch((reason: unknown) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados do Instagram.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [accountId]);

  function resetEditor() {
    setEditingId(null);
    setSelectedAssetIds([]);
    setIsCarousel(false);
    setCarouselPreviewIndex(0);
    setCaption("");
    setScheduledAt("");
    setShareToFeed(true);
    setTrialGraduationStrategy(null);
    setAutomationId("");
    setNotice("");
    setError("");
  }

  function editPost(post: ScheduledPost) {
    setEditingId(post.id);
    const mediaIds = post.mediaItems?.length
      ? post.mediaItems.slice().sort((a, b) => a.position - b.position).map((item) => item.mediaAsset.id)
      : [post.mediaAsset.id];
    setSelectedAssetIds(mediaIds);
    setIsCarousel(post.mediaType === "CAROUSEL");
    setCarouselPreviewIndex(0);
    setCaption(post.caption);
    setScheduledAt(localDateTimeValue(post.scheduledAt));
    setShareToFeed(post.shareToFeed);
    setTrialGraduationStrategy(post.trialGraduationStrategy);
    setAutomationId(post.automation?.id ?? "");
    setNotice("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function uploadFile(file: File) {
    setError("");
    setNotice("");
    setBusy(true);
    setUploadProgress(0);
    try {
      const prepared = await prepareUploadFile(file);
      const isImage = prepared.type === "image/jpeg";
      const limit = isImage ? 8 * 1024 * 1024 : 1024 * 1024 * 1024;
      if (prepared.size > limit) throw new Error(isImage ? "A imagem precisa ter até 8 MB depois da conversão." : "O vídeo precisa ter até 1 GB.");
      if (!isImage) await validateReelFile(prepared);
      const asset = await apiRequest<MediaAsset>("/api/media-assets", {
        method: "POST",
        body: JSON.stringify({ instagramAccountId: accountId, fileName: prepared.name, contentType: prepared.type, byteSize: prepared.size }),
      });
      setPendingUpload({ asset, file: prepared });
      await transferUpload(prepared, asset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o arquivo.");
    } finally {
      setBusy(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function transferUpload(file: File, asset: MediaAsset) {
    const current = await apiRequest<MediaAsset>(`/api/media-assets/${encodeURIComponent(asset.id)}`);
    if (current.byteSize !== file.size) throw new Error("O arquivo selecionado não corresponde ao envio interrompido.");
    let offset = current.uploadedBytes ?? 0;
    setUploadProgress(Math.round((offset / file.size) * 100));
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
      const response = await fetch(`/api/media-assets/${encodeURIComponent(asset.id)}/upload`, {
        method: "PUT",
        headers: { "Upload-Offset": String(offset), "Content-Type": "application/octet-stream" },
        body: chunk,
      });
      const result = await response.json().catch(() => null) as { success?: boolean; data?: { uploadedBytes: number }; error?: string } | null;
      if (!response.ok || !result?.success || !result.data) throw new Error(result?.error || "A conexão caiu durante o envio. Tente retomar o arquivo.");
      offset = result.data.uploadedBytes;
      setUploadProgress(Math.round((offset / file.size) * 100));
    }
    await apiRequest<MediaAsset>(`/api/media-assets/${encodeURIComponent(asset.id)}/complete`, { method: "POST" });
    const complete = await apiRequest<MediaAsset>(`/api/media-assets/${encodeURIComponent(asset.id)}`);
    setAssets((currentAssets) => [complete, ...currentAssets.filter((item) => item.id !== complete.id)]);
    setSelectedAssetIds((current) => isCarousel
      ? current.includes(complete.id) || current.length >= 10 ? current : [...current, complete.id]
      : [complete.id]);
    setCarouselPreviewIndex(0);
    setPendingUpload(null);
    setNotice("Arquivo adicionado à biblioteca.");
  }

  async function resumeUpload() {
    if (!pendingUpload) return;
    setBusy(true);
    setError("");
    setNotice("");
    setUploadProgress(0);
    try {
      await transferUpload(pendingUpload.file, pendingUpload.asset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível retomar o envio.");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  async function cancelUpload() {
    if (!pendingUpload || busy) return;
    try {
      await apiRequest(`/api/media-assets/${encodeURIComponent(pendingUpload.asset.id)}`, { method: "DELETE" });
      setPendingUpload(null);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível cancelar o envio.");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    for (const file of files) await uploadFile(file);
  }

  function toggleSelectedAsset(assetId: string) {
    setError("");
    setCarouselPreviewIndex(0);
    if (!isCarousel) {
      setSelectedAssetIds([assetId]);
      if (!assets.find((asset) => asset.id === assetId)?.contentType.startsWith("video/")) {
        setTrialGraduationStrategy(null);
      }
      return;
    }
    setTrialGraduationStrategy(null);
    setSelectedAssetIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      if (current.length >= 10) {
        setError("Um carrossel pode ter no máximo 10 mídias.");
        return current;
      }
      return [...current, assetId];
    });
  }

  async function savePost(mode: "DRAFT" | "SCHEDULE" | "NOW", event?: FormEvent) {
    event?.preventDefault();
    if (selectedAssetIds.length === 0) { setError("Escolha ou envie uma foto ou um vídeo."); return; }
    if (isCarousel && (selectedAssetIds.length < 2 || selectedAssetIds.length > 10)) {
      setError("Escolha de 2 a 10 mídias para montar o carrossel.");
      return;
    }
    if (!isCarousel && selectedAssetIds.length !== 1) {
      setError("Uma publicação única precisa ter apenas uma mídia.");
      return;
    }
    if (trialGraduationStrategy && !selectedAsset?.contentType.startsWith("video/")) {
      setError("Um Reel de teste precisa ter apenas um vídeo.");
      return;
    }
    if (!accountId) { setError("Conecte uma conta do Instagram para continuar."); return; }
    if (mode !== "DRAFT" && !account?.publishingPermissionGranted) {
      setError("Reconecte sua conta do Instagram e aprove a permissão de publicar conteúdo.");
      return;
    }
    if (mode === "SCHEDULE" && !scheduledAt) { setError("Escolha a data e o horário da publicação."); return; }
    const selectedDate = scheduledAt ? new Date(scheduledAt) : null;
    if (mode === "SCHEDULE" && (!selectedDate || Number.isNaN(selectedDate.getTime()) || selectedDate.getTime() < Date.now() + 30_000)) {
      setError("Escolha um horário pelo menos 30 segundos no futuro.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = {
        instagramAccountId: accountId,
        mediaAssetIds: selectedAssetIds,
        caption,
        mode: mode === "NOW" && editingId ? "SCHEDULE" : mode,
        ...(mode === "SCHEDULE" ? { scheduledAt: selectedDate!.toISOString() } : {}),
        ...(mode === "NOW" && editingId ? { scheduledAt: new Date(Date.now() + 60_000).toISOString() } : {}),
        timeZone: timezone(),
        shareToFeed: trialGraduationStrategy ? false : shareToFeed,
        trialGraduationStrategy,
        ...(automationId && !editingId ? { automationId } : {}),
      };
      if (editingId) {
        await apiRequest<ScheduledPost>(`/api/scheduled-posts?id=${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, mode: mode === "DRAFT" ? "DRAFT" : "SCHEDULE" }),
        });
      } else {
        await apiRequest<ScheduledPost>("/api/scheduled-posts", { method: "POST", body: JSON.stringify(body) });
      }
      await refreshPosts(accountId);
      resetEditor();
      setNotice(mode === "DRAFT" ? "Rascunho salvo." : mode === "NOW" ? "Publicação adicionada à fila para sair agora." : "Publicação agendada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a publicação.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPost(post: ScheduledPost) {
    if (!window.confirm(post.status === "DRAFT" ? "Excluir este rascunho?" : "Cancelar esta publicação agendada?")) return;
    setError("");
    try {
      await apiRequest(`/api/scheduled-posts/${encodeURIComponent(post.id)}`, { method: "DELETE" });
      await refreshPosts(accountId);
      if (editingId === post.id) resetEditor();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível cancelar a publicação."); }
  }

  async function retryPost(post: ScheduledPost) {
    setError("");
    try {
      await apiRequest(`/api/scheduled-posts/${encodeURIComponent(post.id)}/retry`, { method: "POST" });
      await refreshPosts(accountId);
      setNotice("A publicação entrou novamente na fila.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível tentar novamente."); }
  }

  async function deleteAsset(asset: MediaAsset) {
    setError("");
    try {
      await apiRequest(`/api/media-assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      setSelectedAssetIds((current) => current.filter((id) => id !== asset.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível remover o arquivo."); }
  }

  if (accounts.length === 0 && !loading) {
    return <section className="panel mx-auto max-w-3xl px-6 py-12 text-center sm:px-10">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent">
        <CalendarIcon />
      </span>
      <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">Agende sua próxima publicação</h1>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Conecte uma conta profissional do Instagram para criar rascunhos, organizar o feed e publicar fotos ou Reels.</p>
      <a href="/api/instagram/connect" className="mt-6 inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover">Conectar Instagram</a>
    </section>;
  }

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Publicações</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-foreground">{editingId ? "Editar publicação" : "Agendar post"}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Prepare a legenda, escolha uma mídia ou monte um carrossel e defina quando publicar.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!editingId && <Link href="/schedule/bulk" className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"><UploadIcon /> Subir posts em massa</Link>}
        <Link href="/feed" className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-hover"><GridIcon /> Abrir planejador do feed</Link>
      </div>
    </header>

    {error && <div role="alert" className="rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">{notice}</div>}

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
      <form className="space-y-5" onSubmit={(event) => void savePost("SCHEDULE", event)}>
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-medium text-muted">Publicar em</p><h2 className="mt-1 text-base font-semibold">Conta do Instagram</h2></div>
            <select value={accountId} disabled={busy || Boolean(pendingUpload)} onChange={(event) => { setLoading(true); setError(""); setAssets([]); setAutomations([]); setInstagramPosts([]); setProfile(null); setAccountId(event.target.value); resetEditor(); }} aria-label="Conta do Instagram" className="min-w-48 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium text-foreground disabled:opacity-60">
              {accounts.map((item) => <option key={item.id} value={item.id}>@{item.username}</option>)}
            </select>
          </div>
          {!account?.publishingPermissionGranted && <p className="mt-4 rounded-lg bg-warning/10 px-3 py-2.5 text-xs leading-5 text-warning">Para publicar, reconecte a conta e aprove a permissão de conteúdo. Rascunhos continuam disponíveis.</p>}
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-medium text-muted">01 · Mídia</p><h2 className="mt-1 font-display text-[22px] font-bold tracking-[-0.015em]">Escolha as mídias</h2></div>
            <span className="rounded-lg bg-sidebar px-2.5 py-1 text-xs font-medium text-muted">JPG até 8 MB · Reel até 1 GB</span>
          </div>
          <div className="mt-4 inline-flex rounded-xl bg-background p-1" role="group" aria-label="Formato da publicação">
            <button type="button" aria-pressed={!isCarousel} onClick={() => { setIsCarousel(false); setSelectedAssetIds((current) => current.slice(0, 1)); setCarouselPreviewIndex(0); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${!isCarousel ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>Publicação única</button>
            <button type="button" aria-pressed={isCarousel} onClick={() => { setIsCarousel(true); setTrialGraduationStrategy(null); setCarouselPreviewIndex(0); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${isCarousel ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>Carrossel</button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">{isCarousel ? "Selecione de 2 a 10 mídias na ordem em que devem aparecer. Fotos e vídeos podem ser combinados; você também pode escolher vários arquivos de uma vez." : "Escolha uma foto ou um Reel para esta publicação."}</p>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple={isCarousel} className="sr-only" onChange={(event) => void handleFileChange(event)} />
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()} className="group flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border-hover bg-background px-5 py-6 text-center transition-colors hover:border-accent/50 hover:bg-accent/[0.025] disabled:opacity-60">
              {uploadProgress !== null ? <>
                <span className="text-2xl font-semibold tabular-nums text-accent">{uploadProgress}%</span>
                <span className="mt-2 text-sm font-semibold">Enviando arquivo</span>
                <span className="mt-1 text-xs text-muted">Mantenha esta tela aberta</span>
                <span className="mt-4 h-1.5 w-full max-w-44 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${uploadProgress}%` }} /></span>
              </> : <>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent"><UploadIcon /></span>
                <span className="mt-3 text-sm font-semibold">{isCarousel ? "Enviar arquivos" : "Enviar novo arquivo"}</span>
                <span className="mt-1 text-xs text-muted">PNG e WebP viram JPEG automaticamente</span>
              </>}
            </button>
            <div className="min-h-44 rounded-xl bg-background p-3">
              <div className="flex items-center justify-between px-1 pb-2"><span className="text-xs font-semibold">Biblioteca de mídia</span><span className="text-[11px] text-muted">{assets.length} arquivos</span></div>
              {assets.length === 0 ? <p className="px-1 py-9 text-center text-xs leading-5 text-muted">Os arquivos que você enviar ficam disponíveis para novos rascunhos.</p> : <div className="grid max-h-36 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
                {assets.map((asset) => <div key={asset.id} className="group relative">
                  <button type="button" onClick={() => toggleSelectedAsset(asset.id)} aria-label={`${selectedAssetIds.includes(asset.id) ? "Remover da seleção" : "Selecionar"} ${asset.fileName}`} aria-pressed={selectedAssetIds.includes(asset.id)} className={`relative aspect-square w-full overflow-hidden rounded-lg bg-sidebar ${selectedAssetIds.includes(asset.id) ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""}`}>
                    {asset.publicUrl && asset.contentType.startsWith("video/") ? <video src={asset.publicUrl} className="h-full w-full object-cover" muted playsInline /> : asset.publicUrl ? <img src={asset.publicUrl} alt={asset.fileName} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-[10px] text-muted">Prévia indisponível</span>}
                    {asset.contentType.startsWith("video/") && <span className="absolute bottom-1 left-1 rounded bg-foreground/80 px-1.5 py-0.5 text-[9px] font-semibold text-white">REEL</span>}
                    {selectedAssetIds.includes(asset.id) && <span className="absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{selectedAssetIds.indexOf(asset.id) + 1}</span>}
                  </button>
                  <button type="button" onClick={() => void deleteAsset(asset)} title="Remover da biblioteca" className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-foreground/80 text-white opacity-0 transition-opacity hover:bg-error group-hover:opacity-100 focus:opacity-100" aria-label={`Remover ${asset.fileName}`}><InterfaceIcon name="close" size={14} /></button>
                </div>)}
              </div>}
            </div>
          </div>
          {pendingUpload && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/15 bg-warning/5 px-3.5 py-3"><div className="min-w-0"><p className="truncate text-xs font-semibold">Envio interrompido: {pendingUpload.file.name}</p><p className="mt-1 text-[11px] text-muted">O arquivo continua nesta sessão. Você pode retomar de onde parou.</p></div><div className="flex shrink-0 gap-2"><button type="button" disabled={busy} onClick={() => void resumeUpload()} className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50">Retomar</button><button type="button" disabled={busy} onClick={() => void cancelUpload()} className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-muted hover:bg-surface disabled:opacity-50">Cancelar</button></div></div>}
          <p className="mt-3 text-[11px] leading-5 text-muted">Reels: MP4 ou MOV, até 1 GB, 3 segundos a 15 minutos e largura máxima de 1.920 px. Em carrosséis, prefira mídias com o mesmo enquadramento.</p>
          {selectedAssets.length > 0 && <div className="mt-3 space-y-1.5 text-xs text-muted"><p className="font-medium text-foreground">{isCarousel ? `${selectedAssets.length} de 10 mídias selecionadas` : "Mídia selecionada"}</p>{selectedAssets.map((asset, index) => <p key={asset.id} className="truncate">{isCarousel ? `${index + 1}. ` : ""}{asset.fileName} · {formatBytes(asset.byteSize)} · {asset.contentType.startsWith("video/") ? "Vídeo" : "Foto"}</p>)}</div>}
        </section>

        <section className="panel p-5 sm:p-6">
          <div><p className="text-xs font-medium text-muted">02 · Conteúdo</p><h2 className="mt-1 font-display text-[22px] font-bold tracking-[-0.015em]">Escreva a legenda</h2></div>
          <label className="mt-4 block">
            <span className="sr-only">Legenda</span>
            <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, 2200))} maxLength={2200} rows={7} placeholder="O que você quer contar?" className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-foreground placeholder:text-muted/70" />
            <span className="mt-1.5 flex justify-end text-xs tabular-nums text-muted">{caption.length.toLocaleString("pt-BR")} / 2.200</span>
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-background px-3 py-3 opacity-80"><p className="text-sm font-medium">Adicionar colaboradores</p><p className="mt-1 text-xs leading-5 text-muted">Indisponível nesta conexão do Instagram.</p></div>
            <div className="rounded-xl border border-border bg-background px-3 py-3 opacity-80"><p className="text-sm font-medium">Marcar localização</p><p className="mt-1 text-xs leading-5 text-muted">Indisponível nesta conexão do Instagram.</p></div>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">A conexão atual usa Instagram Login. A API da Meta não aceita marcar pessoas ou locais nesse fluxo.</p>
          {!isCarousel && selectedAsset?.contentType.startsWith("video/") && <div className="mt-4 space-y-3 rounded-xl bg-background px-3.5 py-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={trialGraduationStrategy !== null}
                disabled={Boolean(account?.trialReelsUnsupportedAt) && trialGraduationStrategy === null}
                onChange={(event) => {
                  setTrialGraduationStrategy(event.target.checked ? "MANUAL" : null);
                  // A trial Reel forces "not in the feed"; leaving trial mode
                  // puts the Reel back on the grid, as a fresh one would be.
                  if (!event.target.checked) setShareToFeed(true);
                }}
                className="mt-0.5 accent-accent disabled:opacity-50"
              />
              <span><span className="block text-sm font-medium">Publicar como Reel de teste</span><span className="mt-0.5 block text-xs leading-5 text-muted">O Instagram testa o Reel com pessoas que ainda não seguem a conta. Ele não entra no feed inicialmente.</span>
                {account?.trialReelsUnsupportedAt && <span className="mt-1.5 block rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs leading-5 text-warning">A Meta ainda não liberou Reels de teste para @{account.username}. Publique como Reel normal; quando a opção aparecer no app do Instagram, ela volta a funcionar aqui.</span>}
              </span>
            </label>
            {trialGraduationStrategy ? <label className="block pl-6"><span className="mb-1.5 block text-xs font-semibold text-muted">Como o Reel será compartilhado depois?</span><select value={trialGraduationStrategy} onChange={(event) => setTrialGraduationStrategy(event.target.value as TrialReelGraduationStrategy)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"><option value="MANUAL">Manual: eu decido depois</option><option value="SS_PERFORMANCE">Automático, se o desempenho for bom</option></select><span className="mt-1.5 block text-[11px] leading-5 text-muted">Na opção automática, a Meta decide se compartilha o Reel com todos. A disponibilidade depende da conta.</span></label> : <label className="flex cursor-pointer items-start gap-3 border-t border-border pt-3">
              <input type="checkbox" checked={shareToFeed} onChange={(event) => setShareToFeed(event.target.checked)} className="mt-0.5 accent-accent" />
              <span><span className="block text-sm font-medium">Mostrar também no feed</span><span className="mt-0.5 block text-xs leading-5 text-muted">Desmarque para publicar o Reel sem adicioná-lo à grade do perfil.</span></span>
            </label>}
          </div>}
          {!editingId && <label className="mt-4 block"><span className="mb-1.5 block text-xs font-semibold text-muted">Vincular campanha de DM (opcional)</span><select value={automationId} onChange={(event) => setAutomationId(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="">Sem campanha vinculada</option>{automations.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isActive ? "" : " · pausada"}</option>)}</select><span className="mt-1.5 block text-[11px] leading-5 text-muted">Depois da publicação, o post será associado à campanha para manter os comentários e as DMs ligados ao conteúdo.</span></label>}
        </section>

        <section className="panel p-5 sm:p-6">
          <div><p className="text-xs font-medium text-muted">03 · Horário</p><h2 className="mt-1 font-display text-[22px] font-bold tracking-[-0.015em]">Escolha quando publicar</h2></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted">Data e horário</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label>
            <div className="rounded-xl bg-background px-3 py-2.5"><span className="block text-xs font-semibold">Fuso horário</span><span className="mt-1 block truncate text-xs text-muted">{timezone()}</span></div>
            {editingId && <button type="button" onClick={() => resetEditor()} className="h-10 rounded-xl border border-border px-4 text-sm font-medium text-muted hover:bg-background">Sair da edição</button>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2.5 border-t border-border pt-4">
            <button type="button" disabled={busy} onClick={() => void savePost("DRAFT")} className="h-10 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-hover disabled:opacity-60">Salvar rascunho</button>
            <button type="button" disabled={busy || !account?.publishingPermissionGranted} onClick={() => void savePost("NOW")} className="h-10 rounded-xl px-4 text-sm font-semibold text-muted hover:bg-background disabled:opacity-50">Publicar agora</button>
            <button type="submit" disabled={busy || !account?.publishingPermissionGranted} className="ml-auto h-10 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-sm hover:bg-accent-hover disabled:opacity-50">{busy ? "Salvando…" : editingId ? "Salvar agendamento" : "Agendar publicação"}</button>
          </div>
        </section>
      </form>

      <aside className="space-y-5 xl:sticky xl:top-24">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div><p className="text-xs font-medium text-muted">Prévia</p><h2 className="mt-0.5 text-sm font-semibold">Como vai aparecer</h2></div>
            <div className="flex rounded-lg bg-background p-1"><button type="button" onClick={() => setPreviewMode("post")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${previewMode === "post" ? "bg-surface text-foreground shadow-sm" : "text-muted"}`}>Publicação</button><button type="button" onClick={() => setPreviewMode("profile")} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${previewMode === "profile" ? "bg-surface text-foreground shadow-sm" : "text-muted"}`}>Grade</button></div>
          </div>
          {previewMode === "post" ? <div className="p-4 sm:p-5">
            <div className="mx-auto max-w-[430px] overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex items-center gap-2.5 px-3 py-3"><Avatar username={account?.username ?? "?"} url={profile?.profilePictureUrl} /><div className="min-w-0"><p className="truncate text-xs font-semibold">{account ? `@${account.username}` : "Sua conta"}</p><p className="text-[10px] text-muted">{isCarousel ? `Carrossel · ${selectedAssets.length} itens` : selectedAsset?.contentType.startsWith("video/") ? "Reel" : "Publicação"}</p></div><span className="ml-auto text-muted">•••</span></div>
              <div className="relative aspect-[3/4] bg-sidebar">{previewAsset?.publicUrl ? previewAsset.contentType.startsWith("video/") ? <video src={previewAsset.publicUrl} className="h-full w-full object-cover" muted playsInline controls /> : <img src={previewAsset.publicUrl} alt="Prévia da publicação" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center px-8 text-center text-sm leading-6 text-muted">Sua mídia aparece aqui depois que você selecionar um arquivo.</div>}
                {isCarousel && selectedAssets.length > 1 && <><button type="button" aria-label="Mídia anterior" onClick={() => setCarouselPreviewIndex((index) => (index - 1 + selectedAssets.length) % selectedAssets.length)} className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-foreground shadow">‹</button><button type="button" aria-label="Próxima mídia" onClick={() => setCarouselPreviewIndex((index) => (index + 1) % selectedAssets.length)} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-foreground shadow">›</button><span className="absolute right-2 top-2 rounded-full bg-foreground/75 px-2 py-1 text-[10px] font-semibold text-white">{Math.min(carouselPreviewIndex + 1, selectedAssets.length)} / {selectedAssets.length}</span></>}
              </div>
              <div className="px-3 pb-3 pt-2.5"><div className="flex gap-3 text-lg"><span>♡</span><span>◯</span><span>⌁</span><span className="ml-auto">▱</span></div><p className="mt-2 line-clamp-3 text-xs leading-5"><strong className="font-semibold">{account?.username ?? "conta"}</strong>{caption ? ` ${caption}` : <span className="text-muted"> Sua legenda vai aparecer aqui.</span>}</p></div>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-background px-3.5 py-3"><span className="text-xs font-medium text-muted">{editingId ? "Agendamento" : "Horário previsto"}</span><span className="text-xs font-semibold">{scheduledAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(scheduledAt)) : "Ainda não definido"}</span></div>
          </div> : <div className="p-4 sm:p-5">
            <div className="mx-auto max-w-[430px] rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-3"><Avatar username={account?.username ?? "?"} url={profile?.profilePictureUrl} large /><div><p className="text-sm font-semibold">@{profile?.username ?? account?.username ?? "instagram"}</p><p className="text-xs text-muted">{instagramPosts.length.toLocaleString("pt-BR")} publicações</p></div></div>
              <div className="mt-4 grid grid-cols-3 gap-1.5">
                {[
                  { id: "draft-preview", url: selectedAsset?.publicUrl ?? null, kind: isCarousel ? "Carrossel" : selectedAsset?.contentType.startsWith("video/") ? "Reel" : "Novo" },
                  ...previewItems,
                ].map((item) => {
                  const isDraft = item.id === "draft-preview";
                  const isCarouselTile = item.kind === "Carrossel" || (isDraft && isCarousel);
                  return (
                    <div key={item.id} className="relative aspect-[3/4] overflow-hidden rounded-lg bg-sidebar">
                      {item.url ? <img src={item.url} alt={item.kind} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center px-1 text-center text-[10px] text-muted">Sem prévia</div>}
                      {isDraft && <span className="absolute bottom-1 left-1 rounded bg-foreground/80 px-1.5 py-0.5 text-[9px] font-semibold text-white">PRÓXIMO</span>}
                      {isCarouselTile && <span className="absolute right-1 top-1 rounded bg-foreground/80 px-1.5 py-1 text-[8px] font-semibold leading-none text-white">CARROSSEL</span>}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-center text-[11px] leading-5 text-muted">Prévia aproximada. O Instagram pode exibir cortes diferentes no perfil.</p>
            </div>
          </div>}
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted">Fila de conteúdo</p><h2 className="mt-1 text-base font-semibold">Próximas publicações</h2></div><Link href="/feed" className="text-xs font-semibold text-accent hover:underline">Ver planejador</Link></div>
          {loading ? <div className="mt-5 space-y-3"><div className="h-14 animate-pulse rounded-xl bg-background" /><div className="h-14 animate-pulse rounded-xl bg-background" /></div> : accountPosts.filter((post) => ["SCHEDULED", "PUBLISHING", "FAILED", "DRAFT"].includes(post.status)).length === 0 ? <div className="mt-4 rounded-xl bg-background px-4 py-5 text-center"><p className="text-sm font-medium">Sua fila está vazia</p><p className="mt-1 text-xs text-muted">Rascunhos e agendamentos aparecerão aqui.</p></div> : <div className="mt-4 space-y-2">
            {accountPosts.filter((post) => ["SCHEDULED", "PUBLISHING", "FAILED", "DRAFT"].includes(post.status)).sort((a, b) => (a.scheduledAt ? Date.parse(a.scheduledAt) : Infinity) - (b.scheduledAt ? Date.parse(b.scheduledAt) : Infinity)).slice(0, 7).map((post) => <article key={post.id} className="flex items-center gap-3 rounded-xl bg-background p-2.5">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-sidebar">{post.mediaUrl ? post.mediaType === "REEL" ? <video src={post.mediaUrl} className="h-full w-full object-cover" muted playsInline /> : <img src={post.mediaUrl} alt={post.mediaAsset.fileName} className="h-full w-full object-cover" /> : null}</div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(post.status)}`}>{statusLabel(post.status)}</span><span className="text-[10px] text-muted">{post.mediaType === "CAROUSEL" ? "Carrossel" : post.mediaType === "REEL" ? "Reel" : "Foto"}</span></div><p className="mt-1 truncate text-xs font-medium">{post.caption || post.mediaAsset.fileName}</p><p className="mt-0.5 text-[10px] text-muted">{formatDateTime(post.scheduledAt, post.timeZone)}</p>{post.status === "FAILED" && post.lastError && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-error" title={post.lastError}>{post.lastError}</p>}</div>
              <div className="flex shrink-0 flex-col gap-1">{["DRAFT", "SCHEDULED"].includes(post.status) && <button type="button" onClick={() => editPost(post)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/5">Editar</button>}{post.status === "FAILED" && <button type="button" onClick={() => void retryPost(post)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/5">Tentar de novo</button>}{["DRAFT", "SCHEDULED", "FAILED"].includes(post.status) && <button type="button" onClick={() => void cancelPost(post)} className="rounded-md px-2 py-1 text-[10px] font-medium text-muted hover:bg-surface">{post.status === "DRAFT" ? "Excluir" : "Cancelar"}</button>}</div>
            </article>)}
          </div>}
        </section>
      </aside>
    </div>
  </div>;
}

function Avatar({ username, url, large = false }: { username: string; url?: string | null; large?: boolean }) {
  const size = large ? "h-12 w-12" : "h-8 w-8";
  return url ? <img src={url} alt={`Foto do perfil de @${username}`} className={`${size} shrink-0 rounded-xl object-cover`} /> : <span className={`${size} grid shrink-0 place-items-center rounded-xl bg-accent/10 text-xs font-bold text-accent`}>{username.slice(0, 1).toUpperCase()}</span>;
}

function CalendarIcon() { return <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M12 14v3l2 1" /></svg>; }
function GridIcon() { return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>; }
function UploadIcon() { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0L7 9m5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>; }
