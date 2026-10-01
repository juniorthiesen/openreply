"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  attachmentLabel,
  isConversationUnread,
  isReplyWindowOpen,
  messagePreviewText,
  replyWindowHoursRemaining,
  safeAttachmentUrl,
} from "@/lib/inbox";
import type { ConversationListItem } from "@/app/api/instagram/conversations/route";
import type {
  ThreadMessage,
  ThreadResponse,
} from "@/app/api/instagram/conversations/[id]/route";

const POLL_MS = 12_000;
const CACHE_MAX_AGE_MS = 60_000;
const convCacheKey = (accountId: string) => `inbox:convs:${accountId}`;
const msgCacheKey = (conversationId: string) => `inbox:msgs:${conversationId}`;
const unreadBaselineKey = (accountId: string) => `inbox:unread-baseline:${accountId}`;
const readKey = (accountId: string, conversationId: string) =>
  `inbox:read:${accountId}:${conversationId}`;

type InboxFilter = "open" | "unread" | "all";
type ConversationContext = ThreadResponse["context"];

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatListTime(value: string | null): string {
  const date = validDate(value);
  if (!date) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function formatMessageTime(value: string | null): string {
  const date = validDate(value);
  return date
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";
}

function formatFullDate(value: string | null): string {
  const date = validDate(value);
  if (!date) return "Data não informada";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Hoje";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function initials(username: string | null): string {
  const value = username?.replace(/^@/, "").replace(/[._-]+/g, " ").trim();
  if (!value) return "IG";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function readAt(accountId: string, conversationId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(readKey(accountId, conversationId));
}

function readUnreadBaseline(accountId: string): string | null {
  if (typeof window === "undefined" || !accountId) return null;
  return window.sessionStorage.getItem(unreadBaselineKey(accountId));
}

function ensureUnreadBaseline(accountId: string): void {
  if (typeof window === "undefined" || !accountId) return;
  const key = unreadBaselineKey(accountId);
  if (!window.sessionStorage.getItem(key)) {
    window.sessionStorage.setItem(key, new Date().toISOString());
  }
}

function Avatar({ username, large = false }: { username: string | null; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-[#ead4cb] font-semibold text-[#33231f] ${large ? "h-14 w-14 text-base" : "h-10 w-10 text-xs"}`}
    >
      {initials(username)}
    </span>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? "bg-white text-foreground shadow-sm"
          : "text-muted hover:bg-white/70 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default function InboxWorkspace() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("inbox:selectedAccount") ?? "";
  });
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("open");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [context, setContext] = useState<ConversationContext | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [readTimes, setReadTimes] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const isUnread = useCallback(
    (conversation: ConversationListItem) =>
      isConversationUnread(
        conversation,
        readTimes[conversation.id] ?? readAt(selectedAccountId, conversation.id),
        readUnreadBaseline(selectedAccountId)
      ),
    [readTimes, selectedAccountId]
  );
  const unreadCount = useMemo(
    () => conversations.filter(isUnread).length,
    [conversations, isUnread]
  );
  const isUsingUnreadFallback =
    conversations.length > 0 && conversations.every((conversation) => conversation.unreadCount === null);
  const visibleConversations = useMemo(
    () =>
      conversations.filter((conversation) => {
        if (filter === "unread") return isUnread(conversation);
        if (filter === "open") return isReplyWindowOpen(conversation.lastIncomingTime);
        return true;
      }),
    [conversations, filter, isUnread]
  );
  const replyWindowOpen = active ? isReplyWindowOpen(active.lastIncomingTime) : false;
  const hoursRemaining = active
    ? replyWindowHoursRemaining(active.lastIncomingTime)
    : null;

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((response) => response.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        if (next.length === 0) {
          setConversations([]);
          setConvLoading(false);
          setConvError("Conecte uma conta do Instagram para carregar as conversas.");
        }
        setSelectedAccountId((previous) => {
          const stillConnected = previous && next.some((account) => account.id === previous);
          return stillConnected
            ? previous
            : payload.data.selectedInstagramAccountId || next[0]?.id || "";
        });
      })
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      window.sessionStorage.setItem("inbox:selectedAccount", selectedAccountId);
    }
  }, [selectedAccountId]);

  const loadConversations = useCallback(
    async (silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setConvLoading(true);
      ensureUnreadBaseline(selectedAccountId);
      try {
        const response = await fetch(
          `/api/instagram/conversations?instagramAccountId=${encodeURIComponent(selectedAccountId)}`,
          { cache: "no-store" }
        );
        const payload = await response.json();
        if (payload.success) {
          const next: ConversationListItem[] = payload.data.conversations;
          setConversations(next);
          writeCache(convCacheKey(selectedAccountId), next);
          setConvError(null);
        } else if (!silent) {
          setConvError(payload.error ?? "Não foi possível carregar as conversas.");
        }
      } catch {
        if (!silent) setConvError("Não foi possível carregar as conversas.");
      } finally {
        if (!silent) setConvLoading(false);
      }
    },
    [selectedAccountId]
  );

  useEffect(() => {
    if (!selectedAccountId) return;
    const initialLoad = window.setTimeout(() => void loadConversations(false), 0);
    const timer = window.setInterval(() => void loadConversations(true), POLL_MS);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [selectedAccountId, loadConversations]);

  const loadMessages = useCallback(
    async (conversationId: string, silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setThreadLoading(true);
      try {
        const response = await fetch(
          `/api/instagram/conversations/${encodeURIComponent(conversationId)}?instagramAccountId=${encodeURIComponent(selectedAccountId)}`,
          { cache: "no-store" }
        );
        const payload = await response.json();
        if (payload.success) {
          const data: ThreadResponse = payload.data;
          setMessages(data.messages);
          setContext(data.context);
          writeCache(msgCacheKey(conversationId), data.messages);
        }
      } catch {
        // Preserve the latest messages already on screen during transient errors.
      } finally {
        setThreadLoading(false);
      }
    },
    [selectedAccountId]
  );

  useEffect(() => {
    if (!activeId) return;
    const initialLoad = window.setTimeout(() => void loadMessages(activeId, true), 0);
    const timer = window.setInterval(() => void loadMessages(activeId, true), POLL_MS);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [activeId, loadMessages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function openConversation(id: string) {
    setActiveId(id);
    setSendError(null);
    const openedAt = new Date().toISOString();
    if (selectedAccountId) {
      window.sessionStorage.setItem(readKey(selectedAccountId, id), openedAt);
      setReadTimes((previous) => ({ ...previous, [id]: openedAt }));
    }
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === id ? { ...conversation, unreadCount: 0 } : conversation
      )
    );
    const cached = readCache<ThreadMessage[]>(msgCacheKey(id), CACHE_MAX_AGE_MS);
    setMessages(cached.data ?? []);
    setContext(null);
    setThreadLoading(!cached.data);
    if (selectedAccountId) {
      void fetch(
        `/api/instagram/conversations/${encodeURIComponent(id)}?instagramAccountId=${encodeURIComponent(selectedAccountId)}`,
        { method: "POST" }
      );
    }
  }

  function changeAccount(id: string) {
    setActiveId(null);
    setMessages([]);
    setContext(null);
    setConversations([]);
    setConvLoading(true);
    setSelectedAccountId(id);
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !active?.contact.id || sending || !replyWindowOpen) return;
    setSending(true);
    setSendError(null);
    const optimistic: ThreadMessage = {
      id: `optimistic-${Date.now()}`,
      text,
      attachments: [],
      fromMe: true,
      fromUsername: null,
      createdTime: new Date().toISOString(),
    };
    setMessages((previous) => [...previous, optimistic]);
    setDraft("");
    try {
      const response = await fetch("/api/instagram/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: selectedAccountId,
          recipientId: active.contact.id,
          text,
        }),
      });
      const payload = await response.json();
      if (payload.success) {
        await loadMessages(active.id, true);
        void loadConversations(true);
      } else {
        setMessages((previous) => previous.filter((message) => message.id !== optimistic.id));
        setDraft(text);
        setSendError(payload.error ?? "Não foi possível enviar a mensagem.");
      }
    } catch {
      setMessages((previous) => previous.filter((message) => message.id !== optimistic.id));
      setDraft(text);
      setSendError("Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  const filterLabel = (kind: InboxFilter) => {
    if (kind === "open") return "Janela aberta";
    if (kind === "unread") return `Não lidas · ${unreadCount}`;
    return "Todas";
  };

  return (
    <div className="grid h-full min-h-0 w-full grid-cols-1 overflow-hidden border-y border-border bg-white md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_250px] 2xl:grid-cols-[300px_minmax(0,1fr)_280px]">
      <aside className={`min-h-0 flex-col border-r border-border bg-[#fbfaf7] ${active ? "hidden md:flex" : "flex"}`}>
        <div className="shrink-0 border-b border-border px-4 pb-3 pt-3">
          <div className="mb-3">
            <h1 className="text-sm font-semibold text-foreground">Conversas</h1>
            {accounts.length > 1 && (
              <div className="mt-2">
                <AccountSelect
                  accounts={accounts}
                  value={selectedAccountId}
                  onChange={changeAccount}
                  includeAll={false}
                  label="Conta"
                />
              </div>
            )}
          </div>
          <div className="flex w-fit gap-0.5 rounded-xl bg-[#e9e6dd] p-1" aria-label="Filtrar conversas">
            {(["open", "unread", "all"] as const).map((kind) => (
              <FilterButton key={kind} active={filter === kind} onClick={() => setFilter(kind)}>
                {filterLabel(kind)}
              </FilterButton>
            ))}
          </div>
          {isUsingUnreadFallback && (
            <p className="mt-2 text-[10px] leading-4 text-muted">
              A Meta não informou o contador. Aqui, novas mensagens são sinalizadas a partir do momento em que esta caixa foi aberta.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {convLoading ? (
            <p className="px-4 py-6 text-sm text-muted">Carregando conversas…</p>
          ) : convError ? (
            <p className="px-4 py-6 text-sm text-error">{convError}</p>
          ) : visibleConversations.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted">
              {conversations.length === 0
                ? "Ainda não há conversas nesta conta."
                : filter === "unread"
                  ? "Nenhuma conversa não lida."
                  : filter === "open"
                    ? "Não há conversas com a janela de resposta aberta."
                    : "Nenhuma conversa encontrada."}
            </div>
          ) : (
            visibleConversations.map((conversation) => {
              const selected = conversation.id === activeId;
              const unread = isUnread(conversation);
              const preview = conversation.lastMessage
                ? messagePreviewText({ text: conversation.lastMessage.text })
                : "Sem mensagens disponíveis";
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => openConversation(conversation.id)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-[#f4f1e9] ${selected ? "bg-white" : ""}`}
                >
                  <Avatar username={conversation.contact.username} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${unread ? "font-bold" : "font-semibold"}`}>
                        @{conversation.contact.username ?? "usuário do Instagram"}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted">
                        {formatListTime(conversation.updatedTime)}
                      </span>
                    </span>
                    <span className={`mt-1 block truncate text-xs ${unread ? "text-foreground" : "text-muted"}`}>
                      {conversation.lastMessage?.fromMe ? "Você: " : ""}{preview}
                    </span>
                    <span className="mt-1.5 flex min-h-4 items-center gap-2">
                      {isReplyWindowOpen(conversation.lastIncomingTime) ? (
                        <span className="text-[10px] font-medium text-[#176b45]">
                          {replyWindowHoursRemaining(conversation.lastIncomingTime)} h restantes
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted">Janela fechada</span>
                      )}
                      {unread && <span className="ml-auto h-2 w-2 rounded-full bg-accent" aria-label="Não lida" />}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className={`min-h-0 min-w-0 flex-col bg-[#fcfbf9] ${active ? "flex" : "hidden md:flex"}`} aria-label="Conversa selecionada">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#f0e9df] text-muted">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-3 2v-5a7.5 7.5 0 1 1 16-4.5Z" />
              </svg>
            </span>
            <p className="mt-3 text-sm font-semibold">Escolha uma conversa</p>
            <p className="mt-1 max-w-xs text-xs text-muted">As mensagens e os dados de campanha aparecem aqui.</p>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-3 border-b border-border bg-white px-4 py-3">
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="-ml-1 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-[#f3f0e9] md:hidden"
                aria-label="Voltar para conversas"
              >
                <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <Avatar username={active.contact.username} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">@{active.contact.username ?? "usuário do Instagram"}</p>
                <p className="mt-0.5 text-[11px] text-muted">Mensagens diretas</p>
              </div>
              <span className={`ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold ${replyWindowOpen ? "bg-[#e2f1e8] text-[#176b45]" : "bg-[#f0ede6] text-muted"}`}>
                {replyWindowOpen ? `${hoursRemaining} h restantes` : "Janela fechada"}
              </span>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {threadLoading && messages.length === 0 ? (
                <p className="text-sm text-muted">Carregando mensagens…</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">Sem mensagens retornadas para esta conversa.</p>
              ) : (
                <div className="space-y-2">
                  {messages.map((message, index) => {
                    const priorDate = index > 0 ? validDate(messages[index - 1].createdTime) : null;
                    const currentDate = validDate(message.createdTime);
                    const showDate =
                      !priorDate ||
                      !currentDate ||
                      priorDate.toDateString() !== currentDate.toDateString();
                    const attachments = message.attachments ?? [];
                    const bodyText = message.text?.trim() ?? "";
                    return (
                      <div key={message.id}>
                        {showDate && (
                          <div className="flex justify-center py-3">
                            <span className="rounded-full px-3 py-1 text-[11px] text-muted">
                              {formatFullDate(message.createdTime)}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${message.fromMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-[78%] ${message.fromMe ? "rounded-br-md bg-[#18191d] text-white" : "rounded-bl-md border border-border bg-[#f0ede7] text-foreground"}`}>
                            {bodyText && (
                              <p className="whitespace-pre-wrap break-words">{bodyText}</p>
                            )}
                            {attachments.map((attachment, attachmentIndex) => {
                              const url = safeAttachmentUrl(attachment);
                              return (
                                <div key={`${message.id}-attachment-${attachmentIndex}`} className={`mt-1.5 rounded-xl px-3 py-2 text-xs ${message.fromMe ? "bg-white/10" : "bg-white/80"}`}>
                                  <p className="font-medium">{attachmentLabel(attachment)}</p>
                                  {url ? (
                                    <a className={`mt-1 inline-block underline underline-offset-2 ${message.fromMe ? "text-white" : "text-accent"}`} href={url} target="_blank" rel="noreferrer">
                                      Abrir anexo
                                    </a>
                                  ) : (
                                    <p className={`mt-1 ${message.fromMe ? "text-white/75" : "text-muted"}`}>
                                      A Meta não disponibilizou um link para este conteúdo.
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                            {!bodyText && attachments.length === 0 && (
                              <p className="text-sm">Interação sem texto disponível</p>
                            )}
                            <p className={`mt-1 text-[10px] ${message.fromMe ? "text-white/65" : "text-muted"}`}>
                              {formatMessageTime(message.createdTime)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {threadLoading && <p className="py-2 text-center text-[11px] text-muted">Atualizando conversa…</p>}
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t border-border bg-white px-4 py-3 sm:px-5">
              {sendError && <p className="mb-2 text-xs text-error">{sendError}</p>}
              {!replyWindowOpen ? (
                <p className="py-2 text-center text-xs text-muted">A janela de resposta do Instagram está fechada. Só é possível responder dentro do prazo permitido pela Meta.</p>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder={`Responder @${active.contact.username ?? "contato"}…`}
                    className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !draft.trim()}
                    className="h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    {sending ? "Enviando…" : "Enviar"}
                  </button>
                </div>
              )}
            </footer>
          </>
        )}
      </section>

      <aside className="hidden min-h-0 flex-col overflow-y-auto border-l border-border bg-[#fbfaf7] px-5 py-6 xl:flex" aria-label="Detalhes do contato">
        {active ? (
          <>
            <div className="flex flex-col items-center border-b border-border pb-5 text-center">
              <Avatar username={active.contact.username} large />
              <h2 className="mt-3 max-w-full truncate text-sm font-semibold">@{active.contact.username ?? "usuário do Instagram"}</h2>
              <span className="mt-2 rounded-full bg-[#e2f1e8] px-3 py-1 text-[10px] font-semibold text-[#176b45]">Instagram</span>
            </div>

            <div className="space-y-5 py-5">
              <div>
                <p className="text-[11px] text-muted">Atividade mais antiga registrada</p>
                <p className="mt-1 text-xs font-semibold">{context?.oldestActivityAt ? formatFullDate(context.oldestActivityAt) : "Sem registro"}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted">Campanha relacionada</p>
                {context?.campaign ? (
                  <>
                    <p className="mt-1 text-xs font-semibold">{context.campaign.name}</p>
                    {context.campaign.keyword && (
                      <p className="mt-1 text-xs text-muted">Palavra usada: <span className="font-medium text-foreground">{context.campaign.keyword}</span></p>
                    )}
                    <p className="mt-2 text-xs text-muted">
                      {context.campaign.campaignLinkClicks} clique(s) nos links desta campanha
                    </p>
                    <p className="mt-1 text-[10px] text-muted">Total da campanha, não individual deste contato.</p>
                  </>
                ) : (
                  <p className="mt-1 text-xs leading-5 text-muted">Ainda não há uma campanha vinculada a este contato.</p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-muted">Histórico registrado</p>
                {context?.history.length ? (
                  <ol className="mt-3 space-y-3">
                    {context.history.map((event) => (
                      <li key={event.id} className="flex gap-2.5">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                        <div>
                          <p className="text-xs leading-4">{event.label}</p>
                          {event.keyword && <p className="mt-0.5 text-[10px] text-muted">Palavra: {event.keyword}</p>}
                          <p className="mt-1 text-[10px] text-muted">{formatFullDate(event.date)} · {formatMessageTime(event.date)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-1 text-xs leading-5 text-muted">Não há eventos de automação registrados para este usuário.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="py-2 text-xs leading-5 text-muted">Selecione uma conversa para ver os dados disponíveis do contato e da campanha.</div>
        )}
      </aside>
    </div>
  );
}
