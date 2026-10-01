"use client";

/**
 * Instagram Overview Page
 *
 * Aggregate reach/engagement across your recent posts, plus a per-post table.
 * Views / reach / saved / shares come from Instagram media insights (requires
 * the insights permission); likes and comments are always available.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import AccountSelect from "@/components/account-select";
import StatCard from "@/components/stat-card";
import FollowerChart from "@/components/follower-chart";
import type { OverviewResponse } from "@/app/api/instagram/overview/route";

function formatNumber(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { month: "short", day: "numeric" });
}

const COUNT_OPTIONS = [
  { value: "25", label: "Últimas 25" },
  { value: "50", label: "Últimas 50" },
  { value: "100", label: "Últimas 100" },
  { value: "all", label: "Todo o período" },
];

export default function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [count, setCount] = useState("50");
  const [activatingCampaign, setActivatingCampaign] = useState<string | null>(null);
  const [campaignErrors, setCampaignErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedAccountId !== "all") {
      params.set("instagramAccountId", selectedAccountId);
    }
    params.set("count", count);

    fetch(`/api/instagram/overview?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setData(res.data);
          setError(null);
        } else {
          setError(res.error ?? "Não foi possível carregar a visão geral");
        }
      })
      .catch(() => setError("Não foi possível carregar a visão geral"))
      .finally(() => setLoading(false));
  }, [selectedAccountId, count]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  function handleCountChange(next: string) {
    setLoading(true);
    setCount(next);
  }

  async function activateCampaign(postId: string, campaignId: string) {
    setActivatingCampaign(campaignId);
    setCampaignErrors((current) => {
      const next = { ...current };
      delete next[campaignId];
      return next;
    });

    try {
      const response = await fetch(`/api/automations?id=${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Não foi possível ativar a campanha.");
      }

      setData((current) =>
        current
          ? {
              ...current,
              posts: current.posts.map((post) =>
                post.id === postId
                  ? {
                      ...post,
                      campaigns: post.campaigns.map((campaign) =>
                        campaign.id === campaignId
                          ? { ...campaign, isActive: true }
                          : campaign
                      ),
                    }
                  : post
              ),
            }
          : current
      );
    } catch (activationError) {
      setCampaignErrors((current) => ({
        ...current,
        [campaignId]:
          activationError instanceof Error
            ? activationError.message
            : "Não foi possível ativar a campanha.",
      }));
    } finally {
      setActivatingCampaign(null);
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="panel rounded p-4 h-24 sm:p-5">
            <div className="h-4 w-16 bg-surface-hover rounded" />
            <div className="mt-3 h-6 w-20 bg-surface-hover/60 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-error">{error}</p>
        {error.includes("connect") && (
          <a
            href="/api/instagram/connect"
            className="mt-4 inline-block text-sm text-accent hover:underline"
          >
            Conectar Instagram
          </a>
        )}
      </div>
    );
  }

  if (!data) return null;

  const { totals, posts, accounts, insightsAvailable, insightsPermissionDenied, followers, followerHistory } =
    data;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">Visão geral</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            {data.requestedCount === "all" ? "Todo o período" : "Recentes"} —{" "}
            {totals.posts} publicaç{totals.posts === 1 ? "ão" : "ões"} de @
            {data.account.username}
            {data.truncated ? ` (limitado a ${totals.posts})` : ""}
          </p>
          {followers !== null && (
            // Kept out of the tile row below: that row sums the selected posts,
            // whereas this is a current account-level total.
            <p className="mt-1 text-sm text-muted">
              {followers.toLocaleString("pt-BR")} seguidores
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <Link
            href="/growth"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17 9 11l4 3 8-9" />
              <path d="M15 5h6v6" />
            </svg>
            Análise de crescimento
          </Link>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Período
            </span>
            <select
              value={count}
              onChange={(e) => handleCountChange(e.target.value)}
              className="border-0 bg-transparent py-2 pr-1 text-sm text-foreground outline-none"
            >
              {COUNT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts.map((a) => ({
                id: a.id,
                username: a.username,
                instagramId: a.id,
              }))}
              value={selectedAccountId}
              onChange={handleAccountChange}
            />
          )}
        </div>
      </div>

      {(insightsPermissionDenied || (!insightsAvailable && !posts.some((post) => post.isTrialReel))) && (
        <div className="panel rounded p-4 border border-border">
          <p className="text-sm text-foreground">
            Visualizações, alcance, itens salvos e compartilhamentos exigem a permissão de insights.
          </p>
          <p className="text-sm text-muted mt-1">
            Reconecte a conta para concedê-la — curtidas e comentários continuam
            sendo exibidos enquanto isso.
          </p>
          <a
            href="/api/instagram/connect"
            className="mt-3 inline-block text-sm text-accent hover:underline"
          >
            Reconectar Instagram
          </a>
        </div>
      )}

      {/* Aggregate totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <StatCard label="Visualizações" value={formatNumber(totals.views)} />
        <StatCard label="Alcance" value={formatNumber(totals.reach)} />
        <StatCard label="Curtidas" value={formatNumber(totals.likes)} />
        <StatCard label="Comentários" value={formatNumber(totals.comments)} />
        <StatCard label="Salvos" value={formatNumber(totals.saved)} />
        <StatCard label="Compartilhamentos" value={formatNumber(totals.shares)} />
      </div>

      {/* Follower trend — account-level, independent of the post range */}
      <FollowerChart data={followerHistory} followers={followers} />

      {/* Per-post table */}
      <div className="panel rounded p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">Publicações</h2>
        {posts.length === 0 ? (
          <p className="text-sm text-muted py-8 text-center">Nenhuma publicação encontrada</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[960px] table-fixed text-sm xl:min-w-0">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase leading-4 tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Publicação</th>
                  <th className="px-1.5 py-2 font-medium text-right">Visualizações</th>
                  <th className="px-1.5 py-2 font-medium text-right">Alcance</th>
                  <th className="px-1.5 py-2 font-medium text-right">Curtidas</th>
                  <th className="px-1.5 py-2 font-medium text-right">Comentários</th>
                  <th className="px-1.5 py-2 font-medium text-right">Salvos</th>
                  <th className="px-1.5 py-2 font-medium text-right">Compartilhamentos</th>
                  <th className="px-1.5 py-2 font-medium">Campanha</th>
                  <th className="py-2 pl-1.5 font-medium text-right">Data</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="max-w-xs py-3 pr-3">
                      {p.permalink ? (
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground hover:text-accent truncate block"
                        >
                          {p.caption || `Publicação ${p.mediaType}`}
                        </a>
                      ) : (
                        <span className="text-foreground truncate block">
                          {p.caption || `Publicação ${p.mediaType}`}
                        </span>
                      )}
                      {p.isTrialReel && <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">Reel de teste</span>
                        {p.trialInsightsAvailable === false && <span className="text-[10px] text-muted">A Meta ainda não retornou métricas para este Reel.</span>}
                      </div>}
                    </td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">
                      {formatNumber(p.views)}
                    </td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">
                      {formatNumber(p.reach)}
                    </td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">
                      {formatNumber(p.likes)}
                    </td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">
                      {formatNumber(p.comments)}
                    </td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">
                      {formatNumber(p.saved)}
                    </td>
                    <td className="px-1.5 py-3 text-right tabular-nums text-muted">
                      {formatNumber(p.shares)}
                    </td>
                    <td className="min-w-0 px-1.5 py-2">
                      <div className="min-w-0 space-y-2">
                        {p.campaigns.map((campaign) => (
                          <div key={campaign.id} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                campaign.isActive
                                  ? "bg-success/15 text-success"
                                  : "bg-surface-hover text-muted"
                              }`}
                            >
                              {campaign.isActive
                                ? campaign.target === "all"
                                  ? "ATIVA EM TODOS"
                                  : "ATIVA"
                                : campaign.target === "all"
                                  ? "PAUSADA · TODOS"
                                  : "PAUSADA"}
                            </span>
                            <Link
                              href={`/campaigns/${campaign.id}`}
                              className="min-w-0 max-w-full truncate text-[11px] text-foreground hover:text-accent"
                              title={campaign.name}
                            >
                              {campaign.name}
                            </Link>
                            {!campaign.isActive && campaign.target === "post" && (
                              <button
                                type="button"
                                onClick={() => activateCampaign(p.id, campaign.id)}
                                disabled={activatingCampaign === campaign.id}
                                className="rounded-md border border-accent/25 bg-accent/5 px-2 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                              >
                                {activatingCampaign === campaign.id ? "Ativando…" : "Ativar"}
                              </button>
                            )}
                          </div>
                        ))}
                        {!p.campaigns.some((campaign) => campaign.isActive) &&
                          !p.campaigns.some((campaign) => campaign.target === "post") && (
                            <Link
                              href={(() => {
                                const params = new URLSearchParams({
                                  instagramAccountId: data.account.id,
                                  postId: p.id,
                                });
                                if (p.permalink) params.set("postUrl", p.permalink);
                                return `/campaigns/new?${params.toString()}`;
                              })()}
                              className="inline-flex max-w-full items-center gap-1 rounded-md border border-accent/25 bg-accent/5 px-2 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/10"
                            >
                              <span aria-hidden="true" className="text-sm leading-none">+</span>
                              <span className="truncate">Criar campanha</span>
                            </Link>
                          )}
                        {p.campaigns.map((campaign) =>
                          campaignErrors[campaign.id] ? (
                            <p key={`${campaign.id}-error`} className="text-xs text-error">
                              {campaignErrors[campaign.id]}
                            </p>
                          ) : null
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-3 pl-1.5 text-right tabular-nums text-muted">
                      {formatDate(p.timestamp)}
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
