import { createHash } from "node:crypto";

export type AbVariantKey = "A" | "B";

export interface AbLink {
  slug: string;
  label: string | null;
  destinationUrl: string;
}

/** What the worker needs from a running test. */
export interface AbTestForWorker {
  id: string;
  weightA: number;
  aDmMessage: string;
  aLinkButtonLabel: string | null;
  aTrackedLink: AbLink | null;
  bDmMessage: string;
  bLinkButtonLabel: string | null;
  bTrackedLink: AbLink | null;
}

/** The parts of a campaign a variant replaces. */
export interface AbVariantTarget {
  dmMessage: string;
  linkButtonLabel: string | null;
  trackedLinks: AbLink[];
}

export const MIN_WEIGHT_A = 10;
export const MAX_WEIGHT_A = 90;

/** Keep the split between 10/90 and 90/10, so both variants always get some people. */
export function clampWeightA(weight: number): number {
  if (!Number.isFinite(weight)) return 50;
  return Math.min(MAX_WEIGHT_A, Math.max(MIN_WEIGHT_A, Math.round(weight)));
}

/**
 * Which variant a person gets: a stable hash of the test and the person, not a
 * coin toss, so someone who comments twice, or taps a button later, sees the
 * same version and never both.
 */
export function pickVariantKey(testId: string, personId: string, weightA: number): AbVariantKey {
  const digest = createHash("sha256").update(`ab:${testId}:${personId}`).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < weightA ? "A" : "B";
}

/** Prefer the variant already recorded for this person in this test, so a retry never flips it. */
export function resolveVariantKey(
  test: Pick<AbTestForWorker, "id" | "weightA">,
  personId: string,
  logged?: { abTestId: string | null; abVariantKey: string | null } | null
): AbVariantKey {
  if (logged && logged.abTestId === test.id && (logged.abVariantKey === "A" || logged.abVariantKey === "B")) {
    return logged.abVariantKey;
  }
  return pickVariantKey(test.id, personId, test.weightA);
}

/** The campaign as the chosen variant would send it: its message, button label and link. */
export function applyAbVariant<T extends AbVariantTarget>(
  automation: T,
  test: AbTestForWorker,
  key: AbVariantKey
): T {
  const isA = key === "A";
  const link = isA ? test.aTrackedLink : test.bTrackedLink;
  return {
    ...automation,
    dmMessage: isA ? test.aDmMessage : test.bDmMessage,
    linkButtonLabel: isA ? test.aLinkButtonLabel : test.bLinkButtonLabel,
    trackedLinks: link ? [link] : [],
  };
}

/**
 * Add UTM parameters so the person's own analytics (Google Analytics, a store)
 * can tell the variants apart after the click. Parameters already in the
 * address are never overwritten.
 */
export function withUtmParams(rawUrl: string, key: AbVariantKey, campaignId: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const defaults: Array<[string, string]> = [
    ["utm_source", "fisga"],
    ["utm_medium", "instagram_dm"],
    ["utm_campaign", `ab-${campaignId}`],
    ["utm_content", `variante-${key.toLowerCase()}`],
  ];
  for (const [name, value] of defaults) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, value);
  }
  return url.toString();
}
