import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  apiToken: { findUnique: vi.fn(), update: vi.fn() },
}));
const service = vi.hoisted(() => ({
  createCampaign: vi.fn(),
  updateCampaign: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/campaigns/service", async () => ({
  ...(await vi.importActual<typeof import("@/lib/campaigns/service")>("@/lib/campaigns/service")),
  ...service,
}));

import { POST, GET } from "@/app/api/mcp/route";
import {
  generateApiToken,
  hashApiToken,
  readBearerToken,
} from "@/lib/mcp/tokens";
import { sortPostsBy } from "@/lib/mcp/server";
import { buildDailySeries } from "@/lib/reports/workspace-report";
import type { OverviewPost } from "@/lib/instagram/overview-data";

const readToken = generateApiToken();
const writeToken = generateApiToken();

function tokenRow(token: { tokenHash: string }, scope: "READ" | "WRITE") {
  return { id: `id-${scope}`, workspaceId: "ws1", name: scope, scope, lastUsedAt: new Date(), revokedAt: null, tokenHash: token.tokenHash };
}

function call(token: string | null, body: unknown) {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

beforeEach(() => {
  vi.clearAllMocks();
  db.apiToken.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => {
    if (where.tokenHash === readToken.tokenHash) return tokenRow(readToken, "READ");
    if (where.tokenHash === writeToken.tokenHash) return tokenRow(writeToken, "WRITE");
    return null;
  });
  db.apiToken.update.mockResolvedValue({});
});

describe("API tokens", () => {
  it("hashes the token and never stores it", () => {
    expect(readToken.token.startsWith("fsg_")).toBe(true);
    expect(readToken.tokenHash).toBe(hashApiToken(readToken.token));
    expect(readToken.tokenHash).not.toContain(readToken.token);
    expect(readToken.tokenPrefix).toBe(readToken.token.slice(0, 8));
  });

  it("reads only a well-formed Bearer token", () => {
    expect(readBearerToken(`Bearer ${readToken.token}`)).toBe(readToken.token);
    expect(readBearerToken("Bearer nope")).toBeNull();
    expect(readBearerToken(readToken.token)).toBeNull();
    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken(`Bearer fsg_${"x".repeat(300)}`)).toBeNull();
  });
});

describe("POST /api/mcp", () => {
  it("rejects a missing, malformed, unknown or revoked token with 401", async () => {
    expect((await call(null, listTools)).status).toBe(401);
    expect((await call("fsg_unknown", listTools)).status).toBe(401);
    db.apiToken.findUnique.mockResolvedValueOnce({ ...tokenRow(readToken, "READ"), revokedAt: new Date() });
    const revoked = await call(readToken.token, listTools);
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("answers 405 to GET: there is no server-initiated stream", async () => {
    expect((await GET()).status).toBe(405);
  });

  it("shows a READ token the reports but not the write tools", async () => {
    const response = await call(readToken.token, listTools);
    expect(response.status).toBe(200);
    const names = (await response.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["list_campaigns", "get_campaign_report", "get_workspace_report", "get_instagram_posts"])
    );
    expect(names).not.toContain("create_campaign");
    expect(names).not.toContain("update_campaign");
  });

  it("shows a WRITE token the write tools, and none that deletes", async () => {
    const names = (await (await call(writeToken.token, listTools)).json()).result.tools.map(
      (tool: { name: string }) => tool.name
    );
    expect(names).toEqual(expect.arrayContaining(["create_campaign", "update_campaign"]));
    expect(names.some((name: string) => /delete|remove/.test(name))).toBe(false);
  });

  it("refuses to call a write tool with a READ token", async () => {
    const response = await call(readToken.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "create_campaign", arguments: { name: "x", dmMessage: "y", matchAnyPost: true, matchAnyWord: true } },
    });
    const body = await response.json();
    expect(service.createCampaign).not.toHaveBeenCalled();
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });

  it("creates a campaign paused unless activate is set, in the token's workspace", async () => {
    service.createCampaign.mockResolvedValue({ ok: true, data: { id: "c1", name: "Promo", isActive: false } });
    const args = { name: "Promo", dmMessage: "Oi!", keywords: ["quero"], postId: "123" };
    const response = await call(writeToken.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "create_campaign", arguments: args },
    });
    const body = await response.json();
    expect(service.createCampaign).toHaveBeenCalledWith("ws1", expect.objectContaining({ name: "Promo", isActive: false }));
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ created: true, active: false });

    service.createCampaign.mockClear();
    await call(writeToken.token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "create_campaign", arguments: { ...args, activate: true } },
    });
    expect(service.createCampaign).toHaveBeenCalledWith("ws1", expect.objectContaining({ isActive: true }));
  });

  it("reports an invalid campaign as a tool error without creating it", async () => {
    const response = await call(writeToken.token, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "create_campaign", arguments: { name: "Sem gatilho", dmMessage: "Oi" } },
    });
    const body = await response.json();
    expect(service.createCampaign).not.toHaveBeenCalled();
    expect(body.result.isError).toBe(true);
  });
});

describe("report helpers", () => {
  const post = (id: string, over: Partial<OverviewPost>): OverviewPost => ({
    id, caption: null, permalink: null, thumbnailUrl: null, mediaType: "REELS",
    timestamp: "2026-10-01T00:00:00Z", views: null, reach: null, likes: 0, comments: 0,
    saved: null, shares: null, follows: null, isTrialReel: false, trialInsightsAvailable: null,
    campaigns: [], ...over,
  });

  it("ranks posts largest first and puts posts without a figure last", () => {
    const ranked = sortPostsBy(
      [post("a", { comments: 2 }), post("b", { comments: 53 }), post("c", { follows: null, comments: 9 })],
      "comments"
    );
    expect(ranked.map((p) => p.id)).toEqual(["b", "c", "a"]);
    const byFollows = sortPostsBy([post("a", { follows: null }), post("b", { follows: 4 })], "follows");
    expect(byFollows.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("builds a continuous day series, zero for quiet days", () => {
    const now = new Date("2026-10-14T15:00:00Z");
    const series = buildDailySeries(3, new Map([["2026-10-14", 5]]), new Map([["2026-10-13", 2]]), now);
    expect(series).toEqual([
      { date: "2026-10-12", sent: 0, clicks: 0 },
      { date: "2026-10-13", sent: 0, clicks: 2 },
      { date: "2026-10-14", sent: 5, clicks: 0 },
    ]);
  });
});
