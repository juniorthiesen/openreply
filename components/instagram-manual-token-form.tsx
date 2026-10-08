"use client";

import { useState } from "react";

export function InstagramManualTokenForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function connectWithToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/instagram/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Não foi possível validar esse token.");
        return;
      }

      window.location.reload();
    } catch {
      setError("Não foi possível validar esse token. Tente novamente.");
    } finally {
      setToken("");
      setPending(false);
    }
  }

  return (
    <details className="mt-4 border-t border-border pt-4">
      <summary className="cursor-pointer text-sm font-medium text-accent hover:text-accent-hover">
        Conectar com token de acesso (alternativo)
      </summary>
      <p className="mt-3 text-xs leading-5 text-muted">
        Use um token de usuário do Instagram Login gerado no mesmo app da Meta.
        Para publicar, ele precisa ter a permissão de conteúdo. O token será
        validado pelo servidor e salvo criptografado; tokens manuais não têm
        renovação automática.
      </p>
      <form onSubmit={connectWithToken} className="mt-4 space-y-3">
        <label htmlFor="instagram-access-token" className="block text-sm font-medium text-foreground">
          Token de acesso do Instagram
        </label>
        <input
          id="instagram-access-token"
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={4096}
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          placeholder="Cole o token de acesso"
        />
        {error && (
          <p role="alert" className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || !token.trim()}
          className="inline-flex items-center justify-center rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Validando token…" : "Validar e conectar"}
        </button>
      </form>
    </details>
  );
}
