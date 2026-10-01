export interface InboxAttachment {
  type?: string;
  name?: string;
  url?: string;
  file_url?: string;
  payload?: { url?: string; title?: string; sticker_id?: string };
  image_data?: { url?: string };
  video_data?: { url?: string };
}

export interface InboxConversationState {
  unreadCount: number | null;
  lastIncomingTime: string | null;
  lastMessageFromMe: boolean | null;
}

export interface InboxMessageContent {
  text?: string | null;
  attachments?: InboxAttachment[] | null;
}

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isReplyWindowOpen(
  lastIncomingTime: string | null | undefined,
  now = Date.now()
): boolean {
  if (!lastIncomingTime) return false;
  const timestamp = Date.parse(lastIncomingTime);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < REPLY_WINDOW_MS;
}

export function replyWindowHoursRemaining(
  lastIncomingTime: string | null | undefined,
  now = Date.now()
): number | null {
  if (!lastIncomingTime) return null;
  const timestamp = Date.parse(lastIncomingTime);
  if (!Number.isFinite(timestamp)) return null;
  const remaining = timestamp + REPLY_WINDOW_MS - now;
  return remaining > 0 ? Math.ceil(remaining / (60 * 60 * 1000)) : 0;
}

export function isConversationUnread(
  conversation: InboxConversationState,
  lastReadAt: string | null | undefined,
  localUnreadAfter: string | null | undefined
): boolean {
  const latestIncoming = conversation.lastIncomingTime
    ? Date.parse(conversation.lastIncomingTime)
    : Number.NaN;
  const readAt = lastReadAt ? Date.parse(lastReadAt) : Number.NaN;

  if (Number.isFinite(latestIncoming) && Number.isFinite(readAt) && latestIncoming <= readAt) {
    return false;
  }
  if (conversation.unreadCount !== null) return conversation.unreadCount > 0;

  const localBaseline = localUnreadAfter ? Date.parse(localUnreadAfter) : Number.NaN;
  const locallyReadThrough = Math.max(
    Number.isFinite(readAt) ? readAt : Number.NEGATIVE_INFINITY,
    Number.isFinite(localBaseline) ? localBaseline : Number.NEGATIVE_INFINITY
  );

  return (
    Number.isFinite(latestIncoming) &&
    conversation.lastMessageFromMe === false &&
    latestIncoming > locallyReadThrough
  );
}

export function attachmentLabel(attachment: InboxAttachment): string {
  const type = `${attachment.type ?? ""} ${attachment.name ?? ""}`.toLowerCase();
  if (type.includes("image") || type.includes("photo")) return "Imagem recebida";
  if (type.includes("video") || type.includes("reel")) return "Vídeo compartilhado";
  if (type.includes("audio")) return "Áudio recebido";
  if (type.includes("sticker")) return "Figurinha recebida";
  if (type.includes("share") || type.includes("ig_post")) return "Publicação compartilhada";
  if (type.includes("story")) return "Resposta a um Story";
  if (type.includes("file") || type.includes("document")) return "Arquivo recebido";
  return attachment.payload?.sticker_id ? "Figurinha recebida" : "Anexo recebido";
}

export function safeAttachmentUrl(attachment: InboxAttachment): string | null {
  const candidate =
    attachment.payload?.url ??
    attachment.image_data?.url ??
    attachment.video_data?.url ??
    attachment.file_url ??
    attachment.url;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function messagePreviewText(message: InboxMessageContent): string {
  const text = message.text?.trim();
  if (text) return text;
  const attachment = message.attachments?.[0];
  return attachment ? attachmentLabel(attachment) : "Interação sem texto disponível";
}
