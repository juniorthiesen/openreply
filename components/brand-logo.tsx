/**
 * Fisga logo, as specified in the brandbook (redesign/Brandbook-html): a hook
 * stroke inside a rounded square, next to "Fisga" in Bricolage Grotesque Bold.
 *
 * Variants follow the brandbook's three approved applications:
 * - primary  — ink square, ember hook. Light backgrounds.
 * - negative — ember square, ink hook. Dark backgrounds.
 * - mono     — white square, Fisga-red hook. On the brand red.
 */

/** The hook path, shared with app/icon.svg and the email/PNG icons. */
export const BRAND_HOOK_PATH = "M15 3v11a5 5 0 0 1-10 0v-3l3 3";

type Variant = "primary" | "negative" | "mono";

const VARIANT_COLORS: Record<Variant, { square: string; hook: string; text: string }> = {
  primary: { square: "#16181D", hook: "#F26B3A", text: "text-foreground" },
  negative: { square: "#F26B3A", hook: "#16181D", text: "text-white" },
  mono: { square: "#FFFFFF", hook: "#C23E17", text: "text-white" },
};

export function BrandMark({
  size = 40,
  variant = "primary",
  className = "",
}: {
  size?: number;
  variant?: Variant;
  className?: string;
}) {
  const colors = VARIANT_COLORS[variant];
  // Brandbook ratios: radius ≈ 28% of the square, hook ≈ 56% of it, and a
  // heavier stroke at small sizes so the hook stays legible.
  const radius = Math.round(size * 0.28);
  const hook = Math.round(size * 0.56);
  const stroke = size <= 24 ? 2.6 : size <= 32 ? 2.4 : 2.2;

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size, borderRadius: radius, background: colors.square }}
    >
      <svg
        width={hook}
        height={hook}
        viewBox="0 0 24 24"
        fill="none"
        stroke={colors.hook}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={BRAND_HOOK_PATH} />
      </svg>
    </span>
  );
}

export function BrandLogo({
  size = 36,
  variant = "primary",
  className = "",
}: {
  size?: number;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: Math.round(size * 0.24) }}>
      <BrandMark size={size} variant={variant} />
      <span
        className={`font-display font-bold leading-none tracking-[-0.02em] ${VARIANT_COLORS[variant].text}`}
        style={{ fontSize: Math.round(size * 0.68) }}
      >
        Fisga
      </span>
    </span>
  );
}
