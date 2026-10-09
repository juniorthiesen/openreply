"use client";

/* eslint-disable @next/next/no-img-element -- Saved Story media comes from the protected media route. */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiRequest, formatDateTime, type InstagramAccountOption } from "@/components/scheduling/shared";

interface ExternalStoryItem {
  id: string;
  instagramMediaId: string;
  username: string;
  mediaType: string | null;
  caption: string | null;
  permalink: string | null;
  postedAt: string;
  firstSeenAt: string;
  lastCapturedAt: string | null;
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  follows: number | null;
  profileVisits: number | null;
  totalInteractions: number | null;
  hasMedia: boolean;
  mediaContentType: string | null;
  mediaUrl: string | null;
  mediaExpiresAt: string | null;
  mediaPurged: boolean;
}

interface ExternalStoriesPayload {
  stories: ExternalStoryItem[];
  total: number;
  retentionDays: number;
}

const number = (value: number | null) => (value === null ? "—" : value.toLocaleString("pt-BR"));
const sum = (items: ExternalStoryItem[], pick: (item: ExternalStoryItem) => number | null) =>
  items.reduce((total, item) => total + (pick(item) ?? 0), 0);

function MediaPreview({ story }: { story: ExternalStoryItem }) {
  if (story.hasMedia && story.mediaUrl) {
    return story.mediaContentType?.startsWith("video/") ? (
      <video src={story.mediaUrl} controls preload="metadata" className="h-full w-full object-cover" />
    ) : (
      <img src={story.mediaUrl} alt={`Story de @${story.username}`} className="h-full w-full object-cover" />
    );
  }
  return (
    <div className="grid h-full w-full place-items-center px-4 text-center text-xs text-muted">
      {story.mediaPurged ? "Mídia apagada após o prazo de guarda. As métricas continuam salvas." : "Mídia não disponível."}
    </div>
  );
}

export default function ExternalStories() {
  const [accounts, setAccounts] = useState<InstagramAccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [payload, setPayload] = useState<ExternalStoriesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<{ instagramAccounts: InstagramAccountOption[] }>("/api/instagram/stories/accounts")
      .then((data) => { if (mounted) setAccounts(data.instagramAccounts); })
      .catch(() => { /* The list still works without the account filter. */ });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
    apiRequest<ExternalStoriesPayload>(`/api/instagram/stories/external${query}`)
      .then((data) => { if (mounted) { setPayload(data); setError(null); } })
      .catch((loadError) => { if (mounted) setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os Stories."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [accountId]);

  function changeAccount(nextAccountId: string) {
    setLoading(true);
    setAccountId(nextAccountId);
  }

  const stories = useMemo(() => payload?.stories ?? [], [payload]);
  const retentionDays = payload?.retentionDays ?? 7;
  const csvHref = `/api/instagram/stories/external?format=csv${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
      <header className="mb-7 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-muted">
            <Link href="/stories" className="hover:text-accent">FISGA / Publicação / Stories</Link>
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground">Stories de fora do Fisga</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Stories que você postou direto no Instagram. A Fisga guarda os dados e as métricas enquanto eles estão no ar, porque depois de 24 horas a Meta deixa de entregá-los.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="external-account">Conta do Instagram</label>
          <select id="external-account" value={accountId} onChange={(event) => changeAccount(event.target.value)} className="min-w-48 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent">
            <option value="">Todas as contas</option>
            {accounts.map((item) => <option key={item.id} value={item.id}>@{item.username}</option>)}
          </select>
          <a href={csvHref} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95">Baixar CSV</a>
        </div>
      </header>

      {error && <div role="alert" className="mb-5 rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>}

      <section aria-label="Resumo dos Stories capturados" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Stories capturados", number(stories.length)],
          ["Alcance somado", number(sum(stories, (item) => item.reach))],
          ["Respostas", number(sum(stories, (item) => item.replies))],
          ["Com mídia guardada", number(stories.filter((item) => item.hasMedia).length)],
        ].map(([label, value]) => <div key={label} className="rounded-2xl border border-border bg-surface p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 font-display text-2xl font-bold tabular-nums text-foreground">{value}</p></div>)}
      </section>

      <p className="mb-8 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-foreground">
        A mídia fica guardada por {retentionDays} {retentionDays === 1 ? "dia" : "dias"} e depois é apagada. Os dados e as métricas continuam salvos.
      </p>

      {loading ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">Carregando Stories…</p>
      ) : stories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
          <h2 className="font-display text-lg font-bold text-foreground">Ainda não há Stories capturados</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            A captura roda a cada 15 minutos e só vale para Stories postados a partir de agora. Os Stories antigos que já expiraram não podem ser recuperados.
          </p>
        </div>
      ) : (
        <section aria-label="Stories capturados" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {stories.map((story) => (
            <article key={story.id} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="aspect-[9/12] w-full bg-sidebar"><MediaPreview story={story} /></div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-foreground">@{story.username}</h3>
                    <p className="mt-0.5 text-xs text-muted">Publicado em {formatDateTime(story.postedAt)}</p>
                  </div>
                  {story.permalink && <a href={story.permalink} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-accent hover:bg-sidebar">Abrir original</a>}
                </div>
                {story.caption && <p className="mt-3 line-clamp-2 text-sm text-muted">{story.caption}</p>}
                <dl className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    ["Alcance", story.reach],
                    ["Visualizações", story.views],
                    ["Respostas", story.replies],
                    ["Compartilh.", story.shares],
                    ["Seguidores", story.follows],
                    ["Visitas", story.profileVisits],
                  ].map(([label, value]) => <div key={label as string} className="rounded-lg bg-bg p-2.5"><dt className="text-[11px] text-muted">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">{number(value as number | null)}</dd></div>)}
                </dl>
                <p className="mt-3 text-[11px] text-muted">
                  {story.lastCapturedAt ? `Métricas de ${formatDateTime(story.lastCapturedAt)}.` : "Sem métricas capturadas ainda."}
                  {story.hasMedia && story.mediaExpiresAt ? ` Mídia guardada até ${formatDateTime(story.mediaExpiresAt)}.` : ""}
                </p>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
