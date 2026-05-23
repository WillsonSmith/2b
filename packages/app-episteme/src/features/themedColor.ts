/**
 * Adjust a user-picked color's lightness so it stays legible on the active theme.
 * Hue and saturation are preserved; lightness is clamped into a band that works
 * as foreground text against the theme's background.
 */
export function themedColor(hex: string, theme: "dark" | "light"): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const l =
    theme === "dark"
      ? Math.max(58, Math.min(78, hsl.l))
      : Math.max(20, Math.min(48, hsl.l));
  return hslToHex(hsl.h, hsl.s, l);
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const cleaned = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const c = lN - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Canonical user-facing defaults for the color picker. These are pure hues
 * — the renderer applies `themedColor` to map them onto the active theme.
 */
export const DEFAULT_HIGHLIGHT_COLORS = {
  posNoun: "#6699dd",
  posVerb: "#c08050",
  posAdjective: "#a070c0",
  posAdverb: "#4ca070",
  punct: "#cc9944",
  styleFiller: "#cc9944",
  styleCliche: "#cc5555",
  styleRedundancy: "#6699dd",
} as const;

export type HighlightColorKey = keyof typeof DEFAULT_HIGHLIGHT_COLORS;

/** Map from config-color-key → CSS custom property name. */
export const HIGHLIGHT_CSS_VARS: Record<HighlightColorKey, string> = {
  posNoun: "--pos-noun",
  posVerb: "--pos-verb",
  posAdjective: "--pos-adjective",
  posAdverb: "--pos-adverb",
  punct: "--punct",
  styleFiller: "--style-filler",
  styleCliche: "--style-cliche",
  styleRedundancy: "--style-redundancy",
};
