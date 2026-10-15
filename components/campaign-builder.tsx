"use client";

/**
 * Campaign Builder
 *
 * Two-pane campaign editor: a control panel on the left and a live phone
 * preview on the right. Used for both creating and editing a campaign.
 *
 * Turn 1 wires the fully-functional pieces: trigger scope (specific / any /
 * next post), match mode (specific words / any word), the opening + reveal DM
 * text, public reply, and the tracked link. Button-driven delivery and the
 * follow / email / follow-up steps arrive in later turns.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import InterfaceIcon from "@/components/interface-icon";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import PostPicker from "@/components/post-picker";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import StoryReplyPicker from "@/components/campaigns/story-reply-picker";
import CampaignAiAssistant from "@/components/ai/campaign-ai-assistant";
import ReplyVariationsButton from "@/components/ai/reply-variations-button";
import type { CampaignDraft } from "@/lib/ai/campaign-draft";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

type TriggerScope = "specific" | "any" | "next";
type MatchMode = "specific" | "any";
type FacebookScope = "specific" | "any";

interface FacebookPageOption {
  id: string;
  name: string;
  webhookSubscribed: boolean;
}

interface FacebookVideoOption {
  id: string;
  title: string | null;
  createdTime: string | null;
  permalinkUrl: string | null;
  thumbnailUrl: string | null;
  isReel: boolean;
  comments: number | null;
}

/** The Facebook half of a campaign as the API returns it. */
interface LoadedFacebook {
  facebookPageId: string;
  matchAnyPost: boolean;
  videoId: string | null;
  videoTitle: string | null;
  videoUrl: string | null;
}

interface LoadedCampaign {
  id: string;
  name: string;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  dmTriggerEnabled: boolean;
  storyMediaId?: string | null;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  isActive: boolean;
  instagramAccountId: string;
  trackedLinks?: { destinationUrl: string; label?: string | null }[];
  facebook?: LoadedFacebook | null;
}

/** A campaign that runs on Facebook only: the Facebook rule itself. */
interface LoadedFacebookRule extends LoadedFacebook {
  id: string;
  name: string;
  keywords: string[];
  matchAnyWord: boolean;
  dmMessage: string;
  linkUrl: string | null;
  linkButtonLabel: string | null;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  isActive: boolean;
  automationId: string | null;
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  /** The Instagram campaign being edited (which may also run on Facebook). */
  campaignId?: string;
  /** The Facebook-only campaign being edited. */
  facebookRuleId?: string;
  initialPost?: {
    instagramAccountId: string;
    postId: string;
    postUrl: string | null;
  };
  /** A Facebook video to start a new campaign from (Facebook only). */
  initialFacebook?: {
    videoId: string | null;
    videoTitle: string | null;
    videoUrl: string | null;
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-border-hover"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? "border-accent" : "border-border-hover"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex-1 text-foreground">{children}</span>
    </button>
  );
}

function Toggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-border-hover"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

/** One channel (Instagram or Facebook) the campaign can run on. */
function ChannelOption({
  label,
  detail,
  on,
  locked,
  disabled,
  onToggle,
}: {
  label: string;
  detail: React.ReactNode;
  on: boolean;
  /** Can't be switched in this screen, e.g. the half that already exists. */
  locked?: boolean;
  /** Not available at all, e.g. nothing connected. */
  disabled?: boolean;
  onToggle: () => void;
}) {
  const inactive = Boolean(locked || disabled);
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
        on ? "border-accent bg-accent/5" : "border-border"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? "Desligar" : "Ligar"} ${label}`}
        onClick={inactive ? undefined : onToggle}
        disabled={inactive}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          on ? "bg-accent" : "bg-border-hover"
        } ${inactive ? "cursor-not-allowed opacity-70" : ""}`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
            on ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

export default function CampaignBuilder({
  mode,
  campaignId,
  facebookRuleId,
  initialPost,
  initialFacebook,
}: CampaignBuilderProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(
    initialPost?.instagramAccountId ?? ""
  );

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const [triggerScope, setTriggerScope] = useState<TriggerScope>("specific");
  const [postId, setPostId] = useState<string | null>(initialPost?.postId ?? null);
  const [postUrl, setPostUrl] = useState<string | null>(initialPost?.postUrl ?? null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState("");

  // Post IDs already tied to another automation on this account, so the picker
  // can flag them and the user knows not to double-assign. Maps postId ->
  // the campaign name using it (for the tooltip).
  const [usedPosts, setUsedPosts] = useState<Record<string, string>>({});

  const [matchMode, setMatchMode] = useState<MatchMode>("specific");
  const [keywordText, setKeywordText] = useState("");
  const [dmTriggerEnabled, setDmTriggerEnabled] = useState(false);
  const [storyMediaId, setStoryMediaId] = useState<string | null>(null);

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");

  const [dmMessage, setDmMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("Abrir link");
  const [secondLinkOpen, setSecondLinkOpen] = useState(false);
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("Abrir link");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] =
    useState("Já estou seguindo");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(0);

  // Channels. A campaign is written once and runs on Instagram, Facebook or
  // both. Starting from a Facebook video (or editing a Facebook-only campaign)
  // begins with Instagram off.
  const startsOnFacebook = Boolean(initialFacebook || facebookRuleId);
  const [instagramEnabled, setInstagramEnabled] = useState(!startsOnFacebook);
  const [facebookEnabled, setFacebookEnabled] = useState(startsOnFacebook);
  const [facebookPages, setFacebookPages] = useState<FacebookPageOption[]>([]);
  const [facebookPageId, setFacebookPageId] = useState("");
  const [facebookScope, setFacebookScope] = useState<FacebookScope>("specific");
  const [facebookVideoId, setFacebookVideoId] = useState<string | null>(
    initialFacebook?.videoId ?? null
  );
  const [facebookVideoTitle, setFacebookVideoTitle] = useState<string | null>(
    initialFacebook?.videoTitle ?? null
  );
  const [facebookVideoUrl, setFacebookVideoUrl] = useState<string | null>(
    initialFacebook?.videoUrl ?? null
  );
  const [facebookVideos, setFacebookVideos] = useState<FacebookVideoOption[]>([]);
  const [facebookVideosError, setFacebookVideosError] = useState<string | null>(null);
  const [facebookLoaded, setFacebookLoaded] = useState(false);

  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");

  // CSV import queue. When present, each save advances to the next row instead
  // of returning to the campaigns list.
  const [importQueue, setImportQueue] = useState<ImportRow[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);

  const keywords = useMemo(
    () =>
      keywordText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    [keywordText]
  );

  // Fetch the connected account's real avatar for the preview (cache-first so
  // it shows instantly on a return visit instead of a blank circle).
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    const cacheKey = `ig-avatar:${selectedAccountId}`;
    const cached = readCache<string | null>(cacheKey, 30 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data !== null) setAvatarUrl(cached.data);

    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/profile?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const url = d.success ? d.data.profilePictureUrl ?? null : null;
        setAvatarUrl(url);
        writeCache(cacheKey, url);
      })
      .catch(() => {
        if (!cancelled && cached.data === null) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // Load accounts (both modes need them for the preview username + selector).
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) => prev || payload.data.selectedInstagramAccountId || next[0]?.id || ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  // Prefill when editing.
  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const c = (payload.data as LoadedCampaign[]).find((x) => x.id === campaignId);
        if (!c) return setNotFound(true);
        setName(c.name);
        setSelectedAccountId(c.instagramAccountId);
        setTriggerScope(
          c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific"
        );
        setPostId(c.postId);
        setPostUrl(c.postUrl);
        setMatchMode(c.matchAnyWord ? "any" : "specific");
        setKeywordText(c.keywords.join(", "));
        setDmTriggerEnabled(c.dmTriggerEnabled ?? false);
        setStoryMediaId(c.storyMediaId ?? null);
        setPublicReplyEnabled(c.publicReplyEnabled);
        setPublicReplyMessages(
          c.publicReplyMessages?.length
            ? c.publicReplyMessages
            : c.publicReplyMessage
              ? [c.publicReplyMessage]
              : [""]
        );
        setOpeningDmEnabled(c.openingDmEnabled);
        setOpeningDmMessage(c.openingDmMessage ?? "");
        setOpeningDmButtonLabel(c.openingDmButtonLabel ?? "");
        setDmMessage(c.dmMessage);
        setLinkButtonLabel(c.linkButtonLabel ?? "Abrir link");
        setIsActive(c.isActive);
        const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
        setTrackedDestinationUrl(link);
        setLinkOpen(Boolean(link));
        const secondLink = c.trackedLinks?.[1];
        setSecondaryDestinationUrl(secondLink?.destinationUrl ?? "");
        setSecondaryButtonLabel(secondLink?.label ?? "Abrir link");
        setSecondLinkOpen(Boolean(secondLink?.destinationUrl));
        setRequireFollow(c.requireFollow ?? false);
        setFollowPromptMessage(c.followPromptMessage ?? "");
        setFollowPromptButtonLabel(
          c.followPromptButtonLabel ?? "Já estou seguindo"
        );
        setFollowUpEnabled(c.followUpEnabled ?? false);
        setFollowUpMessage(c.followUpMessage ?? "");
        setFollowUpDelayMinutes(c.followUpDelayMinutes ?? 0);
        if (c.facebook) {
          setFacebookEnabled(true);
          setFacebookPageId(c.facebook.facebookPageId);
          setFacebookScope(c.facebook.matchAnyPost ? "any" : "specific");
          setFacebookVideoId(c.facebook.videoId);
          setFacebookVideoTitle(c.facebook.videoTitle);
          setFacebookVideoUrl(c.facebook.videoUrl);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mode, campaignId]);

  // Prefill when editing a campaign that runs on Facebook only.
  useEffect(() => {
    if (!facebookRuleId) return;
    fetch("/api/facebook/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        const rule = payload.success
          ? (payload.data.rules as LoadedFacebookRule[]).find((x) => x.id === facebookRuleId)
          : null;
        // A rule that belongs to an Instagram campaign is edited through that
        // campaign, never on its own.
        if (!rule || rule.automationId) return setNotFound(true);
        setName(rule.name);
        setFacebookPageId(rule.facebookPageId);
        setFacebookScope(rule.matchAnyPost ? "any" : "specific");
        setFacebookVideoId(rule.videoId);
        setFacebookVideoTitle(rule.videoTitle);
        setFacebookVideoUrl(rule.videoUrl);
        setMatchMode(rule.matchAnyWord ? "any" : "specific");
        setKeywordText(rule.keywords.join(", "));
        setDmMessage(rule.dmMessage);
        setTrackedDestinationUrl(rule.linkUrl ?? "");
        setLinkOpen(Boolean(rule.linkUrl));
        setLinkButtonLabel(rule.linkButtonLabel ?? "Abrir link");
        setPublicReplyEnabled(rule.publicReplyEnabled);
        setPublicReplyMessages(rule.publicReplyMessages.length ? rule.publicReplyMessages : [""]);
        setIsActive(rule.isActive);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [facebookRuleId]);

  // The connected Pages (so the Facebook channel can say when none is
  // connected) and, once Facebook is switched on, the chosen Page's videos.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ videos: facebookEnabled ? "1" : "0" });
    if (facebookPageId) params.set("pageId", facebookPageId);
    fetch(`/api/facebook/videos?${params}`)
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        setFacebookPages(payload.data.pages ?? []);
        setFacebookPageId((prev) => prev || payload.data.selectedPageId || "");
        if (facebookEnabled) {
          setFacebookVideos(payload.data.videos ?? []);
          setFacebookVideosError(payload.data.videosError ?? null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFacebookLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [facebookEnabled, facebookPageId]);

  // Track which posts on the selected account are already assigned to an
  // automation, so the picker can highlight them. The campaign being edited is
  // excluded — its own post should read as selected, not "taken".
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const map: Record<string, string> = {};
        for (const a of payload.data as LoadedCampaign[]) {
          if (!a.postId) continue;
          if (a.instagramAccountId !== selectedAccountId) continue;
          if (mode === "edit" && a.id === campaignId) continue;
          map[a.postId] = a.name;
        }
        setUsedPosts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, mode, campaignId]);

  // Prefill the editable fields from one queued import row. The reel is left
  // unset so the user picks it per row.
  function prefillFromRow(row: ImportRow) {
    setName(row.name ?? "");
    setTriggerScope("specific");
    setPostId(null);
    setPostUrl(null);
    setPostThumb(null);
    setPostCaption("");
    setMatchMode("specific");
    setKeywordText((row.keywords ?? []).join(", "));
    setDmMessage(row.dmMessage ?? "");
    setPublicReplyEnabled(Boolean(row.publicReply));
    setPublicReplyMessages(row.publicReply ? [row.publicReply] : [""]);
    const hasOpening = Boolean(row.openingDmMessage);
    setOpeningDmEnabled(hasOpening);
    setOpeningDmMessage(row.openingDmMessage ?? "");
    setOpeningDmButtonLabel(
      row.openingDmButtonLabel || (hasOpening ? "Enviar link" : "")
    );
    const link = row.trackedUrl ?? "";
    setTrackedDestinationUrl(link);
    setLinkOpen(Boolean(link));
    setError(null);
  }

  // Pick up a staged CSV import (new mode only) and prefill the first row.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "new") return;
    try {
      const raw = window.localStorage.getItem(IMPORT_QUEUE_KEY);
      const acct = window.localStorage.getItem(IMPORT_ACCOUNT_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as ImportRow[];
      if (!Array.isArray(queue) || queue.length === 0) return;
      setImportQueue(queue);
      setImportTotal(queue.length);
      if (acct) setSelectedAccountId(acct);
      prefillFromRow(queue[0]);
    } catch {
      // ignore a malformed queue
    }
  }, [mode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const username =
    accounts.find((a) => a.id === selectedAccountId)?.username ?? "yourbrand";

  // At least one channel stays on: a campaign that runs nowhere is meaningless.
  function toggleInstagram() {
    if (instagramEnabled && !facebookEnabled) return;
    setInstagramEnabled((on) => !on);
  }
  function toggleFacebook() {
    if (facebookEnabled && !instagramEnabled) return;
    setFacebookEnabled((on) => !on);
  }
  const selectedFacebookPage = facebookPages.find((page) => page.id === facebookPageId);

  function handlePostSelect(
    id: string,
    url?: string,
    thumb?: string,
    caption?: string
  ) {
    setPostId(id);
    setPostUrl(url ?? null);
    setPostThumb(thumb ?? null);
    setPostCaption(caption ?? "");
  }

  function ensureLinkToken() {
    setDmMessage((cur) => (cur.includes("{link}") ? cur : `${cur.trim()} {link}`.trim()));
  }

  // Fill the form from an AI draft. Nothing is saved: the person reviews and saves.
  function applyAiDraft(draft: CampaignDraft) {
    setName(draft.name);
    setMatchMode("specific");
    setKeywordText(draft.keywords.join(", "));
    setDmMessage(draft.linkUrl && !draft.dmMessage.includes("{link}") ? `${draft.dmMessage} {link}` : draft.dmMessage);
    if (draft.linkUrl) {
      setTrackedDestinationUrl(draft.linkUrl);
      setLinkOpen(true);
    }
    if (draft.publicReplyMessages.length > 0) {
      setPublicReplyEnabled(true);
      setPublicReplyMessages(draft.publicReplyMessages.slice(0, 10));
    }
    if (draft.followUpMessage) {
      setFollowUpEnabled(true);
      setFollowUpMessage(draft.followUpMessage);
    }
  }

  async function handleSubmit(activeValue: boolean) {
    setError(null);

    if (!instagramEnabled && !facebookEnabled)
      return setError("Escolha ao menos um canal: Instagram ou Facebook.");
    if (instagramEnabled && !selectedAccountId)
      return setError("Conecte uma conta do Instagram antes de continuar.");
    if (facebookEnabled) {
      if (!facebookPageId)
        return setError("Conecte uma Página do Facebook em Configurações para usar esse canal.");
      if (facebookScope === "specific" && !facebookVideoId)
        return setError("Escolha o vídeo do Facebook que aciona a campanha.");
    }
    // A campaign pinned to a Story is triggered by the Story reply, not by a post.
    const pinnedToStory = dmTriggerEnabled && Boolean(storyMediaId);
    if (instagramEnabled && triggerScope === "specific" && !postId && !pinnedToStory)
      return setError("Escolha uma publicação ou reel para acionar a campanha.");
    if (matchMode === "specific" && keywords.length === 0)
      return setError("Adicione pelo menos uma palavra-chave ou use a opção para qualquer palavra.");
    if (!dmMessage.trim()) return setError("Escreva a mensagem direta com o link.");
    if (
      instagramEnabled &&
      openingDmEnabled &&
      (!openingDmMessage.trim() || !openingDmButtonLabel.trim())
    )
      return setError("A mensagem inicial precisa de um texto e do rótulo do botão.");
    if (
      publicReplyEnabled &&
      publicReplyMessages.every((message) => !message.trim())
    ) {
      return setError(
        "Adicione ao menos uma resposta pública ou desative essa opção."
      );
    }

    setSaving(true);

    // The Facebook half of the campaign. Editing with Facebook switched off
    // sends null so the half that exists is removed; a new campaign just omits it.
    const facebookChannel = facebookEnabled
      ? {
          facebookPageId,
          matchAnyPost: facebookScope === "any",
          videoId: facebookScope === "specific" ? facebookVideoId : null,
          videoTitle: facebookScope === "specific" ? facebookVideoTitle : null,
          videoUrl: facebookScope === "specific" ? facebookVideoUrl : null,
        }
      : mode === "edit"
        ? null
        : undefined;

    const payload = {
      name:
        name.trim() ||
        (instagramEnabled ? `Campaign for @${username}` : "Campanha no Facebook"),
      instagramAccountId: selectedAccountId,
      postId: triggerScope === "specific" ? postId : null,
      postUrl: triggerScope === "specific" ? postUrl : null,
      matchAnyPost: triggerScope === "any",
      pendingNextReel: triggerScope === "next",
      matchAnyWord: matchMode === "any",
      keywords: matchMode === "any" ? [] : keywords,
      dmTriggerEnabled,
      storyMediaId: dmTriggerEnabled ? storyMediaId : null,
      dmMessage,
      openingDmEnabled,
      openingDmMessage: openingDmEnabled ? openingDmMessage : null,
      openingDmButtonLabel: openingDmEnabled ? openingDmButtonLabel : null,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled
        ? publicReplyMessages.map((m) => m.trim()).filter(Boolean)
        : [],
      trackedDestinationUrl: trackedDestinationUrl.trim() || "",
      linkButtonLabel: linkButtonLabel.trim() || "Abrir link",
      secondaryDestinationUrl: secondaryDestinationUrl.trim() || "",
      secondaryButtonLabel: secondaryButtonLabel.trim() || "Abrir link",
      requireFollow,
      followPromptMessage: requireFollow ? followPromptMessage.trim() : "",
      followPromptButtonLabel: requireFollow
        ? followPromptButtonLabel.trim() || "Já estou seguindo"
        : "",
      followUpEnabled,
      followUpMessage: followUpEnabled ? followUpMessage.trim() : "",
      followUpDelayMinutes: followUpEnabled ? followUpDelayMinutes : 0,
      isActive: activeValue,
      facebook: facebookChannel,
    };

    // Facebook only: there is no Instagram campaign, so the rule is saved on its own.
    const facebookOnlyBody = {
      facebookPageId,
      name: payload.name,
      matchAnyPost: facebookScope === "any",
      videoId: facebookScope === "specific" ? facebookVideoId : null,
      videoTitle: facebookScope === "specific" ? facebookVideoTitle : null,
      videoUrl: facebookScope === "specific" ? facebookVideoUrl : null,
      matchAnyWord: matchMode === "any",
      keywords: matchMode === "any" ? [] : keywords,
      dmMessage: dmMessage.trim(),
      linkUrl: trackedDestinationUrl.trim() || null,
      linkButtonLabel: linkButtonLabel.trim() || "Abrir link",
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled
        ? publicReplyMessages.map((m) => m.trim()).filter(Boolean)
        : [],
      isActive: activeValue,
    };

    const request = !instagramEnabled
      ? {
          url: facebookRuleId
            ? `/api/facebook/automations?id=${facebookRuleId}`
            : "/api/facebook/automations",
          method: facebookRuleId ? "PATCH" : "POST",
          body: facebookOnlyBody,
        }
      : {
          url: mode === "new" ? "/api/automations" : `/api/automations?id=${campaignId}`,
          method: mode === "new" ? "POST" : "PATCH",
          body: payload,
        };

    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const data = await res.json();
      if (data.success) {
        // The post we just assigned is now in use. Reflect it immediately so
        // the picker flags it on the next imported row — the fetch that builds
        // this map doesn't re-run while the builder stays mounted through the
        // import queue.
        if (instagramEnabled && triggerScope === "specific" && postId) {
          const assignedPostId = postId;
          setUsedPosts((prev) => ({ ...prev, [assignedPostId]: payload.name }));
        }
        // Importing: advance to the next queued row instead of leaving.
        if (importQueue && importQueue.length > 1) {
          const remaining = importQueue.slice(1);
          try {
            window.localStorage.setItem(
              IMPORT_QUEUE_KEY,
              JSON.stringify(remaining)
            );
          } catch {
            // ignore
          }
          setImportQueue(remaining);
          prefillFromRow(remaining[0]);
          setSaving(false);
          if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          return;
        }
        if (importQueue) {
          try {
            window.localStorage.removeItem(IMPORT_QUEUE_KEY);
            window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
          } catch {
            // ignore
          }
        }
        // refresh() busts the router cache so the list reflects the save
        // instead of landing on a stale (empty) campaigns page.
        router.push("/campaigns");
        router.refresh();
      } else {
        // Surface the specific field that failed validation instead of a
        // generic "Invalid input".
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? "Não foi possível salvar a campanha"
        );
        if (typeof window !== "undefined")
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Não foi possível salvar a campanha");
    } finally {
      setSaving(false);
    }
  }

  // Skip the current imported row without saving a campaign for it, advancing
  // to the next one (or finishing the import if it was the last).
  function skipRow() {
    if (!importQueue) return;
    setError(null);
    if (importQueue.length > 1) {
      const remaining = importQueue.slice(1);
      try {
        window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      setImportQueue(remaining);
      prefillFromRow(remaining[0]);
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      return;
    }
    // Last row skipped — finish the import.
    try {
      window.localStorage.removeItem(IMPORT_QUEUE_KEY);
      window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    router.push("/campaigns");
    router.refresh();
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (notFound) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-muted">Campanha não encontrada.</p>
        <button
          onClick={() => router.push("/campaigns")}
          className="mt-4 rounded border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          Voltar para campanhas
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {importQueue && (
        <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">
            Importando {importTotal - importQueue.length + 1} de {importTotal}.
          </span>{" "}
          <span className="text-muted">
            Os campos foram preenchidos pelo CSV. Escolha o reel, edite o que
            quiser e salve para carregar o próximo — ou pule este item.
          </span>
        </div>
      )}

      {mode === "new" && <CampaignAiAssistant onApply={applyAiDraft} />}

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {mode === "edit" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground">
                {name || "Campanha sem título"}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  isActive ? "bg-success/15 text-success" : "bg-surface-hover text-muted"
                }`}
              >
                {isActive ? "ATIVA" : "PAUSADA"}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">Nova campanha</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {importQueue && (
            <button
              type="button"
              onClick={skipRow}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              {importQueue.length > 1 ? "Pular" : "Pular e concluir"}
            </button>
          )}
          {mode === "edit" &&
            (isActive ? (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Parar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Ativar
              </button>
            ))}
          <button
            type="button"
            onClick={() => handleSubmit(mode === "new" ? true : isActive)}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Salvando…" : mode === "new" ? "Ativar" : "Salvar alterações"}
          </button>
        </div>
      </div>

      {/* min-w-0 on the cells: a grid item defaults to min-width:auto, so a
          long string widens the whole page instead of wrapping. */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-8">
      {/* Left: controls */}
      <div className="space-y-8 min-w-0">
        {error && (
          <div className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground">
            Nome da campanha{" "}
            <span className="font-normal text-muted">(opcional)</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Oferta de lançamento"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
            maxLength={100}
          />
          {instagramEnabled && accounts.length > 1 && (
            <div className="pt-2">
              <AccountSelect
                accounts={accounts}
                value={selectedAccountId}
                onChange={(id) => {
                  setSelectedAccountId(id);
                  setPostId(null);
                  setPostUrl(null);
                  setPostThumb(null);
                }}
                includeAll={false}
                label="Conta do Instagram"
              />
            </div>
          )}
        </div>

        <Section title="Onde a campanha roda">
          <ChannelOption
            label="Instagram"
            detail={accounts.length > 0 ? `@${username}` : "Nenhuma conta conectada"}
            on={instagramEnabled}
            // The Instagram half of an existing campaign can't be removed, and a
            // Facebook-only campaign can't grow one.
            locked={mode === "edit"}
            disabled={accounts.length === 0 && !instagramEnabled}
            onToggle={toggleInstagram}
          />
          <ChannelOption
            label="Facebook"
            detail={
              facebookPages.length > 0
                ? (selectedFacebookPage?.name ?? "Página do Facebook")
                : facebookLoaded
                  ? "Nenhuma Página conectada. Conecte em Configurações."
                  : "Carregando…"
            }
            on={facebookEnabled}
            locked={Boolean(facebookRuleId)}
            disabled={facebookLoaded && facebookPages.length === 0 && !facebookEnabled}
            onToggle={toggleFacebook}
          />
          {instagramEnabled && facebookEnabled && (
            <p className="text-xs text-muted">
              Nos dois canais valem as mesmas palavras, mensagem, link e respostas. DM inicial,
              exigir seguir e mensagem posterior valem só no Instagram.
            </p>
          )}
        </Section>

        {instagramEnabled && (
        <Section title="Quando alguém comentar em">
          <Radio
            checked={triggerScope === "specific"}
            onSelect={() => setTriggerScope("specific")}
          >
            uma publicação ou reel específico
          </Radio>
          {triggerScope === "specific" && (
            <div className="rounded-lg border border-border p-2">
              <PostPicker
                selectedPostId={postId}
                instagramAccountId={selectedAccountId}
                usedPostIds={usedPosts}
                onSelect={handlePostSelect}
              />
            </div>
          )}
          <Radio
            checked={triggerScope === "any"}
            onSelect={() => setTriggerScope("any")}
          >
            qualquer publicação ou reel
          </Radio>
          <Radio
            checked={triggerScope === "next"}
            onSelect={() => setTriggerScope("next")}
          >
            a próxima publicação ou reel
          </Radio>
        </Section>
        )}

        {facebookEnabled && (
          <Section title="No Facebook, quando comentarem em">
            {facebookPages.length > 1 && (
              <select
                value={facebookPageId}
                onChange={(e) => {
                  setFacebookPageId(e.target.value);
                  setFacebookVideoId(null);
                  setFacebookVideoTitle(null);
                  setFacebookVideoUrl(null);
                }}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none"
              >
                {facebookPages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>
            )}
            <Radio
              checked={facebookScope === "specific"}
              onSelect={() => setFacebookScope("specific")}
            >
              um vídeo ou reel específico da Página
            </Radio>
            {facebookScope === "specific" && (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {facebookVideosError && (
                  <p className="px-1 py-1 text-xs text-error">{facebookVideosError}</p>
                )}
                {facebookVideoId && !facebookVideos.some((video) => video.id === facebookVideoId) && (
                  <div className="rounded-md border border-accent bg-accent/5 px-2 py-2 text-xs text-foreground">
                    {facebookVideoTitle || facebookVideoId}
                  </div>
                )}
                {facebookVideos.length === 0 && !facebookVideosError && (
                  <p className="px-1 py-1 text-xs text-muted">Nenhum vídeo encontrado nesta Página.</p>
                )}
                {facebookVideos.map((video) => {
                  const label = video.title || "Vídeo sem legenda";
                  return (
                    <button
                      key={video.id}
                      type="button"
                      onClick={() => {
                        setFacebookVideoId(video.id);
                        setFacebookVideoTitle(label.slice(0, 300));
                        setFacebookVideoUrl(video.permalinkUrl);
                      }}
                      className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                        facebookVideoId === video.id
                          ? "border-accent bg-accent/5"
                          : "border-transparent hover:bg-surface-hover"
                      }`}
                    >
                      {video.thumbnailUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={video.thumbnailUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                          loading="lazy"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-foreground">{label}</span>
                        <span className="block text-[11px] text-muted">
                          {video.createdTime
                            ? new Date(video.createdTime).toLocaleDateString("pt-BR", {
                                day: "numeric",
                                month: "short",
                              })
                            : ""}
                          {video.isReel ? " · Reel" : ""}
                          {video.comments !== null ? ` · ${video.comments} comentários` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <Radio
              checked={facebookScope === "any"}
              onSelect={() => setFacebookScope("any")}
            >
              qualquer vídeo ou publicação da Página
            </Radio>
            {selectedFacebookPage && !selectedFacebookPage.webhookSubscribed && (
              <p className="text-xs text-warning">
                Esta Página ainda não envia os comentários para o FISGA, então a campanha não dispara no
                Facebook. Veja em Configurações → Página do Facebook.
              </p>
            )}
          </Section>
        )}

        <Section title="E esse comentário tiver">
          <Radio
            checked={matchMode === "specific"}
            onSelect={() => setMatchMode("specific")}
          >
            uma palavra ou palavras específicas
          </Radio>
          {matchMode === "specific" && (
            <div className="space-y-1">
              <input
                value={keywordText}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder="Digite uma ou mais palavras"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
              />
              <p className="text-xs text-muted">Use vírgulas para separar palavras</p>
            </div>
          )}
          <Radio
            checked={matchMode === "any"}
            onSelect={() => setMatchMode("any")}
          >
            qualquer palavra
          </Radio>
          {instagramEnabled && (
          <>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              também responder quando alguém enviar uma DM com{" "}
              {matchMode === "any" ? "qualquer conteúdo" : "essas palavras"}
            </span>
            <Toggle
              on={dmTriggerEnabled}
              onToggle={() => setDmTriggerEnabled(!dmTriggerEnabled)}
            />
          </div>
          {dmTriggerEnabled && (
            <p className="text-xs text-muted">
              {matchMode === "any"
                ? "Toda DM para esta conta recebe a resposta abaixo — use com cuidado."
                : "Uma DM com qualquer uma dessas palavras recebe a mesma resposta; não é necessário comentar."}
            </p>
          )}
          {dmTriggerEnabled && selectedAccountId && (
            <StoryReplyPicker
              instagramAccountId={selectedAccountId}
              value={storyMediaId}
              onChange={setStoryMediaId}
            />
          )}
          </>
          )}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              responder aos comentários na publicação
            </span>
            <Toggle
              on={publicReplyEnabled}
              onToggle={() => setPublicReplyEnabled(!publicReplyEnabled)}
            />
          </div>
          {publicReplyEnabled && (
            <div className="space-y-2">
              {publicReplyMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={msg}
                    onChange={(e) =>
                      setPublicReplyMessages((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder="Enviei uma DM para você! 📩"
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                  />
                  {publicReplyMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPublicReplyMessages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      className="shrink-0 px-2 text-muted hover:text-error"
                      aria-label="Remover resposta"
                    >
                      <InterfaceIcon name="close" size={14} />
                    </button>
                  )}
                </div>
              ))}
              {publicReplyMessages.every((message) => !message.trim()) && (
                <p className="text-xs text-error">
                  Adicione uma resposta ou desative essa opção antes de salvar.
                </p>
              )}
              {publicReplyMessages.length < 10 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button
                    type="button"
                    onClick={() =>
                      setPublicReplyMessages((prev) => [...prev, ""])
                    }
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    + Adicionar outra resposta
                  </button>
                  <ReplyVariationsButton
                    baseMessage={publicReplyMessages.find((message) => message.trim()) ?? ""}
                    room={10 - publicReplyMessages.filter((message) => message.trim()).length}
                    onAdd={(variations) =>
                      setPublicReplyMessages((prev) => {
                        const kept = prev.filter((message) => message.trim());
                        const known = new Set(kept.map((message) => message.trim().toLowerCase()));
                        const added = variations.filter((variation) => !known.has(variation.trim().toLowerCase()));
                        return [...kept, ...added].slice(0, 10);
                      })
                    }
                  />
                </div>
              )}
              <p className="text-xs text-muted">
                Uma resposta é escolhida aleatoriamente a cada vez, evitando
                repetições.
              </p>
            </div>
          )}
        </Section>

        {instagramEnabled && (
        <Section title="A pessoa receberá">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">uma DM inicial</span>
              <Toggle
                on={openingDmEnabled}
                onToggle={() => setOpeningDmEnabled(!openingDmEnabled)}
              />
            </div>
            {openingDmEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={openingDmMessage}
                  onChange={(e) => setOpeningDmMessage(e.target.value)}
                  placeholder="Olá! Que bom ter você por aqui 😊"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={openingDmButtonLabel}
                  onChange={(e) => setOpeningDmButtonLabel(e.target.value)}
                  placeholder="Enviar o link"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                  maxLength={64}
                />
              </div>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                um requisito de seguir o perfil antes
              </span>
              <Toggle
                on={requireFollow}
                onToggle={() => setRequireFollow(!requireFollow)}
              />
            </div>
            {requireFollow && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followPromptMessage}
                  onChange={(e) => setFollowPromptMessage(e.target.value)}
                  placeholder="Ex.: Já estou seguindo"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={followPromptButtonLabel}
                  onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                  placeholder="já estou seguindo"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                  maxLength={20}
                />
                <p className="text-xs text-muted">
                  O link é enviado depois que a pessoa toca no botão e o
                  Instagram confirma que ela segue o perfil. Se não for possível
                  confirmar, o envio ainda será feito.
                </p>
              </div>
            )}
          </div>
        </Section>
        )}

        <Section title="Depois, a pessoa receberá">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <span className="text-sm text-foreground">uma DM com um link</span>
            <textarea
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              placeholder="Escreva uma mensagem"
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none resize-none"
              maxLength={1000}
            />
            {linkOpen ? (
              <div className="space-y-2">
                <input
                  value={trackedDestinationUrl}
                  onChange={(e) => setTrackedDestinationUrl(e.target.value)}
                  onBlur={ensureLinkToken}
                  placeholder="https://yourlink.com/offer"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                />
                <input
                  value={linkButtonLabel}
                  onChange={(e) => setLinkButtonLabel(e.target.value)}
                  placeholder="Texto do botão (ex.: Abrir link)"
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                />
                {!instagramEnabled ? null : secondLinkOpen ? (
                  <div className="space-y-2 border-t border-border pt-2">
                    <input
                      value={secondaryDestinationUrl}
                      onChange={(e) => setSecondaryDestinationUrl(e.target.value)}
                      placeholder="https://yourlink.com/second"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                    />
                    <input
                      value={secondaryButtonLabel}
                      onChange={(e) => setSecondaryButtonLabel(e.target.value)}
                      placeholder="Texto do segundo botão"
                      maxLength={20}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondLinkOpen(true)}
                    className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
                  >
                    + Adicionar um segundo link
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
              >
                + Adicionar um link
              </button>
            )}
            <p className="text-xs text-muted">
              {"{link}"} insere o link rastreado; {"{username}"} personaliza a mensagem.
            </p>
          </div>
          {instagramEnabled && (
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                uma mensagem de agradecimento posterior
              </span>
              <Toggle
                on={followUpEnabled}
                onToggle={() => setFollowUpEnabled(!followUpEnabled)}
              />
            </div>
            {followUpEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder="Obrigado por seguir o perfil, valorizo muito o seu apoio 🙌"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="text-xs text-muted">Enviar</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={followUpDelayMinutes}
                    onChange={(e) =>
                      setFollowUpDelayMinutes(
                        Math.max(0, Math.min(1440, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-muted">
                    minutos após o link
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {followUpDelayMinutes > 0
                    ? `Enviada ${followUpDelayMinutes} min após a pessoa abrir o link.`
                    : "Enviada logo após a pessoa abrir o link."}
                  {" {username}"} personaliza a mensagem. Máximo de 24 horas,
                  respeitando a janela de mensagens do Instagram.
                </p>
              </div>
            )}
          </div>
          )}
        </Section>
      </div>

      {/* Right: preview */}
      <div>
        <p className="mb-4 text-sm text-muted">Prévia</p>
        <div className="flex min-w-0 justify-center lg:sticky lg:top-6 lg:block">
          {instagramEnabled ? (
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            username={username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption={postCaption}
            sampleComment={keywords[0] ?? ""}
            dmTriggerEnabled={dmTriggerEnabled}
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessage={publicReplyMessages.find((m) => m.trim()) ?? ""}
            openingDmEnabled={openingDmEnabled}
            openingDmMessage={openingDmMessage}
            openingDmButtonLabel={openingDmButtonLabel}
            revealMessage={dmMessage}
            hasLink={Boolean(trackedDestinationUrl.trim())}
            linkButtonLabel={linkButtonLabel || "Abrir link"}
            linkUrl={trackedDestinationUrl.trim() || undefined}
            hasSecondLink={
              secondLinkOpen && Boolean(secondaryDestinationUrl.trim())
            }
            secondLinkButtonLabel={secondaryButtonLabel || "Abrir link"}
            requireFollow={requireFollow}
            followPromptMessage={followPromptMessage}
            followPromptButtonLabel={followPromptButtonLabel || "já estou seguindo"}
            followUpEnabled={followUpEnabled}
            followUpMessage={followUpMessage}
            followUpDelayMinutes={followUpDelayMinutes}
          />
          ) : (
            <div className="w-full max-w-[320px] space-y-3 rounded-2xl border border-border bg-surface p-4">
              <p className="text-xs font-semibold text-muted">
                Messenger{selectedFacebookPage ? ` · ${selectedFacebookPage.name}` : ""}
              </p>
              <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-surface-hover px-3 py-2 text-sm text-foreground">
                {dmMessage
                  .replace(/\{username\}/gi, "Maria")
                  .replace(/\s*\{link\}\s*/gi, " ")
                  .trim() || "A mensagem aparece aqui."}
              </div>
              {trackedDestinationUrl.trim() && (
                <div className="rounded-lg border border-border px-3 py-2 text-center text-sm font-semibold text-accent">
                  {linkButtonLabel || "Abrir link"}
                </div>
              )}
              {publicReplyEnabled && publicReplyMessages.some((m) => m.trim()) && (
                <p className="text-xs text-muted">
                  Resposta pública no comentário: “{publicReplyMessages.find((m) => m.trim())}”
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
