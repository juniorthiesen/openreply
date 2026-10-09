/** Pure helpers for Stories posted outside Fisga. No database or network access here. */

export const EXTERNAL_METRICS_REFRESH_INTERVAL_MS = 20 * 60 * 1000;

export interface LiveStoryLike {
  id: string;
  timestamp: string;
}

/** Keep only Stories Fisga did not publish itself. */
export function filterExternalStories<T extends LiveStoryLike>(
  liveStories: readonly T[],
  fisgaMediaIds: ReadonlySet<string>
): T[] {
  return liveStories.filter((story) => !fisgaMediaIds.has(story.id));
}

/** True when there is no snapshot yet, or the last one is older than the refresh interval. */
export function needsMetricsRefresh(
  lastCapturedAt: Date | null | undefined,
  now: Date = new Date(),
  intervalMs: number = EXTERNAL_METRICS_REFRESH_INTERVAL_MS
): boolean {
  if (!lastCapturedAt) return true;
  return now.getTime() - lastCapturedAt.getTime() >= intervalMs;
}

export const DEFAULT_EXTERNAL_MEDIA_RETENTION_DAYS = 7;
const MAX_EXTERNAL_MEDIA_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days to keep the downloaded media. Invalid or missing values fall back to 7. */
export function parseMediaRetentionDays(raw: string | undefined): number {
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1) return DEFAULT_EXTERNAL_MEDIA_RETENTION_DAYS;
  return Math.min(Math.floor(days), MAX_EXTERNAL_MEDIA_RETENTION_DAYS);
}

export function getExternalMediaRetentionDays(): number {
  return parseMediaRetentionDays(process.env.EXTERNAL_STORY_MEDIA_RETENTION_DAYS);
}

/** True when a stored copy has outlived the retention window and should be deleted. */
export function isMediaPurgeDue(storedAt: Date | null | undefined, now: Date, retentionDays: number): boolean {
  if (!storedAt) return false;
  return now.getTime() - storedAt.getTime() >= retentionDays * DAY_MS;
}

const ALLOWED_MEDIA_HOST = /(^|\.)(fbcdn\.net|cdninstagram\.com)$/i;

/** Only download from Meta's own CDN hosts, over HTTPS. */
export function isAllowedStoryMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED_MEDIA_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function externalMediaStorageKey(storyId: string, extension: "jpg" | "mp4" | "mov"): string {
  return `ext_${storyId}.${extension}`;
}

export interface ExternalStoryExportRow {
  instagramMediaId: string;
  username: string;
  mediaType: string | null;
  caption: string | null;
  permalink: string | null;
  postedAt: Date;
  firstSeenAt: Date;
  lastCapturedAt: Date | null;
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  follows: number | null;
  profileVisits: number | null;
  totalInteractions: number | null;
}

const CSV_COLUMNS: Array<[string, (row: ExternalStoryExportRow) => string | number | null]> = [
  ["id_midia", (r) => r.instagramMediaId],
  ["conta", (r) => r.username],
  ["tipo", (r) => r.mediaType],
  ["legenda", (r) => r.caption],
  ["link", (r) => r.permalink],
  ["publicado_em", (r) => r.postedAt.toISOString()],
  ["visto_pela_primeira_vez_em", (r) => r.firstSeenAt.toISOString()],
  ["ultima_captura_em", (r) => r.lastCapturedAt?.toISOString() ?? null],
  ["alcance", (r) => r.reach],
  ["visualizacoes", (r) => r.views],
  ["respostas", (r) => r.replies],
  ["compartilhamentos", (r) => r.shares],
  ["novos_seguidores", (r) => r.follows],
  ["visitas_ao_perfil", (r) => r.profileVisits],
  ["interacoes_totais", (r) => r.totalInteractions],
];

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Quote anything with a delimiter, quote or line break; also defuse spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function externalStoriesToCsv(rows: readonly ExternalStoryExportRow[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map(([, pick]) => csvCell(pick(row))).join(","));
  return `${[header, ...lines].join("\r\n")}\r\n`;
}
