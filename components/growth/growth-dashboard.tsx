"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AccountSelect from "@/components/account-select";
import {
  buildGrowthAnalytics,
  GROWTH_HEATMAP_HOURS,
  GROWTH_WEEKDAYS,
  type GrowthAnalytics,
  type GrowthFollowerPoint,
  type GrowthGoals,
  type GrowthPostInput,
  type GrowthStoryInput,
} from "@/lib/growth/analytics";

interface GrowthPageData {
  account: { id: string; username: string };
  accounts: Array<{ id: string; username: string }>;
  periodDays: 30 | 90;
  timeZone: string;
  periodStart: string;
  periodEnd: string;
  followers: number | null;
  followerHistory: GrowthFollowerPoint[];
  insightsAvailable: boolean;
  insightsPermissionDenied: boolean;
  mediaLimitReached: boolean;
  posts: GrowthPostInput[];
  stories: GrowthStoryInput[];
  activityTotals: { keywordComments: number; sentDms: number; clicks: number };
}

const DEFAULT_GOALS: GrowthGoals = { feedPerWeek: 4, storyDaysPerWeek: 6 };
const STORAGE_PREFIX = "openreply:growth-goals:";

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDecimal(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSigned(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatPeriod(date: string): string {
  return new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function metricTotal(analytics: GrowthAnalytics): number | null {
  return analytics.summary.feedPosts || analytics.summary.storySlides
    ? analytics.summary.interactions
    : null;
}

function downloadCsv(data: GrowthPageData, analytics: GrowthAnalytics) {
  const rows = [
    ["Métrica", "Valor", "Período"],
    ["Conta", `@${data.account.username}`, `${data.periodDays} dias`],
    ["Seguidores ganhos", formatNumber(analytics.summary.followersGained), `${data.periodDays} dias`],
    ["Contas alcançadas (soma por conteúdo)", formatNumber(analytics.summary.reach), `${data.periodDays} dias`],
    ["Interações", formatNumber(metricTotal(analytics)), `${data.periodDays} dias`],
    ["Taxa de engajamento", analytics.summary.engagementRate === null ? "—" : `${formatDecimal(analytics.summary.engagementRate, 2)}%`, `${data.periodDays} dias`],
    ["Posts no feed", formatNumber(analytics.summary.feedPosts), `${data.periodDays} dias`],
    ["Slides de Stories", formatNumber(analytics.summary.storySlides), `${data.periodDays} dias`],
    ["DMs enviadas", formatNumber(data.activityTotals.sentDms), `${data.periodDays} dias`],
    ["Cliques rastreados", formatNumber(data.activityTotals.clicks), `${data.periodDays} dias`],
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(";"))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fisga-crescimento-${data.periodDays}d.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function GrowthSkeleton() {
  return (
    <div aria-label="Carregando crescimento" className="space-y-6 animate-pulse">
      <div className="h-20 rounded-2xl bg-surface-hover" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-32 rounded-2xl bg-surface-hover" />)}
      </div>
      <div className="h-[34rem] rounded-2xl bg-surface-hover" />
      <div className="grid gap-4 lg:grid-cols-2"><div className="h-72 rounded-2xl bg-surface-hover" /><div className="h-72 rounded-2xl bg-surface-hover" /></div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "surface",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "surface" | "ink" | "accent";
}) {
  const classes = tone === "ink"
    ? "border-foreground bg-foreground text-white"
    : tone === "accent"
      ? "border-[#f0cdbe] bg-[#fbf3ee] text-[#8f2c0f]"
      : "border-border bg-surface text-foreground";
  const muted = tone === "ink" ? "text-white/65" : tone === "accent" ? "text-[#8f2c0f]/80" : "text-muted";
  return (
    <article className={`flex min-h-32 flex-col justify-between rounded-2xl border p-4 sm:p-5 ${classes}`}>
      <p className={`text-xs font-medium sm:text-sm ${muted}`}>{label}</p>
      <p className="mt-4 font-display text-[1.9rem] font-bold leading-none tracking-tight tabular-nums sm:text-[2.1rem]">{value}</p>
      <p className={`mt-3 text-[11px] leading-4 sm:text-xs ${muted}`}>{detail}</p>
    </article>
  );
}

function GoalControl({
  label,
  value,
  unit,
  average,
  hitWeeks,
  weekCount,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  average: number;
  hitWeeks: number;
  weekCount: number;
  onChange: (next: number) => void;
}) {
  const reached = average >= value;
  const progress = Math.min(100, (average / Math.max(value, 1)) * 100);
  return (
    <article className="rounded-xl border border-border bg-[#fdfcf9] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className={`h-3 w-3 rounded-[4px] ${label === "Stories" ? "rounded-full bg-accent" : "bg-foreground"}`} />
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Meta</span>
          <button type="button" aria-label={`Diminuir meta de ${label.toLowerCase()}`} onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-base text-foreground hover:bg-surface-hover disabled:opacity-40">−</button>
          <strong className="min-w-20 text-center text-foreground">{value} {unit}</strong>
          <button type="button" aria-label={`Aumentar meta de ${label.toLowerCase()}`} onClick={() => onChange(Math.min(7, value + 1))} disabled={value >= 7} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-base text-foreground hover:bg-surface-hover disabled:opacity-40">+</button>
        </div>
      </div>
      <div className="mt-5 flex items-end gap-2">
        <span className="font-display text-4xl font-bold leading-none tabular-nums">{formatDecimal(average)}</span>
        <span className="pb-0.5 text-sm text-muted">{label === "Stories" ? "dias" : "posts"} por semana</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#f1eee7]">
        <div className={`h-full rounded-full transition-[width] duration-300 ${reached ? "bg-success" : label === "Stories" ? "bg-accent" : "bg-foreground"}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-1 text-xs">
        <span className={reached ? "font-semibold text-success" : "font-semibold text-warning"}>Meta batida em {hitWeeks} de {weekCount} semanas</span>
        <span className="text-muted">Meta semanal: {value} {unit}</span>
      </div>
    </article>
  );
}

function ConsistencyCalendar({ analytics }: { analytics: GrowthAnalytics }) {
  const activityByDate = new Map(analytics.activity.map((day) => [day.date, day]));
  const inPeriod = new Set(analytics.activity.map((day) => day.date));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Calendário de consistência</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-foreground" /> Post no feed</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-accent" /> Story publicado</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-border-hover" /> Sem publicação</span>
        </div>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[480px]">
          <div className="mb-1 grid grid-cols-[30px_repeat(var(--week-count),minmax(26px,1fr))] gap-1" style={{ "--week-count": analytics.weekly.length } as React.CSSProperties}>
            <span />
            {analytics.weekly.map((week) => <span key={week.startDate} className="text-center text-[10px] text-muted">{week.label}</span>)}
          </div>
          <div className="grid grid-cols-[30px_repeat(var(--week-count),minmax(26px,1fr))] gap-1" style={{ "--week-count": analytics.weekly.length } as React.CSSProperties}>
            {GROWTH_WEEKDAYS.map((weekday, row) => (
              <div key={weekday} className="contents">
                <span className="flex h-7 items-center text-[10px] text-muted">{weekday}</span>
                {analytics.weekly.map((week) => {
                  const date = week.days[row];
                  const day = activityByDate.get(date.date);
                  const isActiveRange = inPeriod.has(date.date);
                  const label = `${date.date}: ${date.feedPosts} ${date.feedPosts === 1 ? "post" : "posts"} no feed, ${date.storySlides} ${date.storySlides === 1 ? "Story" : "Stories"}`;
                  return (
                    <div key={date.date} title={label} aria-label={label} className={`flex h-7 items-center justify-center gap-1 rounded-[5px] border ${!isActiveRange ? "border-transparent opacity-25" : day && (day.feedPosts || day.storySlides) ? "border-[#f1e3da] bg-[#fbf3ee]" : "border-dashed border-[#d6d0c2] bg-transparent"}`}>
                      {date.feedPosts > 0 && <i aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-foreground" />}
                      {date.storySlides > 0 && <i aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FollowerWeeks({ analytics }: { analytics: GrowthAnalytics }) {
  const known = analytics.weekly.map((week) => week.followerDelta).filter((value): value is number => value !== null);
  const scale = Math.max(1, ...known.map(Math.abs));
  if (!known.length) {
    return <div className="rounded-xl border border-dashed border-border-hover bg-[#fbfaf7] p-5 text-sm leading-6 text-muted">Ainda não há registros diários suficientes para mostrar o ganho semanal. A conta precisa de pelo menos duas contagens em dias diferentes.</div>;
  }
  return (
    <div>
      <div className="grid h-48 grid-cols-[repeat(var(--week-count),minmax(38px,1fr))] items-end gap-2 overflow-x-auto pb-2" style={{ "--week-count": analytics.weekly.length } as React.CSSProperties}>
        {analytics.weekly.map((week) => {
          const value = week.followerDelta;
          const height = value === null ? 0 : Math.max(5, (Math.abs(value) / scale) * 115);
          return (
            <div key={week.startDate} className="flex h-full min-w-[38px] flex-col items-center justify-end gap-1.5">
              <span className={`text-[10px] font-semibold tabular-nums ${value !== null && value < 0 ? "text-error" : "text-foreground"}`}>{formatSigned(value)}</span>
              {value === null ? <span className="h-1.5 w-full rounded border border-dashed border-border-hover" /> : <span className={`w-full rounded-t-[5px] ${value < 0 ? "bg-error/70" : "bg-success"}`} style={{ height: `${height}px` }} />}
              <span className="text-[9px] text-muted">{week.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[10px] text-muted">
        {analytics.weekly.map((week) => <span key={`${week.startDate}-activity`}><strong className="text-foreground">{week.feedPosts}</strong> feed · <strong className="text-foreground">{week.storyDays}</strong> dias de Stories</span>)}
      </div>
    </div>
  );
}

function ReachFunnel({ analytics, clicks }: { analytics: GrowthAnalytics; clicks: number }) {
  const max = Math.max(1, ...analytics.funnel.map((step) => step.value ?? 0));
  const colors = ["#16181d", "#4a4d55", "#7a7466", "#c23e17", "#de7a55"];
  return (
    <section className="panel flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <h2 className="text-base font-semibold">Do alcance ao clique</h2>
        <p className="mt-1 text-xs leading-5 text-muted">Indicadores somados no período, não uma jornada atribuída às mesmas pessoas.</p>
      </div>
      <div className="space-y-4">
        {analytics.funnel.map((step, index) => {
          const width = step.value === null ? 0 : Math.max(2, (step.value / max) * 100);
          return (
            <div key={step.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 text-muted">{step.label}</span>
                <strong className="shrink-0 tabular-nums text-foreground">{formatCompact(step.value)}</strong>
              </div>
              <div className="h-3 overflow-hidden rounded-md bg-[#f6f4ef]">
                {step.value !== null && <div className="h-full rounded-md" style={{ width: `${width}%`, backgroundColor: colors[index] }} />}
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t border-border pt-3 text-[11px] leading-5 text-muted">{formatNumber(clicks)} cliques foram registrados por links rastreados. O alcance soma métricas por conteúdo e pode contar a mesma pessoa mais de uma vez.</p>
    </section>
  );
}

function heatColor(value: number | null, max: number): string {
  if (value === null) return "#f6f4ef";
  const palette = ["#f8e4da", "#f4cdbb", "#efb59b", "#e89a78", "#de7a55", "#cf5d34", "#c23e17"];
  return palette[Math.max(0, Math.min(palette.length - 1, Math.ceil((value / Math.max(max, 1)) * (palette.length - 1))))];
}

function BestTimes({ analytics }: { analytics: GrowthAnalytics }) {
  const cellsWithPosts = analytics.heatmap.filter((cell) => cell.sampleSize > 0);
  const max = Math.max(1, ...cellsWithPosts.map((cell) => cell.averageInteractions ?? 0));
  const cellByKey = new Map(analytics.heatmap.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  return (
    <section className="panel flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <h2 className="text-base font-semibold">Melhores horários para publicar</h2>
        <p className="mt-1 text-xs leading-5 text-muted">Média de interações por post, agrupada pelo horário local de publicação.</p>
      </div>
      {cellsWithPosts.length ? (
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[430px] space-y-1.5">
            <div className="grid grid-cols-[34px_repeat(7,minmax(36px,1fr))] gap-1 text-[10px] text-muted">
              <span />
              {GROWTH_HEATMAP_HOURS.map((hour) => <span key={hour} className="text-center">{String(hour).padStart(2, "0")}h</span>)}
            </div>
            {GROWTH_WEEKDAYS.map((day, weekday) => (
              <div key={day} className="grid grid-cols-[34px_repeat(7,minmax(36px,1fr))] items-center gap-1">
                <span className="text-[10px] text-muted">{day}</span>
                {GROWTH_HEATMAP_HOURS.map((hour) => {
                  const cell = cellByKey.get(`${weekday}:${hour}`)!;
                  const title = cell.sampleSize
                    ? `${day}, ${hour}h: média ${formatDecimal(cell.averageInteractions)} interações em ${cell.sampleSize} posts`
                    : `${day}, ${hour}h: sem posts no período`;
                  return <span key={hour} title={title} aria-label={title} className={`relative flex h-8 items-center justify-center rounded-[5px] text-[10px] font-semibold ${cell.rank ? "text-white" : "text-foreground"}`} style={{ backgroundColor: heatColor(cell.averageInteractions, max), opacity: cell.sampleSize ? 1 : 0.62 }}>{cell.sampleSize ? cell.rank ? `${cell.rank}º` : formatNumber(cell.sampleSize) : "·"}</span>;
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border-hover bg-[#fbfaf7] p-5 text-sm leading-6 text-muted">Ainda não há publicações com interações registradas em horários diferentes para comparar.</div>
      )}
      <p className="text-[11px] leading-5 text-muted">Cada célula mostra a quantidade de posts; destaque de melhor horário só aparece quando há pelo menos dois posts na mesma faixa.</p>
    </section>
  );
}

function FormatTable({ analytics }: { analytics: GrowthAnalytics }) {
  const bestFormat = analytics.formats
    .filter((format) => format.count >= 2 && format.averageReach !== null)
    .sort((a, b) => (b.averageReach ?? 0) - (a.averageReach ?? 0))[0]?.id;
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold">O que cada formato entrega</h2>
        <p className="mt-1 text-xs text-muted">Médias apenas sobre conteúdos em que a Meta retornou a métrica.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-[#faf8f4] text-[10px] font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-5 py-3 text-left font-semibold sm:px-6">Formato</th>
              <th className="px-3 py-3 text-right font-semibold">Publicados</th>
              <th className="px-3 py-3 text-right font-semibold">Alcance médio</th>
              <th className="px-3 py-3 text-right font-semibold">Salvamentos médios</th>
              <th className="px-3 py-3 text-right font-semibold">Compartilhamentos</th>
              <th className="px-5 py-3 text-right font-semibold sm:px-6">DMs de campanhas</th>
            </tr>
          </thead>
          <tbody>
            {analytics.formats.map((format) => (
              <tr key={format.id} className="border-t border-[#f1eee7] hover:bg-[#fcfbf8]">
                <th scope="row" className="px-5 py-3.5 text-left font-semibold text-foreground sm:px-6">
                  <span className="inline-flex items-center gap-2"><i aria-hidden="true" className={`h-2.5 w-2.5 rounded-[3px] ${format.id === "reels" ? "bg-accent" : format.id === "stories" ? "rounded-full bg-[#f0b8a1]" : format.id === "carousel" ? "bg-foreground" : "bg-[#7a7466]"}`} />{format.label}{bestFormat === format.id && <span className="rounded bg-success/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-success">Maior alcance médio</span>}</span>
                </th>
                <td className="px-3 py-3.5 text-right tabular-nums text-foreground">{formatNumber(format.count)}</td>
                <td className="px-3 py-3.5 text-right tabular-nums text-foreground">{formatCompact(format.averageReach)}</td>
                <td className="px-3 py-3.5 text-right tabular-nums text-foreground">{formatCompact(format.averageSaves)}</td>
                <td className="px-3 py-3.5 text-right tabular-nums text-foreground">{formatCompact(format.averageShares)}</td>
                <td className="px-5 py-3.5 text-right tabular-nums text-foreground sm:px-6">{format.campaignDms === null ? "—" : formatNumber(format.campaignDms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 pb-4 pt-2 text-[11px] text-muted sm:px-6">“DMs de campanhas” conta apenas automações vinculadas diretamente a uma publicação; não é atribuição de venda.</p>
    </section>
  );
}

function MeasurementNotes() {
  const items = [
    { title: "Vendas por conteúdo", detail: "Ainda não recebemos eventos de compra de checkout, loja ou CRM." },
    { title: "Custo por lead com anúncios", detail: "Precisa conectar os dados da conta de anúncios e relacioná-los às campanhas." },
    { title: "Seguidores por origem", detail: "O Instagram não informa, nesta conexão, qual conteúdo trouxe cada seguidor." },
    { title: "Saídas depois do link", detail: "O histórico atual mostra variação líquida; não identifica quem deixou de seguir." },
    { title: "Tempo de resposta humana", detail: "A FISGA ainda não registra de forma consistente as respostas manuais da equipe." },
    { title: "Comparação com concorrentes", detail: "A tela não coleta dados de outros perfis nem estima informações privadas." },
  ];
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">Ainda dá para medir</h2>
        <p className="mt-1 text-sm text-muted">O que falta para fechar o ciclo entre conteúdo, conversa e resultado.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <article key={item.title} className="flex min-h-32 flex-col gap-2 rounded-xl border border-dashed border-[#c9c2b2] bg-[#fbfaf7] p-4">
            <h3 className="text-sm font-semibold">{item.title}</h3>
            <p className="text-xs leading-5 text-muted">{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function GrowthDashboard() {
  const [data, setData] = useState<GrowthPageData | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [periodDays, setPeriodDays] = useState<30 | 90>(90);
  const timeZone = "America/Sao_Paulo";
  const [goals, setGoals] = useState<GrowthGoals>(DEFAULT_GOALS);
  const [goalsReadyFor, setGoalsReadyFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ periodDays: String(periodDays), timeZone });
    if (selectedAccountId) params.set("instagramAccountId", selectedAccountId);
    fetch(`/api/instagram/growth?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error ?? "Não foi possível carregar o crescimento.");
        return result.data as GrowthPageData;
      })
      .then((nextData) => {
        setData(nextData);
        setError(null);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar o crescimento.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [periodDays, selectedAccountId, timeZone]);

  useEffect(() => {
    const accountId = data?.account.id;
    if (!accountId || goalsReadyFor === accountId) return;
    let nextGoals = DEFAULT_GOALS;
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${accountId}`);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<GrowthGoals>;
        nextGoals = {
          feedPerWeek: Math.max(1, Math.min(7, Number(stored.feedPerWeek) || DEFAULT_GOALS.feedPerWeek)),
          storyDaysPerWeek: Math.max(1, Math.min(7, Number(stored.storyDaysPerWeek) || DEFAULT_GOALS.storyDaysPerWeek)),
        };
      }
    } catch {
      nextGoals = DEFAULT_GOALS;
    }
    const timer = window.setTimeout(() => {
      setGoals(nextGoals);
      setGoalsReadyFor(accountId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data?.account.id, goalsReadyFor]);

  useEffect(() => {
    const accountId = data?.account.id;
    if (!accountId || goalsReadyFor !== accountId) return;
    localStorage.setItem(`${STORAGE_PREFIX}${accountId}`, JSON.stringify(goals));
  }, [data?.account.id, goals, goalsReadyFor]);

  const visibleData = data && data.periodDays === periodDays && (!selectedAccountId || data.account.id === selectedAccountId)
    ? data
    : null;
  const analytics = useMemo(() => visibleData ? buildGrowthAnalytics({
    periodDays,
    timeZone,
    now: new Date(visibleData.periodEnd),
    posts: visibleData.posts,
    stories: visibleData.stories,
    followerHistory: visibleData.followerHistory,
    keywordComments: visibleData.activityTotals.keywordComments,
    sentDms: visibleData.activityTotals.sentDms,
    clicks: visibleData.activityTotals.clicks,
    goals,
  }) : null, [visibleData, periodDays, timeZone, goals]);

  function updateGoal(key: keyof GrowthGoals, value: number) {
    setGoals((current) => ({ ...current, [key]: value }));
  }

  function changePeriod(nextPeriod: 30 | 90) {
    setLoading(true);
    setPeriodDays(nextPeriod);
  }

  function changeAccount(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  if (loading && !visibleData) return <GrowthSkeleton />;
  if (!visibleData || !analytics) {
    return (
      <div className="panel rounded-2xl p-8 text-center">
        <h1 className="font-display text-3xl font-bold">Crescimento</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{error ?? "Conecte uma conta profissional do Instagram para analisar publicações, Stories e conversas."}</p>
        <a href="/api/instagram/connect" className="mt-5 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover">Conectar Instagram</a>
      </div>
    );
  }

  const summary = analytics.summary;
  const storyReachHint = visibleData.stories.length
    ? "Soma das métricas retornadas por publicação e Story"
    : "Soma de alcance dos posts; Stories sem dados no período";
  const followerDetail = summary.followersGained === null
    ? `${formatNumber(visibleData.followers)} seguidores atuais · histórico insuficiente`
    : `${formatNumber(visibleData.followers)} seguidores atuais · variação líquida`;

  return (
    <div className="space-y-6 pb-6 sm:space-y-8">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">FISGA · @{visibleData.account.username}</p>
          <h1 className="mt-1 font-display text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">Crescimento</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">O que você publica, com que frequência, e o que isso vira em seguidores, conversas e cliques.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-muted">Período</span>
            <div role="group" aria-label="Período da análise" className="flex rounded-xl bg-[#eae6dc] p-1">
              {([30, 90] as const).map((days) => (
                <button key={days} type="button" aria-pressed={periodDays === days} onClick={() => changePeriod(days)} className={`h-9 rounded-lg px-3 text-xs font-semibold ${periodDays === days ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>{days} dias</button>
              ))}
            </div>
          </div>
          {visibleData.accounts.length > 1 && <AccountSelect accounts={visibleData.accounts.map((account) => ({ ...account, instagramId: account.id }))} value={visibleData.account.id} onChange={changeAccount} includeAll={false} label="Conta" />}
          <button type="button" onClick={() => downloadCsv(visibleData, analytics)} className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-hover">Exportar relatório</button>
          <Link href="/schedule" className="inline-flex h-11 items-center rounded-xl bg-foreground px-4 text-sm font-semibold text-white hover:bg-[#303238]">Agendar post</Link>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-error/25 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>}
      {loading && <p role="status" className="text-xs text-muted">Atualizando dados…</p>}
      {visibleData.insightsPermissionDenied && (
        <aside className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold">Algumas métricas dependem da permissão de insights.</p><p className="mt-1 text-xs leading-5 text-muted">Alcance, salvamentos e compartilhamentos podem ficar indisponíveis; publicações, seguidores e DMs continuam aparecendo quando houver dados.</p></div>
          <a href="/api/instagram/connect" className="shrink-0 text-sm font-semibold text-accent hover:underline">Reconectar Instagram</a>
        </aside>
      )}
      {visibleData.mediaLimitReached && <p className="rounded-lg bg-[#fbf3ee] px-3 py-2 text-xs leading-5 text-[#8f2c0f]">A análise considera as 250 publicações mais recentes do período para respeitar os limites da API.</p>}

      <section aria-label="Indicadores do período" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Seguidores ganhos" value={formatSigned(summary.followersGained)} detail={followerDetail} tone="ink" />
        <MetricCard label="Alcance" value={formatCompact(summary.reach)} detail={storyReachHint} />
        <MetricCard label="Taxa de engajamento" value={summary.engagementRate === null ? "—" : `${formatDecimal(summary.engagementRate, 1)}%`} detail="Interações disponíveis ÷ alcance somado" />
        <MetricCard label="Conversas geradas" value={formatCompact(summary.conversations)} detail="DMs enviadas pela automação" tone="accent" />
        <MetricCard label="Publicações" value={`${formatNumber(summary.feedPosts)} + ${formatNumber(summary.storySlides)}`} detail="Posts no feed + slides de Stories" />
      </section>

      <section className="panel space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-display text-2xl font-bold tracking-tight sm:text-[26px]">Frequência de publicação</h2><p className="mt-1 text-sm text-muted">Feed e Stories em comparação com suas metas semanais.</p></div>
          <span className="text-xs text-muted">Últimas {periodDays} dias · até {formatPeriod(visibleData.periodEnd)}</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <GoalControl label="Feed" value={goals.feedPerWeek} unit="posts / semana" average={analytics.feedAveragePerWeek} hitWeeks={analytics.feedGoalWeeksHit} weekCount={analytics.weekly.length} onChange={(value) => updateGoal("feedPerWeek", value)} />
          <GoalControl label="Stories" value={goals.storyDaysPerWeek} unit="dias / semana" average={analytics.storyAverageDaysPerWeek} hitWeeks={analytics.storyGoalWeeksHit} weekCount={analytics.weekly.length} onChange={(value) => updateGoal("storyDaysPerWeek", value)} />
        </div>
        <ConsistencyCalendar analytics={analytics} />
        <div className="space-y-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Frequência × seguidores ganhos por semana</h3><span className="text-[11px] text-muted">Cada ponto usa o histórico diário disponível.</span></div>
          <FollowerWeeks analytics={analytics} />
        </div>
        <p className="flex gap-3 rounded-xl bg-foreground px-4 py-3.5 text-sm leading-6 text-white"><span aria-hidden="true" className="mt-0.5 shrink-0 text-accent">↗</span><span>{analytics.insight}</span></p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
        <ReachFunnel analytics={analytics} clicks={visibleData.activityTotals.clicks} />
        <BestTimes analytics={analytics} />
      </div>

      <FormatTable analytics={analytics} />
      <MeasurementNotes />

      <section className="panel flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div><h2 className="text-base font-semibold">Ver as publicações e campanhas</h2><p className="mt-1 text-sm text-muted">Confira métricas por post, campanha ativa e opção para criar uma nova automação.</p></div>
        <Link href="/overview" className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface-hover">Abrir visão geral</Link>
      </section>
    </div>
  );
}
