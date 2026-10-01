export interface GrowthPostInput {
  id: string;
  mediaType: string;
  timestamp: string;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  totalInteractions: number | null;
  campaignDms: number | null;
}

export interface GrowthStoryInput {
  id: string;
  publishedAt: string;
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  totalInteractions: number | null;
}

export interface GrowthFollowerPoint {
  date: string;
  followers: number;
  delta: number | null;
}

export interface GrowthGoals {
  feedPerWeek: number;
  storyDaysPerWeek: number;
}

export interface GrowthActivityDay {
  date: string;
  feedPosts: number;
  storySlides: number;
}

export interface GrowthWeek {
  startDate: string;
  label: string;
  observedDays: number;
  feedPosts: number;
  storyDays: number;
  followerDelta: number | null;
  days: GrowthActivityDay[];
}

export interface GrowthFormatRow {
  id: "reels" | "carousel" | "single" | "stories";
  label: string;
  count: number;
  averageReach: number | null;
  averageSaves: number | null;
  averageShares: number | null;
  campaignDms: number | null;
}

export interface GrowthHeatCell {
  weekday: number;
  hour: number;
  averageInteractions: number | null;
  sampleSize: number;
  rank: number | null;
}

export interface GrowthAnalytics {
  summary: {
    followersGained: number | null;
    reach: number | null;
    interactions: number | null;
    engagementRate: number | null;
    feedPosts: number;
    storySlides: number;
    storyDays: number;
    conversations: number;
  };
  weekly: GrowthWeek[];
  activity: GrowthActivityDay[];
  formats: GrowthFormatRow[];
  funnel: Array<{ id: string; label: string; value: number | null }>;
  heatmap: GrowthHeatCell[];
  feedAveragePerWeek: number;
  storyAverageDaysPerWeek: number;
  feedGoalWeeksHit: number;
  storyGoalWeeksHit: number;
  largestFeedGapDays: number;
  currentStoryStreakDays: number;
  insight: string;
}

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const HEATMAP_HOURS = [8, 10, 12, 14, 16, 18, 20];
const WEEK_COUNT_BY_PERIOD: Record<number, number> = { 30: 5, 90: 13 };

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone });
    return timeZone;
  } catch {
    return "America/Sao_Paulo";
  }
}

function localDateKey(date: Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof date === "string" ? new Date(date) : date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  return addDays(dateKey, -weekday);
}

function weekdayIndex(dateKey: string): number {
  return (new Date(`${dateKey}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function labelWeek(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function postInteractions(post: GrowthPostInput): number | null {
  return post.totalInteractions ?? sumKnown([post.likes, post.comments, post.saved, post.shares]);
}

function average(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

function formatKind(mediaType: string): GrowthFormatRow["id"] {
  const normalized = mediaType.toUpperCase();
  if (normalized === "REELS" || normalized === "VIDEO") return "reels";
  if (normalized === "CAROUSEL_ALBUM") return "carousel";
  return "single";
}

function findNearestHour(hour: number): number | null {
  if (hour < HEATMAP_HOURS[0] || hour > HEATMAP_HOURS.at(-1)!) return null;
  return HEATMAP_HOURS.reduce((nearest, option) =>
    Math.abs(option - hour) < Math.abs(nearest - hour) ? option : nearest
  );
}

function getLocalHour(date: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTimeZone(timeZone),
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(date));
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

function engagementInsight(weeks: GrowthWeek[], goals: GrowthGoals): string {
  const measured = weeks.filter((week) => week.followerDelta !== null);
  if (measured.length < 2) {
    return "Ainda não há histórico suficiente para relacionar frequência e ganho de seguidores. O acompanhamento diário continua sendo registrado.";
  }

  const metBoth = measured.filter(
    (week) =>
      week.feedPosts >= Math.ceil((goals.feedPerWeek * week.observedDays) / 7) &&
      week.storyDays >= Math.ceil((goals.storyDaysPerWeek * week.observedDays) / 7)
  );
  const missedAtLeastOne = measured.filter(
    (week) =>
      week.feedPosts < Math.ceil((goals.feedPerWeek * week.observedDays) / 7) ||
      week.storyDays < Math.ceil((goals.storyDaysPerWeek * week.observedDays) / 7)
  );
  if (metBoth.length && missedAtLeastOne.length) {
    const mean = (items: GrowthWeek[]) =>
      items.reduce(
        (sum, week) => sum + ((week.followerDelta ?? 0) * 7) / Math.max(week.observedDays, 1),
        0
      ) / items.length;
    const metAverage = mean(metBoth);
    const missedAverage = mean(missedAtLeastOne);
    const number = (value: number) => Math.round(value).toLocaleString("pt-BR");
    const comparison = missedAverage > 0
      ? `${(metAverage / missedAverage).toFixed(1).replace(".", ",")}× a média (${number(metAverage)} contra ${number(missedAverage)})`
      : `${number(metAverage)} seguidores líquidos, em média`;
    return `Nas semanas em que as duas metas foram atingidas, o ganho médio registrado foi ${comparison}. É uma comparação descritiva, não uma previsão.`;
  }

  const hitCount = measured.filter(
    (week) =>
      week.feedPosts >= Math.ceil((goals.feedPerWeek * week.observedDays) / 7) &&
      week.storyDays >= Math.ceil((goals.storyDaysPerWeek * week.observedDays) / 7)
  ).length;
  return `As duas metas foram atingidas em ${hitCount} de ${measured.length} semanas com histórico de seguidores.`;
}

export function buildGrowthAnalytics(input: {
  periodDays: 30 | 90;
  timeZone: string;
  now: Date;
  posts: GrowthPostInput[];
  stories: GrowthStoryInput[];
  followerHistory: GrowthFollowerPoint[];
  keywordComments: number;
  sentDms: number;
  clicks: number;
  goals: GrowthGoals;
}): GrowthAnalytics {
  const { periodDays, timeZone, now, posts, stories, followerHistory, goals } = input;
  const zone = safeTimeZone(timeZone);
  const today = localDateKey(now, zone);
  const rangeStart = localDateKey(new Date(now.getTime() - periodDays * 86_400_000), zone);
  const weekCount = WEEK_COUNT_BY_PERIOD[periodDays];
  const firstWeek = addDays(mondayOf(today), -7 * (weekCount - 1));

  const feedByDay = new Map<string, number>();
  const storiesByDay = new Map<string, number>();
  for (const post of posts) {
    const date = localDateKey(post.timestamp, zone);
    feedByDay.set(date, (feedByDay.get(date) ?? 0) + 1);
  }
  for (const story of stories) {
    const date = localDateKey(story.publishedAt, zone);
    storiesByDay.set(date, (storiesByDay.get(date) ?? 0) + 1);
  }

  const followersByWeek = new Map<string, number>();
  for (const point of followerHistory) {
    if (point.delta === null || point.date < rangeStart) continue;
    const week = mondayOf(point.date);
    followersByWeek.set(week, (followersByWeek.get(week) ?? 0) + point.delta);
  }

  const weeks: GrowthWeek[] = Array.from({ length: weekCount }, (_, index) => {
    const startDate = addDays(firstWeek, index * 7);
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addDays(startDate, dayIndex);
      return {
        date,
        feedPosts: feedByDay.get(date) ?? 0,
        storySlides: storiesByDay.get(date) ?? 0,
      };
    });
    const followerDelta = followersByWeek.get(startDate) ?? null;
    return {
      startDate,
      label: labelWeek(startDate),
      observedDays: days.filter((day) => day.date >= rangeStart && day.date <= today).length,
      feedPosts: days.reduce((sum, day) => sum + day.feedPosts, 0),
      storyDays: days.filter((day) => day.storySlides > 0).length,
      followerDelta,
      days,
    };
  });

  const activity = weeks.flatMap((week) => week.days).filter(
    (day) => day.date >= rangeStart && day.date <= today
  );
  const followersGained = sumKnown(
    followerHistory
      .filter((point) => point.date >= rangeStart && point.date <= today)
      .map((point) => point.delta)
  );

  const formatDefinitions: Array<{
    id: GrowthFormatRow["id"];
    label: string;
    posts: GrowthPostInput[];
    stories: GrowthStoryInput[];
  }> = [
    { id: "reels", label: "Reels", posts: posts.filter((post) => formatKind(post.mediaType) === "reels"), stories: [] },
    { id: "carousel", label: "Carrosséis", posts: posts.filter((post) => formatKind(post.mediaType) === "carousel"), stories: [] },
    { id: "single", label: "Post único", posts: posts.filter((post) => formatKind(post.mediaType) === "single"), stories: [] },
    { id: "stories", label: "Stories", posts: [], stories },
  ];
  const formats: GrowthFormatRow[] = formatDefinitions.map((format) => {
    const reach = [...format.posts.map((post) => post.reach), ...format.stories.map((story) => story.reach)];
    const saves = format.posts.map((post) => post.saved);
    const shares = [...format.posts.map((post) => post.shares), ...format.stories.map((story) => story.shares)];
    const dms = format.posts.map((post) => post.campaignDms);
    const count = format.posts.length + format.stories.length;
    return {
      id: format.id,
      label: format.label,
      count,
      averageReach: average(reach),
      averageSaves: average(saves),
      averageShares: average(shares),
      campaignDms: format.id === "stories" ? null : sumKnown(dms),
    };
  });

  const reach = sumKnown([
    ...posts.map((post) => post.reach),
    ...stories.map((story) => story.reach),
  ]);
  const interactions = sumKnown([
    ...posts.map(postInteractions),
    ...stories.map((story) => story.totalInteractions),
  ]);
  const storyDays = new Set(stories.map((story) => localDateKey(story.publishedAt, zone))).size;
  const summary = {
    followersGained,
    reach,
    interactions,
    engagementRate: reach && interactions !== null ? (interactions / reach) * 100 : null,
    feedPosts: posts.length,
    storySlides: stories.length,
    storyDays,
    conversations: input.sentDms,
  };

  const funnel = [
    { id: "reach", label: "Alcance somado por conteúdo", value: reach },
    { id: "interactions", label: "Interações disponíveis", value: interactions },
    { id: "keyword-comments", label: "Comentários que acionaram campanha", value: input.keywordComments },
    { id: "dms", label: "DMs enviadas pela automação", value: input.sentDms },
    { id: "clicks", label: "Cliques rastreados", value: input.clicks },
  ];

  const heatBuckets = new Map<string, { total: number; count: number }>();
  for (const post of posts) {
    const interactionsForPost = postInteractions(post);
    if (interactionsForPost === null) continue;
    const date = localDateKey(post.timestamp, zone);
    const weekday = weekdayIndex(date);
    const hour = findNearestHour(getLocalHour(post.timestamp, zone));
    if (hour === null) continue;
    const key = `${weekday}:${hour}`;
    const bucket = heatBuckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += interactionsForPost;
    bucket.count += 1;
    heatBuckets.set(key, bucket);
  }
  const rankedHeat = [...heatBuckets.entries()]
    .filter(([, value]) => value.count >= 2)
    .map(([key, value]) => ({ key, average: value.total / value.count }))
    .sort((left, right) => right.average - left.average);
  const ranks = new Map(rankedHeat.slice(0, 3).map((item, index) => [item.key, index + 1]));
  const heatmap = Array.from({ length: 7 }, (_, weekday) =>
    HEATMAP_HOURS.map((hour) => {
      const key = `${weekday}:${hour}`;
      const value = heatBuckets.get(key);
      return {
        weekday,
        hour,
        averageInteractions: value ? value.total / value.count : null,
        sampleSize: value?.count ?? 0,
        rank: ranks.get(key) ?? null,
      };
    })
  ).flat();

  let largestFeedGapDays = 0;
  let currentGap = 0;
  for (const day of activity) {
    if (day.feedPosts === 0) {
      currentGap += 1;
      largestFeedGapDays = Math.max(largestFeedGapDays, currentGap);
    } else {
      currentGap = 0;
    }
  }
  let currentStoryStreakDays = 0;
  for (let index = activity.length - 1; index >= 0 && activity[index].storySlides > 0; index -= 1) {
    currentStoryStreakDays += 1;
  }

  const measuredWeeks = weeks.filter((week) => week.startDate <= today && week.followerDelta !== null);
  return {
    summary,
    weekly: weeks,
    activity,
    formats,
    funnel,
    heatmap,
    feedAveragePerWeek: (summary.feedPosts / periodDays) * 7,
    storyAverageDaysPerWeek: (summary.storyDays / periodDays) * 7,
    feedGoalWeeksHit: weeks.filter((week) =>
      week.observedDays > 0 && week.feedPosts >= Math.ceil((goals.feedPerWeek * week.observedDays) / 7)
    ).length,
    storyGoalWeeksHit: weeks.filter((week) =>
      week.observedDays > 0 && week.storyDays >= Math.ceil((goals.storyDaysPerWeek * week.observedDays) / 7)
    ).length,
    largestFeedGapDays,
    currentStoryStreakDays,
    insight: engagementInsight(measuredWeeks, goals),
  };
}

export const GROWTH_WEEKDAYS = WEEKDAYS;
export const GROWTH_HEATMAP_HOURS = HEATMAP_HOURS;
