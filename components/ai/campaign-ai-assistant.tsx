"use client";

import { useState } from "react";
import { apiRequest } from "@/components/scheduling/shared";
import { useAiStatus } from "@/components/ai/use-ai-status";
import type { CampaignDraft } from "@/lib/ai/campaign-draft";

interface CampaignAiAssistantProps {
  /** Fill the form with the draft. Nothing is saved until the user saves the campaign. */
  onApply: (draft: CampaignDraft) => void;
}

const MAX_LENGTH = 1000;

export default function CampaignAiAssistant({ onApply }: CampaignAiAssistantProps) {
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);

  if (!status?.enabled) return null;

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setDraft(null);
    try {
      const data = await apiRequest<{
        draft: CampaignDraft;
        remaining: number;
        model: string;
        notice: string | null;
      }>("/api/ai/campaign-draft", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      setDraft(data.draft);
      setRemaining(data.remaining);
      setModelUsed(data.model);
      setNotice(data.notice);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Não foi possível gerar agora.");
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!draft) return;
    onApply(draft);
    setDraft(null);
    setPrompt("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-left text-sm transition hover:bg-accent/10"
      >
        <span className="font-semibold text-foreground">Criar com IA</span>
        <span className="ml-2 text-muted">Descreva a campanha em uma frase e receba um rascunho.</span>
      </button>
    );
  }

  return (
    <section aria-label="Criar campanha com IA" className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Criar com IA</h2>
          <p className="mt-0.5 text-xs text-muted">
            Conte o que você quer enviar e quando. Se tiver um link, cole no texto.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-foreground">
          Fechar
        </button>
      </div>

      <label className="sr-only" htmlFor="ai-campaign-prompt">Descreva a campanha</label>
      <textarea
        id="ai-campaign-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder="Ex.: quando comentarem EU QUERO no reel, mandar o link do meu e-book https://exemplo.com/ebook"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {prompt.length}/{MAX_LENGTH}
          {status.remaining !== undefined && ` · ${remaining ?? status.remaining} gerações restantes neste mês`}
        </span>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy || prompt.trim().length < 5}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
        >
          {busy ? "Gerando…" : "Gerar rascunho"}
        </button>
      </div>

      {error && <p role="alert" className="text-xs text-error">{error}</p>}
      {notice && (
        <p role="status" className="rounded border border-accent/30 bg-surface p-2 text-xs text-foreground">
          {notice}
        </p>
      )}

      {draft && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
          <p className="text-xs font-medium text-muted">
            Sugestão gerada por IA{modelUsed ? ` (${modelUsed})` : ""}. Revise antes de salvar.
          </p>
          <div>
            <p className="text-xs text-muted">Nome</p>
            <p className="text-foreground">{draft.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Palavras-chave</p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {draft.keywords.map((keyword) => (
                <span key={keyword} className="rounded bg-surface-hover px-2 py-0.5 text-xs font-semibold text-foreground">
                  {keyword}
                </span>
              ))}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Mensagem direta</p>
            <p className="whitespace-pre-wrap text-foreground">{draft.dmMessage}</p>
          </div>
          {draft.publicReplyMessages.length > 0 && (
            <div>
              <p className="text-xs text-muted">Respostas públicas</p>
              <ul className="list-disc space-y-0.5 pl-5 text-foreground">
                {draft.publicReplyMessages.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </div>
          )}
          {draft.followUpMessage && (
            <div>
              <p className="text-xs text-muted">Mensagem de acompanhamento</p>
              <p className="whitespace-pre-wrap text-foreground">{draft.followUpMessage}</p>
            </div>
          )}
          <p className="text-xs text-muted">
            {draft.linkUrl ? `Link: ${draft.linkUrl}` : "Nenhum link foi informado. Adicione o seu depois de aplicar."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95"
            >
              Aplicar ao formulário
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
