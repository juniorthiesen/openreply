import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { getEncryptionKeyHex, getMetaGraphApiVersion, requireEnv } from "@/lib/env";

// Instagram API with Instagram Login authorizes on www.instagram.com. The old
// api.instagram.com/oauth/authorize host belonged to the retired Basic Display
// API and now 404s ("Sorry, this page isn't available"), which looks like a bad
// link rather than a wrong endpoint. The token exchange below still lives on
// api.instagram.com — only the authorize hop moved.
const INSTAGRAM_OAUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

interface OAuthStatePayload {
  workspaceId: string;
  ts: number;
  provider?: "instagram" | "facebook";
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signState(payload: string): string {
  return createHmac("sha256", requireEnv("NEXTAUTH_SECRET"))
    .update(payload)
    .digest("base64url");
}

export function createOAuthState(
  workspaceId: string,
  provider: OAuthStatePayload["provider"] = "instagram"
): string {
  const payload = base64UrlEncode(
    JSON.stringify({ workspaceId, ts: Date.now(), provider } satisfies OAuthStatePayload)
  );
  return `${payload}.${signState(payload)}`;
}

/** Facebook Login is used for Page messaging and for Instagram insights.
 * Keep its authorization path independent from Instagram Login so an existing
 * Instagram-only installation continues to work unchanged. */
export function getFacebookAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    // Facebook Login for Business binds granted Page/Instagram permissions to a
    // dashboard configuration. The generic `scope` parameter bypasses that
    // configuration and Meta rejects the dialog for an app that only has the
    // Business Login product enabled.
    config_id: requireEnv("FACEBOOK_LOGIN_CONFIG_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth?${params.toString()}`;
}

export function verifyOAuthState(state: string | null): OAuthStatePayload | null {
  if (!state) return null;

  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = signState(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as OAuthStatePayload;
    if (typeof parsed.workspaceId !== "string" || !parsed.workspaceId) {
      return null;
    }

    // Reject a missing or non-numeric timestamp. `Date.now() - "abc"` is NaN,
    // and every comparison against NaN is false, so a non-numeric ts would
    // otherwise pass the age check and never expire. A ts in the future is
    // rejected for the same reason: it has not aged at all.
    if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) {
      return null;
    }

    const age = Date.now() - parsed.ts;
    if (age < 0 || age > STATE_MAX_AGE_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function getAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("INSTAGRAM_APP_ID"),
    redirect_uri: redirectUri,
    scope:
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights,instagram_business_content_publish",
    response_type: "code",
    state,
  });

  return `${INSTAGRAM_OAUTH_URL}?${params.toString()}`;
}

export const INSTAGRAM_PUBLISH_SCOPE = "instagram_business_content_publish";

/** Without these the app cannot answer comments or DMs, so a connect missing
 * any of them is refused instead of looking connected and failing later. */
export const REQUIRED_INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
] as const;

/**
 * The token exchange reports the scopes the user actually granted — the
 * consent screen lets them untick some. Meta has returned both a
 * comma-separated string and an array here; null means it sent neither.
 */
export function parseGrantedScopes(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return decodeURIComponent(value)
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  return null;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; userId: string; grantedScopes: string[] | null }> {
  // The Instagram Login token endpoint expects multipart form data. Sending
  // urlencoded data is accepted by the old Basic Display flow but is rejected
  // by the Instagram API with Instagram Login as an unsupported GET request.
  const body = new FormData();
  body.set("client_id", requireEnv("INSTAGRAM_APP_ID"));
  body.set("client_secret", requireEnv("INSTAGRAM_APP_SECRET"));
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", redirectUri);
  body.set("code", code);

  const response = await fetch(INSTAGRAM_TOKEN_URL, {
    method: "POST",
    // Do not set Content-Type manually: fetch adds the multipart boundary.
    body,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Token exchange failed: ${error.error_message || JSON.stringify(error)}`
    );
  }

  // Documented as `{ data: [{ ... }] }`, observed flat; accept either.
  const json = await response.json();
  const data = Array.isArray(json?.data) ? json.data[0] ?? {} : json;
  return {
    accessToken: data.access_token,
    userId: String(data.user_id),
    grantedScopes: parseGrantedScopes(data.permissions),
  };
}

function getEncryptionKey(): Buffer {
  return Buffer.from(getEncryptionKeyHex(), "hex");
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]);

  return combined.toString("base64");
}

export function decryptToken(encryptedBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}
