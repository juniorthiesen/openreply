import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AiError } from "@/lib/ai/errors";

/**
 * The AI address is typed in Settings and fetched by the server, so it must not
 * be able to point the server at its own network (the database, Redis, cloud
 * metadata). Only public https hosts are accepted.
 */

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

/** True for loopback, private, link-local, shared, documentation, multicast and reserved addresses. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");

  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b, c] = v4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (ip.includes(":")) {
    const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      ip === "::" ||
      ip === "::1" ||
      /^f[cd]/.test(ip) ||
      /^fe[89ab]/.test(ip) ||
      ip.startsWith("ff") ||
      ip.startsWith("2001:db8")
    );
  }

  return false;
}

const BLOCKED_HOST_SUFFIX = /(^|\.)(localhost|local|internal|localdomain|lan|home|corp|intranet)$/;

/** Validate and normalize the address without touching the network. */
export function parseAiBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AiError("O endereço da IA não é uma URL válida.", 400);
  }
  if (url.protocol !== "https:") {
    throw new AiError("O endereço da IA deve começar com https://.", 400);
  }
  if (url.username || url.password) {
    throw new AiError("Não coloque usuário ou senha no endereço. Use o campo da chave.", 400);
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new AiError("Esse endereço aponta para uma rede interna e não é permitido.", 400);
  } else if (!host.includes(".") || BLOCKED_HOST_SUFFIX.test(host)) {
    throw new AiError("Esse endereço aponta para uma rede interna e não é permitido.", 400);
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

/** Like parseAiBaseUrl, and also refuses a public name that resolves to a private address. */
export async function assertSafeAiUrl(raw: string): Promise<string> {
  const normalized = parseAiBaseUrl(raw);
  const host = new URL(normalized).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return normalized;

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new AiError("Não foi possível encontrar esse endereço. Confira se está escrito certo.", 400);
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AiError("Esse endereço aponta para uma rede interna e não é permitido.", 400);
  }
  return normalized;
}
