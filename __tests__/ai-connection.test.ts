import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  aiConnection: { findUnique: vi.fn() },
}));
const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }));
vi.mock("node:dns/promises", () => ({ lookup: dnsMock.lookup }));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: (value: string) => {
    if (!value.startsWith("enc:")) throw new Error("bad ciphertext");
    return value.slice(4);
  },
  encryptToken: (value: string) => `enc:${value}`,
}));

import { listAiModels, pingAiEndpoint } from "@/lib/ai/client";
import { resolveAiConfig, resolveFallbackModels } from "@/lib/ai/config";
import { describeConnection, maskKey } from "@/lib/ai/connection";
import { assertSafeAiUrl, isPrivateAddress, parseAiBaseUrl } from "@/lib/ai/url-safety";

const fetchMock = vi.fn();

function savedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    workspaceId: "ws1",
    baseUrl: "https://saved.example.com/v1",
    apiKeyEncrypted: "enc:saved-secret-key-1234",
    model: "saved-model",
    enabled: true,
    ...overrides,
  };
}

function enableAiEnv() {
  vi.stubEnv("AI_FEATURES_ENABLED", "true");
  vi.stubEnv("AI_API_BASE_URL", "https://env.example.com/v1");
  vi.stubEnv("AI_API_KEY", "env-key");
  vi.stubEnv("AI_MODEL", "env-model");
}

beforeEach(() => {
  fetchMock.mockReset();
  prismaMock.aiConnection.findUnique.mockReset();
  dnsMock.lookup.mockReset();
  dnsMock.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ])("treats %s as internal", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.63.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "treats %s as public",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    }
  );
});

describe("parseAiBaseUrl", () => {
  it("normalizes a public https address", () => {
    expect(parseAiBaseUrl("  https://Router.Example.com/v1/?x=1#top  ")).toBe("https://router.example.com/v1");
  });

  it.each([
    ["http://router.example.com/v1", /https/],
    ["ftp://router.example.com", /https/],
    ["não é url", /válida/],
    ["https://user:pass@router.example.com/v1", /usuário ou senha/],
    ["https://localhost/v1", /rede interna/],
    ["https://postgres/v1", /rede interna/],
    ["https://redis:6379", /rede interna/],
    ["https://db.internal/v1", /rede interna/],
    ["https://printer.local/v1", /rede interna/],
    ["https://127.0.0.1/v1", /rede interna/],
    ["https://169.254.169.254/latest/meta-data", /rede interna/],
    ["https://[::1]/v1", /rede interna/],
    ["https://10.0.0.8/v1", /rede interna/],
  ])("rejects %s", (raw, message) => {
    expect(() => parseAiBaseUrl(raw)).toThrow(message);
  });
});

describe("assertSafeAiUrl", () => {
  it("accepts a name that resolves to public addresses", async () => {
    await expect(assertSafeAiUrl("https://router.example.com/v1")).resolves.toBe("https://router.example.com/v1");
  });

  it("refuses a public name that resolves to a private address, even if only one of them is", async () => {
    dnsMock.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.9", family: 4 },
    ]);
    await expect(assertSafeAiUrl("https://rebind.example.com/v1")).rejects.toThrow(/rede interna/);
  });

  it("reports a name that cannot be found", async () => {
    dnsMock.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafeAiUrl("https://nao-existe.example.com/v1")).rejects.toThrow(/encontrar esse endereço/);
  });
});

describe("resolveAiConfig", () => {
  it("prefers the connection saved in Settings and decrypts the key", async () => {
    enableAiEnv();
    prismaMock.aiConnection.findUnique.mockResolvedValue(savedRow());

    const config = await resolveAiConfig("ws1");

    expect(config).toMatchObject({
      source: "workspace",
      baseUrl: "https://saved.example.com/v1",
      apiKey: "saved-secret-key-1234",
      model: "saved-model",
    });
  });

  it("turns the assistant off when the saved connection is switched off, even if the server has defaults", async () => {
    enableAiEnv();
    prismaMock.aiConnection.findUnique.mockResolvedValue(savedRow({ enabled: false }));
    await expect(resolveAiConfig("ws1")).resolves.toBeNull();
  });

  it("falls back to the server defaults when nothing is saved", async () => {
    enableAiEnv();
    prismaMock.aiConnection.findUnique.mockResolvedValue(null);
    await expect(resolveAiConfig("ws1")).resolves.toMatchObject({ source: "environment", model: "env-model" });
  });

  it("is off when nothing is saved and the server has no defaults", async () => {
    prismaMock.aiConnection.findUnique.mockResolvedValue(null);
    await expect(resolveAiConfig("ws1")).resolves.toBeNull();
  });

  it("is off, without throwing, when the saved key cannot be decrypted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.aiConnection.findUnique.mockResolvedValue(savedRow({ apiKeyEncrypted: "corrompido" }));
    await expect(resolveAiConfig("ws1")).resolves.toBeNull();
  });
});

describe("reserve models", () => {
  const environment = {
    baseUrl: "https://env.example.com/v1",
    apiKey: "k",
    model: "env-model",
    fallbackModels: ["env-backup"],
    monthlyLimit: 200,
  };

  it("uses the list typed in Settings, without the main model", () => {
    expect(
      resolveFallbackModels(
        { baseUrl: "https://saved.example.com/v1", model: "main", fallbackModels: "main, a, b, c, d" },
        environment
      )
    ).toEqual(["a", "b", "c"]);
  });

  it("falls back to the server defaults when the list is blank and the service is the same", () => {
    expect(
      resolveFallbackModels(
        { baseUrl: "https://ENV.example.com/v1/", model: "main", fallbackModels: null },
        environment
      )
    ).toEqual(["env-model", "env-backup"]);
  });

  it("does not borrow the server's models for a different service", () => {
    expect(
      resolveFallbackModels({ baseUrl: "https://other.example.com/v1", model: "main", fallbackModels: null }, environment)
    ).toEqual([]);
    expect(
      resolveFallbackModels({ baseUrl: "https://env.example.com/v1", model: "main", fallbackModels: null }, null)
    ).toEqual([]);
  });

  it("does not list the main model as its own reserve", () => {
    expect(
      resolveFallbackModels({ baseUrl: "https://env.example.com/v1", model: "env-model", fallbackModels: null }, environment)
    ).toEqual(["env-backup"]);
  });

  it("gives the resolved configuration its reserve models", async () => {
    enableAiEnv();
    vi.stubEnv("AI_FALLBACK_MODELS", "env-backup");
    prismaMock.aiConnection.findUnique.mockResolvedValue(
      savedRow({ baseUrl: "https://env.example.com/v1", model: "gemini-x", fallbackModels: null })
    );

    const config = await resolveAiConfig("ws1");

    expect(config?.fallbackModels).toEqual(["env-model", "env-backup"]);
  });

  it("shows the typed list and the implicit one separately", async () => {
    enableAiEnv();
    prismaMock.aiConnection.findUnique.mockResolvedValue(
      savedRow({ baseUrl: "https://env.example.com/v1", fallbackModels: "typed-a, typed-b" })
    );

    const view = await describeConnection("ws1");

    expect(view.fallbackModels).toEqual(["typed-a", "typed-b"]);
    expect(view.implicitFallbackModels).toEqual(["env-model"]);
  });
});

describe("describeConnection", () => {
  it("never includes the key, only a masked tail", async () => {
    prismaMock.aiConnection.findUnique.mockResolvedValue(savedRow());

    const view = await describeConnection("ws1");

    expect(view).toMatchObject({ source: "workspace", enabled: true, model: "saved-model", keyHint: "••••1234" });
    expect(JSON.stringify(view)).not.toContain("saved-secret-key");
  });

  it("describes the server defaults without a key", async () => {
    enableAiEnv();
    prismaMock.aiConnection.findUnique.mockResolvedValue(null);

    const view = await describeConnection("ws1");

    expect(view).toMatchObject({ source: "environment", baseUrl: "https://env.example.com/v1", keyHint: null });
    expect(JSON.stringify(view)).not.toContain("env-key");
  });

  it("reports an empty setup", async () => {
    prismaMock.aiConnection.findUnique.mockResolvedValue(null);
    await expect(describeConnection("ws1")).resolves.toMatchObject({ configured: false, source: "none" });
  });

  it("masks short keys completely", () => {
    expect(maskKey("curta")).toBe("••••");
    expect(maskKey("uma-chave-bem-longa-9876")).toBe("••••9876");
  });
});

describe("connection test helpers", () => {
  const endpoint = { baseUrl: "https://router.example.com/v1", apiKey: "k", model: "m" };

  it("lists the models the service advertises, sorted and without duplicates", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "b" }, { id: "a" }, { id: "b" }, { id: 7 }] }), { status: 200 })
    );
    await expect(listAiModels(endpoint)).resolves.toEqual(["a", "b"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://router.example.com/v1/models");
    expect(init.redirect).toBe("error");
  });

  it("returns no models instead of failing when the service does not list them", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(listAiModels(endpoint)).resolves.toEqual([]);
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(listAiModels(endpoint)).resolves.toEqual([]);
  });

  it("does not even try to list models on an internal address", async () => {
    await expect(listAiModels({ baseUrl: "https://10.0.0.5/v1", apiKey: "k" })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pings the chosen model and reports the time taken", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ model: "real-model", choices: [{ message: { content: "ok" } }] }), { status: 200 })
    );
    const result = await pingAiEndpoint(endpoint);
    expect(result.model).toBe("real-model");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: "m", max_tokens: 32 });
  });
});
