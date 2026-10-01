"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatCard from "@/components/stat-card";
import StatusBadge from "@/components/status-badge";

interface DashboardStats {
  userName: string | null;
  contactsCount: number;
  totalAutomations: number;
  activeAutomations: number;
  dmsSentToday: number;
  dmsSentWeek: number;
  dmsSentMonth: number;
  dmsSkippedMonth: number;
  dmsFailedMonth: number;
  totalDMs: number;
  clicksThisMonth: number;
  totalClicks: number;
  ctrThisMonth: number;
  instagramAccounts: AccountOption[];
  selectedInstagramAccountId: string | null;
  topKeywords: { keyword: string; count: number }[];
  dailyDMs: { date: string; count: number }[];
  recentLogs: Array<{
    id: string;
    commenterName: string | null;
    commentText: string;
    status: string;
    createdAt: string;
    automation: { name: string };
    instagramAccount?: { username: string };
  }>;
}

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR");
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams();
    if (selectedAccountId !== "all") {
      params.set("instagramAccountId", selectedAccountId);
    }

    fetch("/api/dashboard/stats" + (params.size ? "?" + params : ""))
      .then((response) => response.json())
      .then((data) => {
        if (!current) return;
        if (data.success) {
          setStats(data.data);
          setError(null);
        } else {
          setError(data.error ?? "Não foi possível carregar os dados do painel.");
        }
      })
      .catch(() => {
        if (current) setError("Não foi possível carregar os dados do painel.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [selectedAccountId, reloadKey]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  function retryLoad() {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  if (loading) {
    return (
      <div className="space-y-7" aria-label="Carregando painel">
        <div className="h-20 max-w-sm animate-pulse rounded-xl bg-surface-hover" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="panel h-[142px] animate-pulse p-5">
              <div className="h-4 w-28 rounded bg-surface-hover" />
              <div className="mt-7 h-8 w-20 rounded bg-surface-hover" />
              <div className="mt-3 h-3 w-32 rounded bg-surface-hover" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel h-72 animate-pulse" />
          <div className="panel h-72 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <section className="panel flex flex-col items-start gap-4 p-6 sm:p-8">
        <div>
          <p className="text-sm font-semibold text-error">Falha ao carregar</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-foreground">
            O painel não abriu
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            {error ?? "Não foi possível carregar os dados agora."}
          </p>
        </div>
        <button
          type="button"
          onClick={retryLoad}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Tentar novamente
        </button>
      </section>
    );
  }

  const connectedCount = stats.instagramAccounts.length;
  const maxDM = Math.max(...stats.dailyDMs.map((day) => day.count), 1);
  const maxKeywordCount = Math.max(
    ...stats.topKeywords.map((keyword) => keyword.count),
    1
  );
  const displayName = stats.userName?.trim();

  return (
    <div className="space-y-7 sm:space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-accent">
            Resumo da conta
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground sm:text-[2.15rem]">
            {displayName ? "Olá, " + displayName : "Seu painel"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {connectedCount} conta{connectedCount === 1 ? "" : "s"} conectada
            {connectedCount === 1 ? "" : "s"} <span aria-hidden="true">·</span>{" "}
            {formatNumber(stats.contactsCount)}{" "}
            {stats.contactsCount === 1 ? "contato" : "contatos"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {stats.instagramAccounts.length > 1 && (
            <AccountSelect
              accounts={stats.instagramAccounts}
              value={selectedAccountId}
              onChange={handleAccountChange}
            />
          )}
          <Link
            href="/campaigns/new"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            <svg
              aria-hidden="true"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nova campanha
          </Link>
        </div>
      </header>

      {connectedCount === 0 && (
        <section className="flex flex-col gap-5 rounded-2xl border border-accent/20 bg-accent/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-accent">Primeiro passo</p>
            <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-foreground">
              Conecte uma conta do Instagram
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Depois da conexão, você poderá acompanhar os comentários e ativar
              campanhas de resposta por DM.
            </p>
          </div>
          <a
            href="/api/instagram/connect"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Conectar Instagram
          </a>
        </section>
      )}

      <section
        aria-label="Indicadores do painel"
        className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
      >
        <StatCard
          label="DMs enviadas neste mês"
          value={formatNumber(stats.dmsSentMonth)}
          detail={
            formatNumber(stats.dmsSentToday) + " hoje · " +
            formatNumber(stats.dmsSentWeek) + " nesta semana"
          }
        />
        <StatCard
          label="Campanhas ativas"
          value={formatNumber(stats.activeAutomations)}
          detail={formatNumber(stats.totalAutomations) + " no total"}
        />
        <StatCard
          label="Cliques em links"
          value={formatNumber(stats.clicksThisMonth)}
          detail={"CTR de " + stats.ctrThisMonth + "% neste mês"}
        />
        <StatCard
          label="Contatos"
          value={formatNumber(stats.contactsCount)}
          detail="Pessoas que comentaram"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,0.85fr)] xl:gap-5">
        <div className="space-y-4 xl:space-y-5">
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                  DMs enviadas
                </h2>
                <p className="mt-1 text-xs text-muted">Últimos 7 dias</p>
              </div>
              <span className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-accent">
                {formatNumber(stats.dmsSentWeek)} na semana
              </span>
            </div>

            {stats.dailyDMs.length > 0 ? (
              <figure
                className="mt-6"
                aria-label="Mensagens diretas enviadas nos últimos sete dias"
              >
                <div className="flex h-48 items-end gap-2 border-b border-border px-1 sm:gap-3">
                  {stats.dailyDMs.map((day) => (
                    <div
                      key={day.date}
                      className="flex h-full min-w-0 flex-1 flex-col items-center gap-2 pt-2"
                    >
                      <span className="text-[11px] font-medium text-muted tabular-nums">
                        {formatNumber(day.count)}
                      </span>
                      <div className="flex w-full flex-1 items-end rounded-t-md bg-surface-hover">
                        <div
                          className="w-full rounded-t-md bg-accent transition-[height] duration-300"
                          style={{
                            height: Math.max((day.count / maxDM) * 100, 3) + "%",
                          }}
                        />
                      </div>
                      <span className="w-full truncate text-center text-[10px] text-muted">
                        {day.date}
                      </span>
                    </div>
                  ))}
                </div>
              </figure>
            ) : (
              <p className="mt-8 rounded-xl bg-background px-4 py-8 text-center text-sm text-muted">
                Ainda não há envios neste período.
              </p>
            )}
          </section>

          <section
            aria-label="Outros resultados deste mês"
            className="grid grid-cols-2 gap-3"
          >
            <div className="panel flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
              <span className="text-sm text-muted">Ignoradas neste mês</span>
              <strong className="font-display text-xl font-bold text-foreground tabular-nums">
                {formatNumber(stats.dmsSkippedMonth)}
              </strong>
            </div>
            <div className="panel flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
              <span className="text-sm text-muted">Falhas neste mês</span>
              <strong className="font-display text-xl font-bold text-error tabular-nums">
                {formatNumber(stats.dmsFailedMonth)}
              </strong>
            </div>
          </section>
        </div>

        <div className="space-y-4 xl:space-y-5">
          <section className="panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                  Palavras que mais fisgam
                </h2>
                <p className="mt-1 text-xs text-muted">Correspondências recentes</p>
              </div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent">
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </span>
            </div>
            {stats.topKeywords.length > 0 ? (
              <div className="mt-5 space-y-4">
                {stats.topKeywords.slice(0, 5).map((keyword) => (
                  <div key={keyword.keyword}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-foreground">
                        {keyword.keyword}
                      </span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {formatNumber(keyword.count)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className="h-full rounded-full bg-accent/75"
                        style={{
                          width:
                            Math.max(
                              (keyword.count / maxKeywordCount) * 100,
                              4
                            ) + "%",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-xl bg-background px-4 py-6 text-sm leading-6 text-muted">
                As palavras aparecerão aqui quando os comentários começarem a
                acionar suas campanhas.
              </p>
            )}
          </section>

          <section className="panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                Contas conectadas
              </h2>
              <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                {connectedCount}
              </span>
            </div>
            {connectedCount > 0 ? (
              <div className="mt-4 divide-y divide-border">
                {stats.instagramAccounts.slice(0, 3).map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-xs font-semibold text-accent">
                      IG
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      @{account.username}
                    </span>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                  </div>
                ))}
                {connectedCount > 3 && (
                  <p className="pt-3 text-xs text-muted">
                    +{connectedCount - 3} contas conectadas
                  </p>
                )}
              </div>
            ) : (
              <a
                href="/api/instagram/connect"
                className="mt-4 inline-flex text-sm font-semibold text-accent hover:text-accent-hover"
              >
                Conectar Instagram
              </a>
            )}
          </section>
        </div>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
              Atividade recente
            </h2>
            <p className="mt-1 text-xs text-muted">Últimas respostas das campanhas</p>
          </div>
          <Link
            href="/logs"
            className="text-sm font-semibold text-accent hover:text-accent-hover"
          >
            Ver todos os registros
          </Link>
        </div>

        {stats.recentLogs.length > 0 ? (
          <div className="divide-y divide-border">
            {stats.recentLogs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 sm:grid-cols-[minmax(180px,0.8fr)_minmax(0,1.2fr)_auto] sm:px-6"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sidebar text-xs font-semibold text-foreground">
                    {(log.commenterName ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      @{log.commenterName ?? "desconhecido"}
                    </span>
                    <span className="block truncate text-xs text-muted sm:hidden">
                      {log.commentText}
                    </span>
                  </span>
                </div>
                <div className="hidden min-w-0 sm:block">
                  <p className="truncate text-sm text-foreground">{log.commentText}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {log.instagramAccount
                      ? "@" + log.instagramAccount.username + " · "
                      : ""}
                    {log.automation.name}
                  </p>
                </div>
                <div className="flex items-center justify-end">
                  <StatusBadge status={log.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted sm:px-6">
            Ainda não há atividade para mostrar.
          </p>
        )}
      </section>
    </div>
  );
}
