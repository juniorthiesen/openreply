/**
 * Access tokens for the MCP endpoint.
 *
 * A token is 256 random bits behind a recognisable prefix. Only its SHA-256 is
 * stored: the token already has full entropy, so a plain hash cannot be guessed
 * back from a database leak, and lookup stays a single indexed read.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";

export const API_TOKEN_PREFIX = "fsg_";

// Plenty for a well-formed token; stops a huge header from being hashed.
const MAX_TOKEN_LENGTH = 200;

// lastUsedAt is informational, so it is written at most this often per token
// instead of on every tool call.
const LAST_USED_WRITE_INTERVAL_MS = 10 * 60 * 1000;

export type ApiTokenScope = "READ" | "WRITE";

export interface ApiTokenContext {
  tokenId: string;
  workspaceId: string;
  scope: ApiTokenScope;
  name: string;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashApiToken(token),
    tokenPrefix: token.slice(0, API_TOKEN_PREFIX.length + 4),
  };
}

/** The token from an `Authorization: Bearer <token>` header, or null. */
export function readBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  if (!token.startsWith(API_TOKEN_PREFIX) || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/** Resolve a request's Authorization header to the workspace it may act on. */
export async function authenticateApiToken(
  header: string | null
): Promise<ApiTokenContext | null> {
  const token = readBearerToken(header);
  if (!token) return null;

  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      scope: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  if (!row || row.revokedAt) return null;

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    // Never let bookkeeping fail a request that is otherwise authorised.
    void prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return { tokenId: row.id, workspaceId: row.workspaceId, scope: row.scope, name: row.name };
}
