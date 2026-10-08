"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/components/scheduling/shared";

interface ReplyRule {
  id: string;
  keyword: string;
  message: string;
  linkUrl: string | null;
  isActive: boolean;
  people: number;
  sent: number;
  bySlide: { position: number; people: number }[];
}

/**
 * Instagram's API can't add link, poll or question stickers to a Story. The
 * workaround the brand uses instead: the Story says "Responde LINK", and a
 * reply with that word gets a DM. Several words on one sequence read as a poll.
 */
export function StoryReplyRules({
  sequenceId,
  editable,
}: {
  sequenceId: string | null;
  editable: boolean;
}) {
  const [rules, setRules] = useState<ReplyRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [message, setMessage] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped after a create/delete to read the rules again.
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!sequenceId) return;
    let cancelled = false;
    apiRequest<ReplyRule[]>(`/api/instagram/stories/${encodeURIComponent(sequenceId)}/reply-campaigns`)
      .then((data) => {
        if (!cancelled) setRules(data);
      })
      // Results are a bonus on this screen; a failed read shouldn't block editing.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sequenceId, version]);

  async function addRule(event: FormEvent) {
    event.preventDefault();
    if (!sequenceId) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/instagram/stories/${encodeURIComponent(sequenceId)}/reply-campaigns`, {
        method: "POST",
        body: JSON.stringify({ keyword: keyword.trim().toUpperCase(), message, linkUrl }),
      });
      setKeyword("");
      setMessage("");
      setLinkUrl("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar a resposta.");
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(rule: ReplyRule) {
    if (!sequenceId || !confirm(`Remover a resposta para ${rule.keyword}?`)) return;
    setBusy(true);
    try {
      await apiRequest(
        `/api/instagram/stories/${encodeURIComponent(sequenceId)}/reply-campaigns?campaignId=${encodeURIComponent(rule.id)}`,
        { method: "DELETE" }
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a resposta.");
    } finally {
      setBusy(false);
    }
  }

  // Read-only cards (published sequences) only show something when rules exist.
  if (!editable && (!loaded || rules.length === 0)) return null;

  const totalPeople = rules.reduce((sum, rule) => sum + rule.people, 0);
  const isPoll = rules.length > 1;

  return (
    <div className={editable ? "mt-6 border-t border-border pt-5" : "mt-4"}>
      {editable && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Respostas no direct</h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            A Meta não deixa colocar link nem enquete clicável pela API. Escreva no Story algo
            como <span className="font-mono text-foreground">Responde LINK</span> e defina aqui o que
            a pessoa recebe. Com duas palavras ou mais, vira uma enquete.
          </p>
        </div>
      )}

      {!editable && <p className="mb-2 text-xs font-semibold text-foreground">{isPoll ? "Enquete por resposta" : "Respostas por palavra-chave"}</p>}

      {editable && !sequenceId ? (
        <p className="rounded-xl border border-dashed border-border bg-bg px-4 py-3 text-xs text-muted">
          Salve a sequência como rascunho para adicionar respostas por palavra-chave.
        </p>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => {
            const share = totalPeople > 0 ? rule.people / totalPeople : 0;
            return (
              <li key={rule.id} className="overflow-hidden rounded-[10px] bg-foreground text-white">
                <div className="flex items-start gap-2.5 px-3.5 py-3 text-[13px]">
                  <span className="shrink-0 pt-0.5">Quem responder</span>
                  <span className="inline-flex h-7 shrink-0 items-center rounded-md bg-[#F26B3A] px-2.5 font-mono text-[13px] text-foreground">
                    {rule.keyword}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5 text-white/80">
                    recebe: <span className="text-white">{rule.message}</span>
                    {rule.linkUrl && <span className="block truncate text-xs text-white/60">+ botão com {rule.linkUrl}</span>}
                  </span>
                  {editable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeRule(rule)}
                      aria-label={`Remover resposta para ${rule.keyword}`}
                      className="shrink-0 rounded px-1.5 text-white/60 hover:text-white disabled:opacity-50"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 border-t border-white/10 px-3.5 py-2 text-xs">
                  {isPoll && (
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
                      <span className="block h-full rounded-full bg-[#F26B3A]" style={{ width: `${Math.round(share * 100)}%` }} />
                    </span>
                  )}
                  <span className="tabular-nums text-white/80">
                    {rule.people} {rule.people === 1 ? "pessoa" : "pessoas"}
                    {isPoll && totalPeople > 0 ? ` · ${Math.round(share * 100)}%` : ""}
                    {rule.bySlide.length > 0 && ` · ${rule.bySlide.map((slide) => `quadro ${slide.position}: ${slide.people}`).join(", ")}`}
                  </span>
                </div>
              </li>
            );
          })}
          {editable && loaded && rules.length === 0 && (
            <li className="rounded-xl border border-dashed border-border bg-bg px-4 py-3 text-xs text-muted">
              Nenhuma resposta ainda. Comece com uma palavra como LINK, ou SIM e NÃO para uma enquete.
            </li>
          )}
        </ul>
      )}

      {editable && sequenceId && (
        <form onSubmit={(event) => void addRule(event)} className="mt-3 grid gap-2 rounded-xl border border-border bg-bg p-3">
          <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Palavra-chave</span>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value.replace(/\s+/g, ""))}
                placeholder="LINK"
                maxLength={30}
                required
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm uppercase outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">Mensagem enviada no direct</span>
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Aqui está o link que você pediu!"
                maxLength={1000}
                required
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                Link no botão <span className="font-normal text-muted">(opcional)</span>
              </span>
              <input
                type="url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !keyword.trim() || !message.trim()}
              className="h-10 rounded-[10px] bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Adicionar resposta
            </button>
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
        </form>
      )}
    </div>
  );
}
