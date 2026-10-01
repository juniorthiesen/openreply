export interface StorySlideMetricInput {
  reach: number | null;
  replies: number | null;
  shares: number | null;
  follows: number | null;
  profileVisits: number | null;
  totalInteractions: number | null;
  navigation: unknown;
}

export interface StorySequenceMetrics {
  firstReach: number | null;
  lastReach: number | null;
  completionRate: number | null;
  replies: number;
  shares: number;
  follows: number;
  profileVisits: number;
  totalInteractions: number;
  exits: number;
}

export function summarizeStorySequence(slides: StorySlideMetricInput[]): StorySequenceMetrics {
  const firstReach = slides[0]?.reach ?? null;
  const lastReach = slides.at(-1)?.reach ?? null;
  const navigation = slides.reduce<Record<string, number>>((totals, slide) => {
    if (!slide.navigation || typeof slide.navigation !== "object" || Array.isArray(slide.navigation)) return totals;
    for (const [key, value] of Object.entries(slide.navigation)) {
      if (typeof value === "number" && Number.isFinite(value)) totals[key.toLowerCase()] = (totals[key.toLowerCase()] ?? 0) + value;
    }
    return totals;
  }, {});
  const sum = (key: "replies" | "shares" | "follows" | "profileVisits" | "totalInteractions") =>
    slides.reduce((total, slide) => total + (slide[key] ?? 0), 0);

  return {
    firstReach,
    lastReach,
    completionRate: firstReach && firstReach > 0 && lastReach !== null ? Math.max(0, Math.min(1, lastReach / firstReach)) : null,
    replies: sum("replies"),
    shares: sum("shares"),
    follows: sum("follows"),
    profileVisits: sum("profileVisits"),
    totalInteractions: sum("totalInteractions"),
    exits: navigation.tap_exit ?? navigation.exited ?? navigation.exit ?? 0,
  };
}
