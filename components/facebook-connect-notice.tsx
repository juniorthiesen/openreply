"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type PageCandidate = {
  id: string;
  name: string;
  username?: string;
  instagramBusinessAccount?: { id: string; username?: string };
};

const messages: Record<string, { title: string; detail: string }> = {
  denied: {
    title: "Conexão com o Facebook cancelada",
    detail: "Você recusou as permissões solicitadas pelo Facebook.",
  },
  invalid: {
    title: "Conexão expirada",
    detail: "O link de login do Facebook não é mais válido. Tente novamente.",
  },
  forbidden: {
    title: "Sem permissão",
    detail: "Somente proprietários e administradores podem conectar uma Página.",
  },
  no_pages: {
    title: "Nenhuma Página disponível",
    detail: "A conta do Facebook autorizada não tem uma Página que você possa administrar.",
  },
  failed: {
    title: "Não foi possível concluir a conexão",
    detail: "Verifique se o Facebook Login e as permissões da Página foram configurados no app da Meta.",
  },
};

export function FacebookConnectNotice() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("facebook");
  const connection = searchParams.get("connection");
  const [pages, setPages] = useState<PageCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "pick_page" || !connection) return;
    fetch(`/api/facebook/pending?connection=${encodeURIComponent(connection)}`)
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setPages(payload.data.pages);
        else setError(payload.error ?? "A sessão de conexão expirou.");
      })
      .catch(() => setError("Não foi possível carregar as Páginas do Facebook."));
  }, [connection, status]);

  async function selectPage(pageId: string) {
    if (!connection) return;
    setBusy(pageId);
    setError(null);
    const res = await fetch("/api/facebook/pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection, pageId }),
    });
    const payload = await res.json();
    if (payload.success) {
      router.replace("/settings?facebook=connected");
      router.refresh();
    } else {
      setError(payload.error ?? "Não foi possível conectar a Página.");
      setBusy(null);
    }
  }

  if (status === "connected") {
    return (
      <div className="rounded border border-success/20 bg-success/10 p-4 text-sm text-success">
        <p className="font-semibold">Página do Facebook conectada</p>
        <p className="mt-1 opacity-90">Os webhooks da Página foram solicitados. Configure os campos de webhook no painel da Meta para ativar as mensagens.</p>
      </div>
    );
  }

  if (status === "misconfigured") {
    const missing = (searchParams.get("missing") ?? "").split(",").filter(Boolean);
    return (
      <div className="rounded border border-error/20 bg-error/10 p-4 text-sm text-error">
        <p className="font-semibold">Facebook Login não configurado</p>
        <p className="mt-1">Defina {missing.join(", ") || "as variáveis necessárias"} e reinicie o servidor.</p>
      </div>
    );
  }

  if (status !== "pick_page") {
    const message = status ? messages[status] : null;
    return message ? (
      <div className="rounded border border-warning/20 bg-warning/10 p-4 text-sm text-warning">
        <p className="font-semibold">{message.title}</p>
        <p className="mt-1 opacity-90">{message.detail}</p>
      </div>
    ) : null;
  }

  return (
    <div className="rounded border border-accent/30 bg-accent/5 p-4 text-sm">
      <p className="font-semibold text-foreground">Escolha a Página do Facebook</p>
      <p className="mt-1 text-muted">A Página escolhida receberá o token e a assinatura de webhook deste espaço de trabalho.</p>
      {error && <p className="mt-3 text-error">{error}</p>}
      {!pages && !error && <p className="mt-3 text-muted">Carregando Páginas…</p>}
      <div className="mt-4 space-y-2">
        {pages?.map((page) => (
          <button
            key={page.id}
            type="button"
            disabled={busy !== null}
            onClick={() => selectPage(page.id)}
            className="flex w-full items-center justify-between rounded border border-border bg-surface p-3 text-left transition-colors hover:border-accent/50 disabled:opacity-50"
          >
            <span>
              <span className="block font-medium text-foreground">{page.name}</span>
              <span className="block text-xs text-muted">
                {page.instagramBusinessAccount
                  ? `Instagram profissional vinculado: @${page.instagramBusinessAccount.username ?? page.instagramBusinessAccount.id}`
                  : "Sem Instagram profissional vinculado"}
              </span>
            </span>
            <span className="text-xs font-semibold text-accent">{busy === page.id ? "Conectando…" : "Selecionar"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
