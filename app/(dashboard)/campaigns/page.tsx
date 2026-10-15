"use client";

/**
 * Campaigns List Page
 *
 * Shows all campaigns as cards with toggle and delete.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";

interface Campaign {
  id: string;
  name: string;
  goal: string | null;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  isActive: boolean;
  wholeWordMatch: boolean;
  instagramAccountId: string;
  instagramAccount: {
    username: string;
    instagramId: string;
  };
  reportShareSlug: string | null;
  reportShareEnabled: boolean;
  reportUrl: string | null;
  createdAt: string;
  _count: { dmLogs: number };
  trackedLinks: Array<{
    id: string;
    slug: string;
    label: string | null;
    destinationUrl: string;
    trackedUrl: string;
    _count: { clicks: number };
  }>;
  analytics: {
    sent: number;
    skipped: number;
    failed: number;
    clicks: number;
    ctr: number;
    topKeywords: { keyword: string; count: number }[];
  };
  // The Facebook half, when the campaign also runs on a Page.
  facebook: {
    id: string;
    pageName: string;
    isActive: boolean;
    sent: number;
    failed: number;
  } | null;
}

/** A campaign that runs on Facebook only. */
interface FacebookCampaign {
  id: string;
  name: string;
  facebookPageId: string;
  keywords: string[];
  matchAnyWord: boolean;
  matchAnyPost: boolean;
  videoTitle: string | null;
  videoUrl: string | null;
  dmMessage: string;
  isActive: boolean;
  automationId: string | null;
  sent: number;
  failed: number;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [automations, setAutomations] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [loading, setLoading] = useState(true);
  // postId -> current thumbnail URL, fetched live (Instagram URLs expire, so
  // they are never stored on the campaign).
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  // postId -> video URL for reels, so a campaign thumbnail can play on click.
  const [videos, setVideos] = useState<Record<string, string>>({});
  // The reel currently playing in the lightbox (null when closed).
  const [playingVideo, setPlayingVideo] = useState<{
    url: string;
    postUrl: string | null;
  } | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">(
    "all"
  );
  // Campaigns that run on Facebook only, and the Page names to label them with.
  const [facebookOnly, setFacebookOnly] = useState<FacebookCampaign[]>([]);
  const [facebookPageNames, setFacebookPageNames] = useState<Record<string, string>>({});

  const fetchAutomations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }
      const res = await fetch(
        `/api/automations${params.size ? `?${params}` : ""}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.success) setAutomations(data.data);
    } catch (err) {
      console.error("Failed to fetch campaigns:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAutomations();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAutomations]);

  // The Facebook-only campaigns. Ones that belong to an Instagram campaign are
  // already shown on its card, so they are left out here.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/facebook/automations", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/facebook/pages").then((res) => res.json()),
    ])
      .then(([rules, pages]) => {
        if (cancelled) return;
        if (rules.success) {
          setFacebookOnly(
            (rules.data.rules as FacebookCampaign[]).filter((rule) => !rule.automationId)
          );
        }
        if (pages.success) {
          setFacebookPageNames(
            Object.fromEntries(
              (pages.data.pages as { id: string; name: string }[]).map((page) => [page.id, page.name])
            )
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch fresh post thumbnails (and reel video URLs) for the accounts in view
  // and map them by postId. Cache-first so they show instantly on a return
  // visit. Instagram URLs expire, so they are never stored on the campaign.
  useEffect(() => {
    if (automations.length === 0) return;
    let cancelled = false;
    const accountIds = Array.from(
      new Set(automations.map((a) => a.instagramAccountId))
    ).sort();
    const cacheKey = `ig-media:${accountIds.join(",")}`;

    const cached = readCache<{
      thumbs: Record<string, string>;
      videos: Record<string, string>;
    }>(cacheKey, 15 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (cached.data) {
      setThumbnails(cached.data.thumbs);
      setVideos(cached.data.videos);
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    Promise.all(
      accountIds.map((accountId) =>
        fetch(`/api/instagram/posts?instagramAccountId=${accountId}&limit=50`)
          .then((res) => res.json())
          .then((payload) =>
            payload.success
              ? (payload.data as {
                  id: string;
                  media_type?: string;
                  media_url?: string;
                  thumbnail_url?: string;
                }[])
              : []
          )
          .catch(() => [])
      )
    ).then((lists) => {
      if (cancelled) return;
      const thumbs: Record<string, string> = {};
      const vids: Record<string, string> = {};
      for (const list of lists) {
        for (const media of list) {
          const url = media.thumbnail_url ?? media.media_url;
          if (url) thumbs[media.id] = url;
          if (media.media_type === "VIDEO" && media.media_url) {
            vids[media.id] = media.media_url;
          }
        }
      }
      setThumbnails(thumbs);
      setVideos(vids);
      writeCache(cacheKey, { thumbs, videos: vids });
    });

    return () => {
      cancelled = true;
    };
  }, [automations]);

  // Close the reel lightbox on Escape.
  useEffect(() => {
    if (!playingVideo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlayingVideo(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playingVideo]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  async function toggleActive(id: string, isActive: boolean) {
    try {
      await fetch(`/api/automations?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isActive: !isActive } : a))
      );
    } catch (err) {
      console.error("Failed to toggle:", err);
    }
  }

  async function toggleFacebookOnly(rule: FacebookCampaign) {
    try {
      const res = await fetch(`/api/facebook/automations?id=${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (res.ok) {
        setFacebookOnly((prev) =>
          prev.map((item) => (item.id === rule.id ? { ...item, isActive: !rule.isActive } : item))
        );
      }
    } catch (err) {
      console.error("Failed to toggle:", err);
    }
  }

  async function deleteFacebookOnly(rule: FacebookCampaign) {
    if (!confirm("Excluir esta campanha? Esta ação não pode ser desfeita.")) return;
    try {
      const res = await fetch(`/api/facebook/automations?id=${rule.id}`, { method: "DELETE" });
      if (res.ok) setFacebookOnly((prev) => prev.filter((item) => item.id !== rule.id));
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }

  async function copyReelUrl(auto: Campaign) {
    setMenuOpenId(null);
    if (!auto.postUrl) return;
    try {
      await navigator.clipboard.writeText(auto.postUrl);
      setCopiedId(auto.id);
      window.setTimeout(
        () => setCopiedId((cur) => (cur === auto.id ? null : cur)),
        1500
      );
    } catch (err) {
      console.error("Failed to copy reel URL:", err);
    }
  }

  async function deleteAutomation(id: string) {
    if (!confirm("Excluir esta campanha? Esta ação não pode ser desfeita.")) return;
    try {
      await fetch(`/api/automations?id=${id}`, { method: "DELETE" });
      setAutomations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }

  // The copy is made server-side from the stored campaign, so settings this
  // list never loads (the DM trigger, the follow-up, the link button label)
  // still come along.
  async function duplicateAutomation(id: string) {
    setMenuOpenId(null);
    try {
      const res = await fetch(`/api/automations/duplicate?id=${id}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) void fetchAutomations();
      else console.error("Duplicate failed:", data.error);
    } catch (err) {
      console.error("Failed to duplicate:", err);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="panel rounded p-6 h-36" />
        ))}
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const filtered = automations.filter((a) => {
    if (statusFilter === "active" && !a.isActive) return false;
    if (statusFilter === "paused" && a.isActive) return false;
    if (!query) return true;
    return (
      a.name.toLowerCase().includes(query) ||
      a.keywords.some((k) => k.toLowerCase().includes(query)) ||
      a.dmMessage.toLowerCase().includes(query)
    );
  });

  // Facebook-only campaigns are filtered like the others. They are listed
  // whatever Instagram account is selected, since they have none.
  const filteredFacebook = facebookOnly.filter((rule) => {
    if (statusFilter === "active" && !rule.isActive) return false;
    if (statusFilter === "paused" && rule.isActive) return false;
    if (!query) return true;
    return (
      rule.name.toLowerCase().includes(query) ||
      rule.keywords.some((k) => k.toLowerCase().includes(query)) ||
      rule.dmMessage.toLowerCase().includes(query)
    );
  });
  const totalCount = automations.length + facebookOnly.length;
  const shownCount = filtered.length + filteredFacebook.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Campanhas
          </h1>
          <p className="text-sm text-muted">
            {shownCount}
            {shownCount !== totalCount ? ` de ${totalCount}` : ""}{" "}
            campanha{totalCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={handleAccountChange}
            />
          )}
          <Link
            href="/campaigns/import"
            className="flex-1 rounded border border-border px-4 py-2 text-center text-sm font-medium text-muted hover:text-foreground sm:flex-none"
          >
            Importar
          </Link>
          <Link
            href="/campaigns/new"
            className="flex-1 rounded bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-hover sm:flex-none"
          >
            Nova campanha
          </Link>
        </div>
      </div>

      {/* Search + status filter */}
      {totalCount > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Busque campanhas por nome, palavra-chave ou mensagem…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
          />
          <div className="inline-flex shrink-0 rounded-lg bg-surface p-1">
            {(["all", "active", "paused"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                  statusFilter === s
                    ? "bg-background font-medium text-foreground ring-1 ring-accent/40"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {s === "all" ? "todas" : s === "active" ? "ativas" : "pausadas"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="panel rounded p-8 text-center sm:p-12">
          <h3 className="text-lg font-semibold mb-2">Ainda não há campanhas</h3>
          <p className="text-sm text-muted mb-6 max-w-sm mx-auto">
            Crie sua primeira campanha de comentário para DM e transforme uma publicação ou reel em um fluxo de conversas mensurável.
          </p>
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-accent text-sm font-semibold text-white hover:bg-accent-hover transition-colors"
          >
            Criar campanha
          </Link>
        </div>
      )}

      {/* No matches for the current filter */}
      {totalCount > 0 && shownCount === 0 && (
        <div className="panel rounded p-8 text-center text-sm text-muted">
          Nenhuma campanha corresponde à sua busca.
        </div>
      )}

      {/* Campaign cards */}
      <div className="space-y-3">
        {filtered.map((auto) => {
          const videoUrl = auto.postId ? videos[auto.postId] : undefined;
          return (
          <div
            key={auto.id}
            onClick={() => router.push(`/campaigns/${auto.id}`)}
            className="panel rounded p-4 hover:border-border-hover transition-all cursor-pointer"
          >
            {/* Wraps rather than compressing: on a phone the action buttons drop
                to their own line instead of squeezing the campaign summary. */}
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              {auto.postId && thumbnails[auto.postId] && (
                videoUrl ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlayingVideo({ url: videoUrl, postUrl: auto.postUrl });
                    }}
                    aria-label="Reproduzir prévia do reel"
                    className="shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnails[auto.postId]}
                      alt="Reel da campanha"
                      className="w-12 h-12 rounded object-cover border border-border hover:border-border-hover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </button>
                ) : (
                  <a
                    href={auto.postUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnails[auto.postId]}
                      alt="Publicação da campanha"
                      className="w-12 h-12 rounded object-cover border border-border"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </a>
                )
              )}
              <div className="min-w-[12rem] flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold truncate">{auto.name}</h3>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                    @{auto.instagramAccount.username}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      auto.isActive
                        ? "bg-success/10 text-success"
                        : "bg-surface-hover text-muted"
                    }`}
                  >
                    {auto.isActive ? "Ativa" : "Pausada"}
                  </span>
                  {auto.facebook && (
                    <span
                      className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
                      title={`Também roda no Facebook: ${auto.facebook.pageName}`}
                    >
                      + Facebook
                    </span>
                  )}
                  {auto.pendingNextReel && (
                    <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-warning">
                      Aguardando o próximo reel
                    </span>
                  )}
                  {auto.requireFollow && (
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                      Exigir seguir
                    </span>
                  )}
                  {auto.trackedLinks.length >= 2 && (
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                      2 links
                    </span>
                  )}
                </div>

                {/* Keywords */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {auto.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="px-2 py-0.5 rounded-md bg-accent/10 text-accent text-xs font-medium border border-accent/10"
                    >
                      {kw}
                    </span>
                  ))}
                </div>

                {/* DM preview */}
                <p className="text-sm text-muted truncate">&ldquo;{auto.dmMessage}&rdquo;</p>

                {/* Tracked link sent */}
                {auto.trackedLinks[0]?.trackedUrl && (
                  <p className="mt-2 truncate font-mono text-xs text-muted">
                    {auto.trackedLinks[0].trackedUrl}
                  </p>
                )}

                {/* Stats */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-muted">
                  <span className="font-medium text-foreground">
                    {auto._count.dmLogs} execuç{auto._count.dmLogs === 1 ? "ão" : "ões"}
                  </span>
                  <span>·</span>
                  <span className="font-medium text-foreground">
                    {auto.analytics.ctr}% CTR
                  </span>
                  <span>·</span>
                  <span>{auto.analytics.sent} enviadas</span>
                  <span>·</span>
                  <span>{auto.analytics.skipped} ignoradas</span>
                  <span>·</span>
                  <span>{auto.analytics.failed} falhas</span>
                  <span>·</span>
                  <span>{auto.analytics.clicks} cliques</span>
                  {auto.facebook && (
                    <>
                      <span>·</span>
                      <span>
                        Facebook: {auto.facebook.sent} enviadas
                        {auto.facebook.failed > 0 && (
                          <span className="text-error"> · {auto.facebook.failed} falhas</span>
                        )}
                      </span>
                    </>
                  )}
                </div>

                {auto.analytics.topKeywords.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {auto.analytics.topKeywords.map((keyword) => (
                      <span
                        key={keyword.keyword}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted"
                      >
                        {keyword.keyword}: {keyword.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div
                className="ml-auto flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Copy reel URL */}
                {auto.postUrl && (
                  <button
                    onClick={() => void copyReelUrl(auto)}
                    className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                  >
                    {copiedId === auto.id ? "Copiado!" : "Copiar URL"}
                  </button>
                )}
                {/* Toggle */}
                <button
                  onClick={() => toggleActive(auto.id, auto.isActive)}
                  className={`
                    relative w-11 h-6 rounded-full transition-colors
                    ${auto.isActive ? "bg-accent" : "bg-border-hover"}
                  `}
                >
                  <span
                    className={`
                      absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm
                      ${auto.isActive ? "left-6" : "left-1"}
                    `}
                  />
                </button>

                {/* Kebab menu */}
                <div className="relative">
                  <button
                    onClick={() =>
                      setMenuOpenId((cur) => (cur === auto.id ? null : auto.id))
                    }
                    aria-label="Mais ações"
                    className="px-2 py-1 rounded text-lg leading-none text-muted hover:text-foreground"
                  >
                    ⋯
                  </button>
                  {menuOpenId === auto.id && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setMenuOpenId(null)}
                      />
                      <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
                        <button
                          onClick={() => void duplicateAutomation(auto.id)}
                          className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover"
                        >
                          Duplicar
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpenId(null);
                            void deleteAutomation(auto.id);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-error hover:bg-surface-hover"
                        >
                          Excluir
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          );
        })}

        {/* Campaigns that run on Facebook only */}
        {filteredFacebook.map((rule) => (
          <div
            key={rule.id}
            onClick={() => router.push(`/campaigns/facebook/${rule.id}/edit`)}
            className="panel cursor-pointer rounded p-4 transition-all hover:border-border-hover"
          >
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              <div className="min-w-[12rem] flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">{rule.name}</h3>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                    Facebook · {facebookPageNames[rule.facebookPageId] ?? "Página"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      rule.isActive ? "bg-success/10 text-success" : "bg-surface-hover text-muted"
                    }`}
                  >
                    {rule.isActive ? "Ativa" : "Pausada"}
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {rule.matchAnyWord ? (
                    <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-muted">
                      qualquer comentário
                    </span>
                  ) : (
                    rule.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded-md border border-accent/10 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
                      >
                        {kw}
                      </span>
                    ))
                  )}
                </div>
                <p className="truncate text-sm text-muted">&ldquo;{rule.dmMessage}&rdquo;</p>
                <p className="mt-2 truncate text-xs text-muted">
                  {rule.matchAnyPost ? "Qualquer vídeo da Página" : (rule.videoTitle ?? "Vídeo específico")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
                  <span>{rule.sent} enviadas</span>
                  <span>·</span>
                  <span>{rule.failed} falhas</span>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => void toggleFacebookOnly(rule)}
                  aria-label={rule.isActive ? "Pausar campanha" : "Ativar campanha"}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    rule.isActive ? "bg-accent" : "bg-border-hover"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      rule.isActive ? "left-6" : "left-1"
                    }`}
                  />
                </button>
                <button
                  onClick={() => void deleteFacebookOnly(rule)}
                  aria-label="Excluir campanha"
                  className="rounded px-2 py-1 text-xs text-muted hover:text-error"
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Reel lightbox */}
      {playingVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPlayingVideo(null)}
        >
          <div
            className="relative flex max-w-full flex-col items-end gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-4 text-sm">
              {playingVideo.postUrl && (
                <a
                  href={playingVideo.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-300 hover:text-white"
                >
                  Abrir no Instagram
                </a>
              )}
              <button
                type="button"
                onClick={() => setPlayingVideo(null)}
                className="text-zinc-300 hover:text-white"
              >
                Fechar
              </button>
            </div>
            <video
              src={playingVideo.url}
              controls
              autoPlay
              loop
              playsInline
              className="max-h-[80vh] max-w-full rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}
