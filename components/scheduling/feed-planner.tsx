"use client";

/* eslint-disable @next/next/no-img-element -- Instagram media hosts vary by account and are returned by Meta. */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import InterfaceIcon from "@/components/interface-icon";
import {
  apiRequest,
  formatDateTime,
  localDayKey,
  type InstagramAccountOption,
  type InstagramMediaItem,
  type InstagramProfile,
  type ScheduledPost,
} from "@/components/scheduling/shared";

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

interface PlannedTile {
  id: string;
  url: string | null;
  date: string;
  type: string;
  caption: string;
  isCarousel: boolean;
  isVideo: boolean;
  isReel: boolean;
}

function monthTitle(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}

function calendarCells(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const total = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length: total }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1));
}

function dayName(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function movedOrder(ids: string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const other = index + direction;
  if (index < 0 || other < 0 || other >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[other]] = [next[other], next[index]];
  return next;
}

export default function FeedPlanner() {
  const [accounts, setAccounts] = useState<InstagramAccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [instagramPosts, setInstagramPosts] = useState<InstagramMediaItem[]>([]);
  const [profile, setProfile] = useState<InstagramProfile | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => localDayKey(new Date()));
  const [reorderState, setReorderState] = useState<{ day: string; ids: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const account = accounts.find((item) => item.id === accountId) ?? null;
  const scheduled = posts.filter((post) => post.instagramAccountId === accountId && post.status === "SCHEDULED" && post.scheduledAt);
  const published = posts.filter((post) => post.instagramAccountId === accountId && post.status === "PUBLISHED");
  const cells = useMemo(() => calendarCells(month), [month]);
  const scheduledByDay = useMemo(() => {
    const result = new Map<string, ScheduledPost[]>();
    for (const post of scheduled) {
      const key = localDayKey(new Date(post.scheduledAt!));
      const current = result.get(key) ?? [];
      current.push(post);
      result.set(key, current);
    }
    for (const dayPosts of result.values()) dayPosts.sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
    return result;
  }, [scheduled]);
  const dayPosts = useMemo(() => scheduledByDay.get(selectedDay) ?? [], [scheduledByDay, selectedDay]);
  const reorderIds = reorderState?.day === selectedDay && reorderState.ids.length === dayPosts.length && reorderState.ids.every((id) => dayPosts.some((post) => post.id === id))
    ? reorderState.ids
    : dayPosts.map((post) => post.id);
  const selectedDayPosts = useMemo(() => {
    const byId = new Map(dayPosts.map((post) => [post.id, post]));
    return reorderIds.map((id) => byId.get(id)!).filter(Boolean);
  }, [dayPosts, reorderIds]);
  const profileTiles = useMemo<PlannedTile[]>(() => {
    const apiMediaIds = new Set(instagramPosts.map((post) => post.id));
    return [
      ...scheduled
        .filter((post) => post.shareToFeed || post.mediaType !== "REEL")
        .map((post) => ({ id: `scheduled-${post.id}`, url: post.mediaUrl ?? null, date: post.scheduledAt!, type: post.mediaType === "CAROUSEL" ? "Carrossel agendado" : post.mediaType === "REEL" ? "Reel agendado" : "Foto agendada", caption: post.caption, isCarousel: post.mediaType === "CAROUSEL", isVideo: post.mediaAsset.contentType.startsWith("video/"), isReel: post.mediaType === "REEL" })),
      ...published
        .filter((post) => (post.shareToFeed || post.mediaType !== "REEL") && (!post.instagramMediaId || !apiMediaIds.has(post.instagramMediaId)))
        .map((post) => ({ id: `published-${post.id}`, url: post.mediaUrl ?? null, date: post.publishedAt ?? post.createdAt, type: post.mediaType === "CAROUSEL" ? "Carrossel publicado" : post.mediaType === "REEL" ? "Reel publicado" : "Foto publicada", caption: post.caption, isCarousel: post.mediaType === "CAROUSEL", isVideo: post.mediaAsset.contentType.startsWith("video/"), isReel: post.mediaType === "REEL" })),
      ...instagramPosts.map((post) => ({
        id: `instagram-${post.id}`,
        url: post.media_type === "VIDEO" ? post.thumbnail_url ?? post.media_url ?? null : post.media_url ?? null,
        date: post.timestamp,
        type: post.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : post.media_type === "VIDEO" || post.media_product_type === "REELS" ? "Reel" : "Publicação",
        caption: post.caption ?? "",
        isCarousel: post.media_type === "CAROUSEL_ALBUM",
        // Meta's thumbnail is an image; only fall back to the video itself.
        isVideo: post.media_type === "VIDEO" && !post.thumbnail_url,
        isReel: post.media_type === "VIDEO" || post.media_product_type === "REELS",
      })),
    ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 15);
  }, [instagramPosts, published, scheduled]);
  const profilePostCount = useMemo(() => {
    const apiMediaIds = new Set(instagramPosts.map((post) => post.id));
    return instagramPosts.length
      + scheduled.filter((post) => post.shareToFeed || post.mediaType !== "REEL").length
      + published.filter((post) => (post.shareToFeed || post.mediaType !== "REEL") && (!post.instagramMediaId || !apiMediaIds.has(post.instagramMediaId))).length;
  }, [instagramPosts, published, scheduled]);

  useEffect(() => {
    let active = true;
    apiRequest<{ instagramAccounts: InstagramAccountOption[]; selectedInstagramAccountId: string | null }>("/api/instagram/accounts")
      .then((data) => {
        if (!active) return;
        setAccounts(data.instagramAccounts);
        setAccountId(data.selectedInstagramAccountId ?? "");
        if (!data.selectedInstagramAccountId) setLoading(false);
      })
      .catch((reason: unknown) => {
        if (active) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar as contas."); setLoading(false); }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    apiRequest<ScheduledPost[]>(`/api/scheduled-posts?instagramAccountId=${encodeURIComponent(accountId)}`).then(async (scheduledPosts) => {
      if (!active) return;
      setPosts((current) => [...current.filter((post) => post.instagramAccountId !== accountId), ...scheduledPosts]);
      const [feedResult, profileResult] = await Promise.allSettled([
        apiRequest<InstagramMediaItem[]>(`/api/instagram/posts?instagramAccountId=${encodeURIComponent(accountId)}&all=true`),
        apiRequest<InstagramProfile>(`/api/instagram/profile?instagramAccountId=${encodeURIComponent(accountId)}`),
      ]);
      if (!active) return;
      setInstagramPosts(feedResult.status === "fulfilled" ? feedResult.value : []);
      setProfile(profileResult.status === "fulfilled" ? profileResult.value : null);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (active) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar o planejador."); setLoading(false); }
    });
    return () => { active = false; };
  }, [accountId]);

  const calendarDaysWithItems = scheduledByDay.get(selectedDay) ?? [];
  const todayKey = localDayKey(new Date());

  // Reels queued without "show in feed" only land in the Reels tab, so the grid
  // preview leaves them out. Say so, and offer the one-click fix.
  const hiddenReels = scheduled.filter((post) => post.mediaType === "REEL" && !post.shareToFeed && !post.trialGraduationStrategy);

  async function showReelsInFeed() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/scheduled-posts/share-to-feed`, {
        method: "POST",
        body: JSON.stringify({ ids: hiddenReels.map((post) => post.id) }),
      });
      const freshPosts = await apiRequest<ScheduledPost[]>(`/api/scheduled-posts?instagramAccountId=${encodeURIComponent(accountId)}`);
      setPosts((current) => [...current.filter((post) => post.instagramAccountId !== accountId), ...freshPosts]);
      setNotice("Os Reels agendados agora também vão aparecer na grade do perfil.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar os Reels.");
    } finally { setSaving(false); }
  }

  async function saveOrder() {
    if (reorderIds.length < 2) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/scheduled-posts/reorder`, {
        method: "POST",
        body: JSON.stringify({ instagramAccountId: accountId, ids: reorderIds }),
      });
      const freshPosts = await apiRequest<ScheduledPost[]>(`/api/scheduled-posts?instagramAccountId=${encodeURIComponent(accountId)}`);
      setPosts((current) => [...current.filter((post) => post.instagramAccountId !== accountId), ...freshPosts]);
      setNotice("A ordem e os horários da fila foram atualizados.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a ordem do feed.");
    } finally { setSaving(false); }
  }

  if (accounts.length === 0 && !loading) {
    return <section className="panel mx-auto max-w-3xl px-6 py-12 text-center sm:px-10"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent"><CalendarIcon /></span><h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">Organize o próximo mês</h1><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Conecte uma conta profissional do Instagram para ver seu perfil e planejar a grade.</p><a href="/api/instagram/connect" className="mt-6 inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover">Conectar Instagram</a></section>;
  }

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Planejamento</p><h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Feed</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Veja o que já foi publicado, confira as próximas datas e ajuste a ordem das publicações agendadas.</p></div>
      <div className="flex flex-wrap items-center gap-2"><select value={accountId} onChange={(event) => { setLoading(true); setError(""); setNotice(""); setInstagramPosts([]); setProfile(null); setAccountId(event.target.value); }} aria-label="Conta do Instagram" className="min-w-44 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium">{accounts.map((item) => <option key={item.id} value={item.id}>@{item.username}</option>)}</select><Link href="/schedule" className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"><span className="text-lg leading-none">+</span> Agendar post</Link></div>
    </header>

    {error && <div role="alert" className="rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">{notice}</div>}

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(330px,0.72fr)_minmax(0,1.28fr)]">
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-medium text-muted">Agenda de conteúdo</p>
            <h2 className="mt-0.5 font-display text-[22px] font-bold tracking-[-0.015em]">
              {monthTitle(month)}
            </h2>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              aria-label="Mês anterior"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:bg-background"
            >
              <InterfaceIcon name="chevron-left" size={16} />
            </button>
            <button
              type="button"
              onClick={() => { setMonth(new Date()); setSelectedDay(todayKey); }}
              className="rounded-lg border border-border px-2.5 text-xs font-semibold text-muted hover:bg-background"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              aria-label="Próximo mês"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:bg-background"
            >
              <InterfaceIcon name="chevron-right" size={16} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-border px-2 py-2">{DAYS.map((day) => <span key={day} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted">{day}</span>)}</div>
        <div className="grid grid-cols-7 gap-y-1 p-2">
          {cells.map((date) => {
            const key = localDayKey(date);
            const inMonth = date.getMonth() === month.getMonth();
            const isSelected = key === selectedDay;
            const count = scheduledByDay.get(key)?.length ?? 0;
            const isToday = key === todayKey;
            return <button key={key} type="button" onClick={() => { setSelectedDay(key); if (!inMonth) setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }} aria-label={`${dayName(date)}${count ? `, ${count} agendado${count === 1 ? "" : "s"}` : ""}`} aria-pressed={isSelected} className={`relative flex min-h-[54px] flex-col items-center justify-center rounded-lg text-sm transition-colors ${isSelected ? "bg-accent text-white" : inMonth ? "text-foreground hover:bg-background" : "text-muted/40 hover:bg-background"}`}><span className={`grid h-7 w-7 place-items-center rounded-full ${isToday && !isSelected ? "border border-accent text-accent" : ""}`}>{date.getDate()}</span>{count > 0 && <span className={`mt-0.5 text-[9px] font-semibold ${isSelected ? "text-white/80" : "text-accent"}`}>{count} {count === 1 ? "post" : "posts"}</span>}</button>;
          })}
        </div>
        <div className="border-t border-border px-5 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium text-muted">Dia selecionado</p><h3 className="mt-1 text-sm font-semibold capitalize">{dayName(new Date(`${selectedDay}T12:00:00`))}</h3></div>{calendarDaysWithItems.length > 0 && <span className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-accent">{calendarDaysWithItems.length} agendado{calendarDaysWithItems.length === 1 ? "" : "s"}</span>}</div>
          {loading ? <div className="mt-4 h-16 animate-pulse rounded-xl bg-background" /> : calendarDaysWithItems.length === 0 ? <div className="mt-4 rounded-xl bg-background px-4 py-4"><p className="text-sm font-medium">Sem publicações para este dia</p><p className="mt-1 text-xs leading-5 text-muted">Escolha outra data ou crie um novo agendamento.</p></div> : <div className="mt-4 space-y-2">
            {selectedDayPosts.map((post, index) => (
              <article key={post.id} className="flex items-center gap-2.5 rounded-xl bg-background p-2.5">
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-sidebar">
                  {post.mediaUrl ? post.mediaType === "REEL" ? (
                    <video src={post.mediaUrl} className="h-full w-full object-cover" muted playsInline />
                  ) : (
                    <img src={post.mediaUrl} alt={post.mediaAsset.fileName} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{post.caption || post.mediaAsset.fileName}</p>
                  <p className="mt-1 text-[10px] text-muted">{formatDateTime(post.scheduledAt, post.timeZone)} · {post.mediaType === "CAROUSEL" ? "Carrossel" : post.mediaType === "REEL" ? "Reel" : "Foto"}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={index === 0 || saving}
                    onClick={() => setReorderState({ day: selectedDay, ids: movedOrder(reorderIds, post.id, -1) })}
                    aria-label={`Mover ${post.mediaAsset.fileName} para cima`}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted hover:bg-surface disabled:opacity-30"
                  >
                    <InterfaceIcon name="arrow-up" size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={index === selectedDayPosts.length - 1 || saving}
                    onClick={() => setReorderState({ day: selectedDay, ids: movedOrder(reorderIds, post.id, 1) })}
                    aria-label={`Mover ${post.mediaAsset.fileName} para baixo`}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted hover:bg-surface disabled:opacity-30"
                  >
                    <InterfaceIcon name="arrow-down" size={15} />
                  </button>
                </div>
              </article>
            ))}
            <p className="px-1 pt-1 text-[11px] leading-5 text-muted">Use as setas para trocar os horários entre as publicações deste dia.</p><button type="button" disabled={saving || reorderIds.length < 2 || reorderIds.every((id, index) => id === (scheduledByDay.get(selectedDay) ?? [])[index]?.id)} onClick={() => void saveOrder()} className="mt-1 h-10 w-full rounded-xl bg-accent text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45">{saving ? "Salvando ordem…" : "Salvar ordem do dia"}</button>
          </div>}
        </div>
      </section>

      <div className="space-y-6">
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><p className="text-xs font-medium text-muted">Prévia do perfil</p><h2 className="mt-0.5 text-base font-semibold">Assim a grade pode ficar</h2></div><span className="text-xs text-muted">Atualizada com as publicações agendadas</span></div>
          <div className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-3"><ProfileAvatar username={profile?.username ?? account?.username ?? "?"} url={profile?.profilePictureUrl} /><div className="min-w-0"><p className="truncate text-sm font-semibold">@{profile?.username ?? account?.username ?? "instagram"}</p><p className="truncate text-xs text-muted">{profile?.name ?? "Perfil do Instagram"}</p></div><span className="ml-auto rounded-lg bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted">{profilePostCount} posts</span></div>
            {hiddenReels.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-warning/10 px-4 py-3 text-xs leading-5 text-warning"><p className="min-w-0 flex-1"><span className="font-semibold">{hiddenReels.length === 1 ? "1 Reel agendado não vai aparecer na grade" : `${hiddenReels.length} Reels agendados não vão aparecer na grade`}</span>, só na aba Reels do perfil, porque estão sem “Mostrar também no feed”.</p><button type="button" disabled={saving} onClick={() => void showReelsInFeed()} className="shrink-0 rounded-[10px] bg-foreground px-3.5 py-2 text-xs font-semibold text-white hover:bg-foreground/90 disabled:opacity-50">Mostrar no feed</button></div>}
            {loading ? <div className="grid grid-cols-3 gap-2 sm:gap-3">{Array.from({ length: 9 }, (_, index) => <div key={index} className="aspect-[3/4] animate-pulse rounded-lg bg-background" />)}</div> : profileTiles.length === 0 ? <div className="rounded-xl bg-background px-5 py-9 text-center"><p className="text-sm font-medium">Ainda não há publicações para pré-visualizar</p><p className="mt-1 text-xs text-muted">Os próximos posts aparecem aqui assim que forem agendados.</p></div> : <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">{profileTiles.map((item) => <article key={item.id} className="group relative aspect-[3/4] overflow-hidden rounded-lg bg-sidebar">
              {item.url ? <MediaThumb url={item.url} isVideo={item.isVideo} alt={item.caption ? item.caption.slice(0, 120) : item.type} className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025] ${item.id.startsWith("scheduled-") ? "brightness-[0.88]" : ""}`} /> : <div className="grid h-full place-items-center px-2 text-center text-[10px] text-muted">Prévia indisponível</div>}
              {item.isReel && !item.isCarousel && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded bg-foreground/70 text-white" title="Reel"><ReelIcon /></span>}
              {item.id.startsWith("scheduled-") && <span className="absolute left-1.5 top-1.5 rounded bg-surface/90 px-1.5 py-1 text-[9px] font-semibold text-accent">AGENDADO</span>}
              {item.isCarousel && <span className="absolute right-1.5 top-1.5 rounded bg-foreground/80 px-1.5 py-1 text-[8px] font-semibold leading-none text-white">CARROSSEL</span>}
              <div className="absolute inset-x-0 bottom-0 translate-y-full bg-foreground/80 px-2 py-1.5 text-white transition-transform group-hover:translate-y-0"><p className="truncate text-[10px] font-medium">{new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(new Date(item.date))} · {item.type}</p></div>
            </article>)}</div>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" />Agendado</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-border-hover" />Publicado</span><span className="ml-auto">Prévia dos últimos 15 posts</span></div>
          </div>
        </section>

        <section className="panel p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted">Próximas datas</p><h2 className="mt-1 text-base font-semibold">Publicações na fila</h2></div><Link href="/schedule" className="text-xs font-semibold text-accent hover:underline">Criar publicação</Link></div>{scheduled.length === 0 ? <div className="mt-4 rounded-xl bg-background px-4 py-5 text-center"><p className="text-sm font-medium">Nenhuma publicação agendada</p><p className="mt-1 text-xs text-muted">A próxima data vai aparecer nesta lista.</p></div> : <div className="mt-4 divide-y divide-border">{scheduled.slice().sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!)).slice(0, 8).map((post) => <div key={post.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="relative aspect-[3/4] w-10 shrink-0 overflow-hidden rounded-lg bg-sidebar">{post.mediaUrl ? <MediaThumb url={post.mediaUrl} isVideo={post.mediaAsset.contentType.startsWith("video/")} alt="" className="h-full w-full object-cover" /> : null}{post.mediaType === "REEL" && <span className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded bg-foreground/70 text-white"><ReelIcon size={9} /></span>}</span><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><span className="text-center"><span className="block text-[9px] font-semibold uppercase leading-none">{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(post.scheduledAt!)).replace(".", "")}</span><span className="mt-1 block text-sm font-bold leading-none">{new Date(post.scheduledAt!).getDate()}</span></span></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{post.caption || post.mediaAsset.fileName}</p><p className="mt-1 text-[10px] text-muted">{formatDateTime(post.scheduledAt, post.timeZone)}</p></div><span className="flex shrink-0 flex-col items-end gap-1"><span className="rounded-md bg-background px-2 py-1 text-[10px] font-medium text-muted">{post.mediaType === "CAROUSEL" ? "Carrossel" : post.mediaType === "REEL" ? post.trialGraduationStrategy ? "Reel de teste" : "Reel" : "Foto"}</span>{post.mediaType === "REEL" && !post.shareToFeed && !post.trialGraduationStrategy && <span className="rounded-md bg-warning/10 px-2 py-1 text-[10px] font-medium text-warning">Só na aba Reels</span>}</span></div>)}</div>}</section>
      </div>
    </div>
  </div>;
}

function ProfileAvatar({ username, url }: { username: string; url?: string | null }) {
  return url ? <img src={url} alt={`Foto de @${username}`} className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/10 text-sm font-bold text-accent">{username.slice(0, 1).toUpperCase()}</span>;
}

function CalendarIcon() { return <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>; }

/** First frame of a video stands in for a thumbnail until Meta generates one. */
function MediaThumb({ url, isVideo, alt, className }: { url: string; isVideo: boolean; alt: string; className: string }) {
  return isVideo
    ? <video src={`${url}#t=0.1`} preload="metadata" muted playsInline aria-label={alt || undefined} className={className} />
    : <img src={url} alt={alt} className={className} />;
}

function ReelIcon({ size = 12 }: { size?: number }) { return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>; }
