"use client";

import { useEffect, useState } from "react";
import { apiRequest, formatDateTime } from "@/components/scheduling/shared";

interface CapturedStory {
  instagramMediaId: string;
  postedAt: string;
  caption: string | null;
  mediaType: string | null;
}

interface StoryReplyPickerProps {
  instagramAccountId: string;
  value: string | null;
  onChange: (storyMediaId: string | null) => void;
}

function storyLabel(story: CapturedStory) {
  const kind = story.mediaType === "VIDEO" ? "vídeo" : "foto";
  const caption = story.caption ? ` · ${story.caption.slice(0, 40)}` : "";
  return `${formatDateTime(story.postedAt)} · ${kind}${caption}`;
}

/**
 * Lets a DM-triggered campaign answer only the replies to one captured Story.
 * The list holds the Stories Fisga saved from this account; the empty choice
 * keeps the campaign answering every DM that matches its words.
 */
export default function StoryReplyPicker({ instagramAccountId, value, onChange }: StoryReplyPickerProps) {
  const [stories, setStories] = useState<CapturedStory[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    apiRequest<{ stories: CapturedStory[] }>(
      `/api/instagram/stories/external?accountId=${encodeURIComponent(instagramAccountId)}`
    )
      .then((data) => { if (mounted) { setStories(data.stories); setFailed(false); } })
      .catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; };
  }, [instagramAccountId]);

  const known = stories?.some((story) => story.instagramMediaId === value) ?? false;

  return (
    <div className="space-y-1.5 rounded-lg border border-border px-3 py-2.5">
      <label htmlFor="story-reply-picker" className="text-sm text-foreground">
        responder só a quem responder a um Story
      </label>
      <select
        id="story-reply-picker"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none"
      >
        <option value="">Qualquer DM com essas palavras</option>
        {value && !known && <option value={value}>Story já selecionado</option>}
        {(stories ?? []).map((story) => (
          <option key={story.instagramMediaId} value={story.instagramMediaId}>
            {storyLabel(story)}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted">
        {failed
          ? "Não foi possível carregar os Stories capturados."
          : stories && stories.length === 0
            ? "Ainda não há Stories capturados desta conta. Eles aparecem até 15 minutos depois de postados."
            : "Escolha o Story: a campanha responde só a quem responder a ele. Stories novos aparecem até 15 minutos depois de postados."}
      </p>
    </div>
  );
}
