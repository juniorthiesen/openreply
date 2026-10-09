/** Each variant needs at least this many DMs sent before a result means anything. */
export const MIN_SENT_PER_VARIANT = 100;
/** The leader is called "better" when its chance of beating the other passes this. */
export const DECISIVE_PROBABILITY = 0.95;

export interface VariantCounts {
  /** DMs sent to people in this variant. */
  sent: number;
  /** People who clicked the link at least once (each person counted once). */
  clickers: number;
}

export interface AbSummary {
  /** Chance (0 to 1) that B has the higher true click rate. Null until both have sends. */
  probabilityBBeatsA: number | null;
  /** The variant with the higher click rate so far, or null on a tie or no data. */
  leader: "A" | "B" | null;
  /** Both variants reached the minimum number of sends. */
  enough: boolean;
  /** Enough data and the leader is clearly ahead. */
  decisive: boolean;
  /** One sentence in Portuguese saying where the test stands. */
  verdict: string;
}

/** Click rate as a fraction of the DMs sent. */
export function clickRate(counts: VariantCounts): number {
  return counts.sent > 0 ? Math.min(1, counts.clickers / counts.sent) : 0;
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26). */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-x * x)));
}

/**
 * Chance that B's true click rate is higher than A's, from the clicks and sends
 * of each. Each rate is smoothed (one extra click and one extra miss) so a
 * variant with few sends is never treated as certain.
 */
export function probabilityBBeatsA(a: VariantCounts, b: VariantCounts): number | null {
  if (a.sent <= 0 || b.sent <= 0) return null;
  const rate = (counts: VariantCounts) => (counts.clickers + 1) / (counts.sent + 2);
  const variance = (counts: VariantCounts) => (rate(counts) * (1 - rate(counts))) / (counts.sent + 2);
  const spread = Math.sqrt(variance(a) + variance(b));
  if (spread === 0) return 0.5;
  return normalCdf((rate(b) - rate(a)) / spread);
}

function percent(probability: number): number {
  // Never promise 100% from a sample.
  return Math.min(99, Math.max(1, Math.round(probability * 100)));
}

export function summarizeAbTest(a: VariantCounts, b: VariantCounts): AbSummary {
  const probability = probabilityBBeatsA(a, b);
  const rateA = clickRate(a);
  const rateB = clickRate(b);
  const leader: "A" | "B" | null = a.sent === 0 && b.sent === 0 ? null : rateA === rateB ? null : rateB > rateA ? "B" : "A";
  const enough = a.sent >= MIN_SENT_PER_VARIANT && b.sent >= MIN_SENT_PER_VARIANT;
  const leaderProbability = probability === null ? null : leader === "B" ? probability : 1 - probability;
  const decisive =
    enough && leaderProbability !== null && leader !== null && leaderProbability >= DECISIVE_PROBABILITY;

  let verdict: string;
  if (a.sent === 0 && b.sent === 0) {
    verdict = "Ainda não há DMs enviadas neste teste.";
  } else if (!enough) {
    verdict = `Ainda faltam dados: cada variante precisa de pelo menos ${MIN_SENT_PER_VARIANT} DMs enviadas (A tem ${a.sent}, B tem ${b.sent}).`;
  } else if (leader === null || leaderProbability === null) {
    verdict = "As duas variantes estão empatadas por enquanto. Deixe o teste rodar mais um pouco.";
  } else if (decisive) {
    verdict = `${leader} tem ${percent(leaderProbability)}% de chance de ser melhor que ${leader === "A" ? "B" : "A"}.`;
  } else {
    verdict = `Ainda não dá para dizer qual é melhor: ${leader} está na frente, com ${percent(leaderProbability)}% de chance. Deixe o teste rodar mais um pouco.`;
  }

  return { probabilityBBeatsA: probability, leader, enough, decisive, verdict };
}
