"use client";

/**
 * Facebook Page workspace: metrics for the Page and its videos, and a summary of
 * the campaigns that answer comments on them. Campaigns are created and edited
 * in the campaign builder (Campanhas), once, for Instagram and Facebook alike;
 * this screen only links there.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StatCard from "@/components/stat-card";
import type {
  FacebookInsightsResponse,
  FacebookVideoRow,
} from "@/app/api/facebook/insights/route";

interface Rule {
  id: string;
  name: string;
  videoTitle: string | null;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  isActive: boolean;
  /** The Instagram campaign this is the Facebook half of, if any. */
  automationId: string | null;
  sent: number;
  failed: number;
}

interface Failure {
  automationId: string;
  commenterName: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const ghostButton =
  "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50";
const primaryButton =
  "inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50";

function formatNumber(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("pt-BR");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

function videoLabel(video: FacebookVideoRow): string {
  const text = video.title || video.description || "Vídeo sem legenda";
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/** The campaign builder, started from a Facebook video. */
function newCampaignHref(video?: FacebookVideoRow): string {
  if (!video) return "/campaigns/new?channel=facebook";
  const params = new URLSearchParams({
    facebookVideoId: video.id,
    facebookVideoTitle: videoLabel(video).slice(0, 200),
  });
  if (video.permalinkUrl) params.set("facebookVideoUrl", video.permalinkUrl);
  return `/campaigns/new?${params}`;
}

export default function FacebookWorkspace() {
  const [data, setData] = useState<FacebookInsightsResponse | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Bumping this refetches everything. `loading` only drives the first-load
  // skeleton, so a reload keeps the current screen on display.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/facebook/insights").then((response) => response.json()),
      fetch("/api/facebook/automations").then((response) => response.json()),
    ])
      .then(([insightsPayload, rulesPayload]) => {
        if (cancelled) return;
        if (rulesPayload.success) {
          setRules(rulesPayload.data.rules);
          setFailures(rulesPayload.data.recentFailures);
        }
        if (insightsPayload.success) {
          setData(insightsPayload.data);
          setError(null);
        } else {
          setData(null);
          setError({
            message: insightsPayload.error ?? "Não foi possível carregar o Facebook.",
            detail: insightsPayload.detail,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setError({ message: "Não foi possível carregar o Facebook." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function retryWebhook() {
    if (!data) return;
    setBusy("webhook");
    try {
      await fetch("/api/facebook/pages/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: data.page.id }),
      });
      reload();
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-8">
        <div className="h-10 w-48 rounded bg-surface-hover" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="panel h-28 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel space-y-3 rounded p-8 text-center">
        <p className="text-sm text-error">{error?.message ?? "Não foi possível carregar o Facebook."}</p>
        {error?.detail && <p className="mx-auto max-w-xl break-words text-xs text-muted">{error.detail}</p>}
        <Link href="/settings" className="inline-block text-sm text-accent hover:underline">
          Abrir Configurações
        </Link>
      </div>
    );
  }

  const { summary, insights, videos, page } = data;
  const missing = [...new Set([...data.missingMetricScopes, ...data.missingReplyScopes])];
  const ruleName = (id: string) => rules.find((rule) => rule.id === id)?.name ?? "Campanha";
  const ruleHref = (rule: Rule) =>
    rule.automationId ? `/campaigns/${rule.automationId}` : `/campaigns/facebook/${rule.id}/edit`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
            Facebook
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Página{" "}
            {summary?.link ? (
              <a href={summary.link} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-accent">
                {page.name}
              </a>
            ) : (
              page.name
            )}
            {summary?.followers != null && ` · ${summary.followers.toLocaleString("pt-BR")} seguidores`}
          </p>
        </div>
        <Link href={newCampaignHref()} className={primaryButton}>
          Nova campanha no Facebook
        </Link>
      </div>

      {!page.webhookSubscribed && (
        <div className="panel space-y-2 rounded border border-border p-4">
          <p className="text-sm text-foreground">
            A Página ainda não envia os comentários para o FISGA, então nenhuma resposta automática dispara.
          </p>
          {page.webhookError && <p className="break-words text-xs text-muted">Motivo informado pela Meta: {page.webhookError}</p>}
          <button type="button" className={ghostButton} onClick={retryWebhook} disabled={busy === "webhook"}>
            {busy === "webhook" ? "Tentando..." : "Tentar ativar de novo"}
          </button>
        </div>
      )}

      {missing.length > 0 && (
        <div className="panel rounded border border-border p-4">
          <p className="text-sm text-foreground">A conexão do Facebook não tem todas as permissões desta tela.</p>
          <p className="mt-1 text-xs text-muted">Faltam: {missing.join(", ")}.</p>
          <a href="/api/facebook/connect" className="mt-3 inline-block text-sm text-accent hover:underline">
            Reconectar Facebook
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Seguidores" value={formatNumber(summary?.followers ?? null)} />
        <StatCard label="Visualizações" value={formatNumber(insights?.views ?? null)} detail={`Últimos ${insights?.periodDays ?? 28} dias`} />
        <StatCard label="Alcance" value={formatNumber(insights?.reach ?? null)} detail={`Últimos ${insights?.periodDays ?? 28} dias`} />
        <StatCard label="Interações" value={formatNumber(insights?.engagements ?? null)} detail={`Últimos ${insights?.periodDays ?? 28} dias`} />
      </div>
      {insights && insights.views === null && insights.reach === null && insights.engagements === null && (
        <p className="-mt-4 text-xs text-muted">
          A Meta não devolveu as métricas da Página. Os números de cada vídeo, abaixo, continuam valendo.
        </p>
      )}

      <div className="panel rounded p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Campanhas no Facebook</h2>
          <Link href="/campaigns" className="text-xs font-semibold text-accent hover:underline">
            Ver todas as campanhas
          </Link>
        </div>
        {rules.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Nenhuma campanha roda no Facebook ainda. Use “Criar campanha” em um vídeo abaixo.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${rule.isActive ? "bg-success/15 text-success" : "bg-surface-hover text-muted"}`}>
                      {rule.isActive ? "ATIVA" : "PAUSADA"}
                    </span>
                    <span className="truncate text-sm font-semibold text-foreground">{rule.name}</span>
                    {rule.automationId && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                        Instagram + Facebook
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {rule.matchAnyPost ? "Todos os vídeos" : (rule.videoTitle ?? "Vídeo específico")} ·{" "}
                    {rule.matchAnyWord ? "qualquer comentário" : rule.keywords.join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {rule.sent} enviadas{rule.failed > 0 && <span className="text-error"> · {rule.failed} com falha</span>}
                  </p>
                </div>
                <Link href={ruleHref(rule)} className={ghostButton}>
                  Abrir campanha
                </Link>
              </li>
            ))}
          </ul>
        )}
        {failures.length > 0 && (
          <div className="mt-4 rounded border border-border p-3">
            <p className="text-xs font-semibold text-foreground">Últimas falhas</p>
            <ul className="mt-2 space-y-1">
              {failures.map((failure, index) => (
                <li key={index} className="break-words text-xs text-muted">
                  {ruleName(failure.automationId)} · {failure.commenterName ?? "alguém"}: {failure.errorMessage ?? "erro desconhecido"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="panel rounded p-4 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Vídeos</h2>
        {videos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Nenhum vídeo encontrado nesta Página.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase leading-4 tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Vídeo</th>
                  <th className="px-1.5 py-2 text-right font-medium">Visualizações</th>
                  <th className="px-1.5 py-2 text-right font-medium">Alcance</th>
                  <th className="px-1.5 py-2 text-right font-medium">Reações</th>
                  <th className="px-1.5 py-2 text-right font-medium">Comentários</th>
                  <th className="px-1.5 py-2 text-right font-medium">Data</th>
                  <th className="py-2 pl-3 font-medium">Campanha</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((video) => (
                  <tr key={video.id} className="border-b border-border last:border-0">
                    <td className="max-w-xs py-3 pr-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {video.thumbnailUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={video.thumbnailUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" />
                        )}
                        <div className="min-w-0">
                          {video.permalinkUrl ? (
                            <a href={video.permalinkUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-foreground hover:text-accent">
                              {videoLabel(video)}
                            </a>
                          ) : (
                            <span className="block truncate text-foreground">{videoLabel(video)}</span>
                          )}
                          {video.isReel && <span className="mt-1 inline-block rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">Reel</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">{formatNumber(video.views)}</td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">{formatNumber(video.reach)}</td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">{formatNumber(video.reactions ?? video.likes)}</td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">{formatNumber(video.comments)}</td>
                    <td className="px-1.5 py-3 text-right text-muted">{formatDate(video.createdTime)}</td>
                    <td className="py-3 pl-3">
                      {video.activeRules > 0 && (
                        <span className="mr-2 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                          ATIVA
                        </span>
                      )}
                      <Link href={newCampaignHref(video)} className="text-[11px] font-semibold text-accent hover:underline">
                        {video.activeRules > 0 ? "Outra campanha" : "Criar campanha"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
