"use client";

import { useState } from "react";
import { apiRequest } from "@/components/scheduling/shared";
import { useAiStatus } from "@/components/ai/use-ai-status";

interface ReplyVariationsButtonProps {
  /** The reply the user already wrote; the variations keep its meaning. */
  baseMessage: string;
  /** How many more replies still fit. */
  room: number;
  onAdd: (variations: string[]) => void;
}

export default function ReplyVariationsButton({ baseMessage, room, onAdd }: ReplyVariationsButtonProps) {
  const status = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!status?.enabled || room <= 0) return null;

  const ready = baseMessage.trim().length >= 3;

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<{ variations: string[]; notice: string | null }>("/api/ai/reply-variations", {
        method: "POST",
        body: JSON.stringify({ message: baseMessage.trim(), count: Math.min(5, Math.max(3, room)) }),
      });
      onAdd(data.variations.slice(0, room));
      setNotice(data.notice);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Não foi possível gerar agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy || !ready}
        title={ready ? undefined : "Escreva a primeira resposta para gerar variações."}
        className="text-xs font-medium text-accent hover:underline disabled:opacity-50 disabled:no-underline"
      >
        {busy ? "Gerando…" : "Gerar variações com IA"}
      </button>
      {error && <span role="alert" className="mt-1 text-xs text-error">{error}</span>}
      {notice && <span role="status" className="mt-1 text-xs text-muted">{notice}</span>}
    </span>
  );
}
