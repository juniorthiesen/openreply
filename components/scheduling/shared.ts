export interface InstagramAccountOption {
  id: string;
  username: string;
  instagramId: string;
  name?: string | null;
  publishingPermissionGranted: boolean;
  storyPublishingReady?: boolean;
}

export interface MediaAsset {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  uploadedBytes?: number;
  status?: "UPLOADING" | "READY";
  createdAt?: string;
  publicUrl?: string | null;
}

export type ScheduledPostStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELED";

export interface ScheduledPost {
  id: string;
  createdAt: string;
  instagramAccountId: string;
  status: ScheduledPostStatus;
  mediaType: "IMAGE" | "REEL" | "CAROUSEL";
  caption: string;
  scheduledAt: string | null;
  timeZone: string;
  shareToFeed: boolean;
  trialGraduationStrategy: import("@/lib/scheduling/trial-reels").TrialReelGraduationStrategy | null;
  instagramMediaId: string | null;
  permalink: string | null;
  publishedAt: string | null;
  lastError: string | null;
  mediaAsset: MediaAsset;
  mediaItems?: Array<{ position: number; mediaAsset: MediaAsset; mediaUrl: string | null }>;
  instagramAccount: { id: string; username: string };
  automation?: { id: string; name: string; isActive: boolean } | null;
  mediaUrl?: string | null;
}

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
}

export interface InstagramProfile {
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
}

export interface AutomationOption {
  id: string;
  name: string;
  isActive: boolean;
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => null) as
    | { success: boolean; data?: T; error?: string }
    | null;
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new Error(payload?.error || "Não foi possível concluir a solicitação.");
  }
  return payload.data;
}

export function formatBytes(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export function localDateTimeValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function formatDateTime(iso: string | null, timeZone?: string): string {
  if (!iso) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function timezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
}
