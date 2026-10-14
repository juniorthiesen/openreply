"use client";

/**
 * Settings section for MCP access: create a token (read-only or read and
 * write), copy a ready-made connection command, and revoke tokens.
 *
 * The plain token exists only in this component's state, right after it is
 * created. The server keeps nothing but its hash, so it cannot be shown again.
 */

import { useCallback, useEffect, useState } from "react";

interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: "READ" | "WRITE";
  lastUsedAt: string | null;
  createdAt: string;
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none";

function formatWhen(iso: string | null): string {
  if (!iso) return "nunca usado";
  return `usado em ${new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}`;
}

export default function McpTokens() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"READ" | "WRITE">("READ");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/api-tokens")
      .then(async (response) => ({ status: response.status, payload: await response.json() }))
      .then(({ status, payload }) => {
        if (cancelled) return;
        if (status === 403) setAllowed(false);
        else if (payload.success) setTokens(payload.data.tokens);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function createToken() {
    setBusy("create");
    setError(null);
    try {
      const response = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scope }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Não foi possível criar o token.");
        return;
      }
      setSecret(payload.data.secret);
      setName("");
      reload();
    } catch {
      setError("Não foi possível criar o token.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(token: TokenRow) {
    if (!confirm(`Revogar o token “${token.name}”? Quem usa esse token perde o acesso na hora.`)) return;
    setBusy(token.id);
    try {
      const response = await fetch(`/api/api-tokens?id=${token.id}`, { method: "DELETE" });
      if (response.ok) setTokens((current) => current.filter((item) => item.id !== token.id));
    } finally {
      setBusy(null);
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  }

  if (loaded && !allowed) return null;

  const endpoint = `${typeof window === "undefined" ? "" : window.location.origin}/api/mcp`;
  const command = secret
    ? `claude mcp add --transport http fisga ${endpoint} --header "Authorization: Bearer ${secret}"`
    : "";

  return (
    <section className="panel rounded p-4 sm:p-6">
      <h2 className="mb-2 text-base font-semibold">Acesso por MCP</h2>
      <p className="mb-5 text-sm text-muted">
        Conecte o Claude Code, o Claude Desktop ou o Cursor ao FISGA para consultar relatórios e criar campanhas por
        conversa. Cada token vale para este espaço de trabalho.
      </p>

      {secret && (
        <div className="mb-5 space-y-3 rounded border border-accent/30 bg-accent/5 p-4">
          <p className="text-sm font-semibold text-foreground">Copie agora: este token não aparece de novo.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 break-all rounded bg-surface px-3 py-2 text-xs text-foreground">{secret}</code>
            <button type="button" onClick={() => copy("token", secret)} className="rounded border border-border bg-surface px-3 py-2 text-xs font-semibold hover:bg-surface-hover">
              {copied === "token" ? "Copiado" : "Copiar token"}
            </button>
          </div>
          <p className="text-xs text-muted">No Claude Code, rode:</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 break-all rounded bg-surface px-3 py-2 text-xs text-foreground">{command}</code>
            <button type="button" onClick={() => copy("command", command)} className="rounded border border-border bg-surface px-3 py-2 text-xs font-semibold hover:bg-surface-hover">
              {copied === "command" ? "Copiado" : "Copiar comando"}
            </button>
          </div>
          <p className="text-xs text-muted">
            Em outros clientes, use o endereço <span className="break-all text-foreground">{endpoint}</span> com o cabeçalho{" "}
            <span className="text-foreground">Authorization: Bearer &lt;token&gt;</span>.
          </p>
          <button type="button" onClick={() => setSecret(null)} className="text-xs font-semibold text-accent hover:underline">
            Já copiei, fechar
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="block space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Nome do token</span>
          <input className={inputClass} value={name} maxLength={60} placeholder="Ex.: Claude Code do notebook" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Acesso</span>
          <select className={inputClass} value={scope} onChange={(e) => setScope(e.target.value as "READ" | "WRITE")}>
            <option value="READ">Somente leitura</option>
            <option value="WRITE">Leitura e escrita</option>
          </select>
        </label>
        <button
          type="button"
          onClick={createToken}
          disabled={busy === "create" || !name.trim()}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === "create" ? "Criando..." : "Criar token"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        “Leitura e escrita” permite criar e editar campanhas. Campanhas criadas assim nascem pausadas. Não há como apagar campanhas por MCP.
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}

      <div className="mt-5 space-y-2">
        {loaded && tokens.length === 0 && <p className="rounded border border-border bg-surface/70 p-4 text-sm text-muted">Nenhum token criado.</p>}
        {tokens.map((token) => (
          <div key={token.id} className="flex flex-col gap-2 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{token.name}</p>
              <p className="mt-0.5 text-xs text-muted">
                {token.tokenPrefix}… · {token.scope === "WRITE" ? "leitura e escrita" : "somente leitura"} · {formatWhen(token.lastUsedAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void revoke(token)}
              disabled={busy === token.id}
              className="inline-flex items-center justify-center rounded border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
            >
              {busy === token.id ? "Revogando..." : "Revogar"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
