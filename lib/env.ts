import { z } from "zod";

const HEX_32_BYTE = /^[a-f0-9]{64}$/i;

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function requireEnv(name: string): string {
  return readEnv(name);
}

export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

export function getEncryptionKeyHex(): string {
  const value = readEnv("ENCRYPTION_KEY");
  if (!HEX_32_BYTE.test(value)) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte hex string");
  }
  return value;
}

// Env vars that must be present before an Instagram OAuth round trip can even
// start. Checked up front so a self-hoster with a half-filled .env gets the
// variable names back instead of an unhandled throw from requireEnv().
const INSTAGRAM_OAUTH_ENV = [
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "ENCRYPTION_KEY",
  "NEXTAUTH_SECRET",
] as const;

const FACEBOOK_OAUTH_ENV = [
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_LOGIN_CONFIG_ID",
  "ENCRYPTION_KEY",
  "NEXTAUTH_SECRET",
] as const;

export function getMissingInstagramOAuthEnv(): string[] {
  return INSTAGRAM_OAUTH_ENV.filter((name) => {
    const value = process.env[name];
    if (!value) return true;
    // A malformed key fails later inside encryptToken, after the user has
    // already round-tripped through Meta — catch the bad format here instead.
    return name === "ENCRYPTION_KEY" && !HEX_32_BYTE.test(value);
  });
}

export function getMissingFacebookOAuthEnv(): string[] {
  return FACEBOOK_OAUTH_ENV.filter((name) => {
    const value = process.env[name];
    if (!value) return true;
    return name === "ENCRYPTION_KEY" && !HEX_32_BYTE.test(value);
  });
}

/**
 * Connecting Instagram by pasting an access token skips Meta's OAuth screen.
 * Handy while the app has no Advanced Access, but a reviewer may read it as a
 * way around the official login, so it is off unless explicitly enabled.
 */
export function isManualTokenLoginEnabled(): boolean {
  return process.env.INSTAGRAM_MANUAL_TOKEN_ENABLED === "true";
}

/**
 * The pricing section on the public home page promises limits the app does not
 * enforce yet, and a reviewer compares the site against what the app does. It
 * stays hidden during Meta review unless explicitly enabled.
 */
export function isLandingPricingEnabled(): boolean {
  return process.env.LANDING_PRICING_ENABLED === "true";
}

export interface AiConfig {
  /** Base URL of an OpenAI-compatible API, without a trailing slash (for example https://host/v1). */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Models to try, in order, when the main one fails. */
  fallbackModels: string[];
  /** Generations a workspace may request per calendar month. */
  monthlyLimit: number;
}

const MAX_FALLBACK_MODELS = 3;

/** Split a typed list of model names (commas, semicolons or line breaks) into at most three distinct names. */
export function parseModelList(raw: string | null | undefined, limit: number = MAX_FALLBACK_MODELS): string[] {
  if (!raw) return [];
  const names = raw
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name.length <= 100);
  return [...new Set(names)].slice(0, limit);
}

/** Reserve models from typed text: the main model is dropped first, so it never takes one of the three places. */
export function parseReserveModels(raw: string | null | undefined, mainModel: string): string[] {
  return parseModelList(raw, 50)
    .filter((name) => name !== mainModel)
    .slice(0, MAX_FALLBACK_MODELS);
}

const DEFAULT_AI_MONTHLY_LIMIT = 200;

/** Generations a workspace may request per calendar month, whichever way the AI is configured. */
export function getAiMonthlyLimit(): number {
  const limit = Math.floor(Number(process.env.AI_MONTHLY_LIMIT));
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_AI_MONTHLY_LIMIT;
}

/**
 * Connection data for the AI assistant. Returns null (feature off) unless the
 * flag is "true" and the endpoint, key and model are all set, so a missing value
 * can never leave half of the feature running. Server-side only: the key is
 * never sent to the browser.
 */
export function getAiConfig(): AiConfig | null {
  if (process.env.AI_FEATURES_ENABLED !== "true") return null;
  const baseUrl = process.env.AI_API_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;

  const fallbackModels = parseReserveModels(process.env.AI_FALLBACK_MODELS, model);
  return { baseUrl, apiKey, model, fallbackModels, monthlyLimit: getAiMonthlyLimit() };
}

export function isAiEnabled(): boolean {
  return getAiConfig() !== null;
}

export function getMetaGraphApiVersion(): string {
  return process.env.META_GRAPH_API_VERSION ?? "v25.0";
}

/**
 * The public demo, and the only host where sign-in is blocked. This repo is
 * something other people clone and deploy; a self-hoster's own domain must
 * never match this and must never be blocked from logging in — that's the
 * entire point of self-hosting. Keep this in sync with
 * components/demo-notice.tsx, which uses the same host for its banner.
 */
export const DEMO_HOST = "openreply.diwen.dev";

/**
 * True when the current request is hitting the public demo host. Sign-in is
 * blocked there so the demo can't be mistaken for a real account — anyone who
 * wants an account instead clones the repo and runs their own instance.
 *
 * Reads the incoming Host header rather than NEXTAUTH_URL/an env flag, so a
 * self-hosted deployment never accidentally inherits demo behavior just
 * because it copied an env var from this repo.
 */
export async function isPublicDemoHost(): Promise<boolean> {
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host") ?? "";
  return host.split(":")[0].toLowerCase() === DEMO_HOST;
}

/**
 * Optional sign-in allowlist.
 *
 * A self-hosted instance on a public domain is open to signup: the email
 * provider creates an account for whoever asks for a magic link, and that
 * account gets its own workspace. ALLOWED_EMAILS closes it to a comma-separated
 * list of addresses. Left unset, sign-in behaves exactly as before, so an
 * existing deployment is unaffected.
 */
export function isEmailAllowedToSignIn(
  email: string | null | undefined
): boolean {
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return true;
  if (!email) return false;
  return allowed.includes(email.toLowerCase());
}

export const serverEnvSchema = z.object({
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().regex(HEX_32_BYTE),
});

export function validateCoreEnv() {
  return serverEnvSchema.parse(process.env);
}
