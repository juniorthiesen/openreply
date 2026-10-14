/**
 * Facebook Page webhook parsing. A Page delivers `object: "page"` with the
 * Page's activity under `changes[].field === "feed"`; a comment is a change
 * whose value has `item: "comment"` and `verb: "add"`.
 */

export interface FacebookCommentEvent {
  pageId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  /** Id of the post (or video post) the comment is under: "<pageId>_<objectId>". */
  postId: string;
  /** Present on some video comments. */
  videoId?: string;
}

interface FacebookFeedValue {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  video_id?: string;
  parent_id?: string;
  message?: string;
  from?: { id?: string; name?: string };
}

interface FacebookWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: FacebookFeedValue }>;
  }>;
}

export function parseFacebookCommentEvents(
  payload: FacebookWebhookPayload
): FacebookCommentEvent[] {
  const events: FacebookCommentEvent[] = [];
  if (payload.object !== "page") return events;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "feed") continue;
      const value = change.value;
      if (!value || value.item !== "comment" || value.verb !== "add") continue;

      const commentId = value.comment_id;
      const postId = value.post_id;
      const commenterId = value.from?.id;
      if (!entry.id || !commentId || !postId || !commenterId) continue;

      // The Page's own comments and replies would otherwise trigger a private
      // reply to itself, which Meta rejects, and could loop on a public reply.
      if (commenterId === entry.id) continue;

      // A reply to another comment has that comment as its parent; only
      // top-level comments are answered, matching how the Instagram flow works.
      if (value.parent_id && value.parent_id !== postId) continue;

      events.push({
        pageId: entry.id,
        commentId,
        commentText: value.message ?? "",
        commenterId,
        commenterName: value.from?.name,
        postId,
        videoId: value.video_id,
      });
    }
  }

  return events;
}

/** "<pageId>_<objectId>" and "<objectId>" both reduce to "<objectId>". */
export function facebookObjectId(id: string): string {
  const index = id.lastIndexOf("_");
  return index === -1 ? id : id.slice(index + 1);
}

/** Does a rule bound to `automationVideoId` cover a comment on this post? */
export function commentIsOnVideo(
  automation: { videoId: string | null; matchAnyPost: boolean },
  event: Pick<FacebookCommentEvent, "postId" | "videoId">
): boolean {
  if (automation.matchAnyPost) return true;
  if (!automation.videoId) return false;
  const wanted = facebookObjectId(automation.videoId);
  return (
    facebookObjectId(event.postId) === wanted ||
    (event.videoId !== undefined && facebookObjectId(event.videoId) === wanted)
  );
}

/** {username} → the commenter's first name; {link} is dropped (the link is a button). */
export function renderFacebookMessage(
  message: string,
  commenterName?: string | null
): string {
  return message
    .replace(/\{username\}/gi, commenterName?.split(" ")[0] || "")
    .replace(/\s*\{link\}\s*/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
