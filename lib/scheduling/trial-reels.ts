export const TRIAL_REEL_GRADUATION_STRATEGIES = [
  "MANUAL",
  "SS_PERFORMANCE",
] as const;

export type TrialReelGraduationStrategy =
  (typeof TRIAL_REEL_GRADUATION_STRATEGIES)[number];

export function validateTrialReelAssets(
  assets: Array<{ contentType: string }>,
  strategy?: TrialReelGraduationStrategy | null
): string | null {
  if (!strategy) return null;
  if (assets.length !== 1) {
    return "Um Reel de teste precisa ter apenas um vídeo.";
  }
  if (!assets[0].contentType.startsWith("video/")) {
    return "Reels de teste aceitam apenas um vídeo.";
  }
  return null;
}
