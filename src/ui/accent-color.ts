// core/src/ui/accent-color.ts — shared by every portal via @core/ui/accent-color
// Pure color helpers for the dynamic org accent. No DOM access — unit-testable.

export interface RGB { r: number; g: number; b: number }

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance (0–1). */
export function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Saturation (0–1) of an RGB color via HSL. */
export function saturation({ r, g, b }: RGB): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };

/** Scale all channels toward black by `factor` (0–1). 0.18 = ~18% darker. */
export function darken(rgb: RGB, factor: number): RGB {
  const k = 1 - factor;
  return { r: rgb.r * k, g: rgb.g * k, b: rgb.b * k };
}

/**
 * Darken a color in steps until it reaches `minRatio` contrast against white.
 * Because contrast is symmetric this guarantees legibility BOTH ways:
 * white text on the accent (buttons) AND accent text on white/light bg (links,
 * active nav). Target is 5.5:1 — above the 4.5 AA floor — for comfortable margin
 * on near-white surfaces.
 */
export function ensureContrastForWhiteText(rgb: RGB, minRatio = 5.5): RGB {
  let cur = rgb;
  for (let i = 0; i < 24 && contrastRatio(cur, WHITE) < minRatio; i++) {
    cur = darken(cur, 0.08);
  }
  return cur;
}

export interface AccentPalette { accent: string; deep: string; tint: string }

/**
 * Build the portal accent palette from a base hex.
 * - accent: contrast-guarded base (white text legible)
 * - deep:   ~18% darker (hover)
 * - tint:   base at 8% alpha (translucent bg)
 * Returns null if the hex is invalid.
 */
export function deriveAccentPalette(hex: string): AccentPalette | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const accentRgb = ensureContrastForWhiteText(rgb);
  const deepRgb   = darken(accentRgb, 0.18);
  return {
    accent: rgbToHex(accentRgb),
    deep:   rgbToHex(deepRgb),
    tint:   `rgba(${Math.round(accentRgb.r)}, ${Math.round(accentRgb.g)}, ${Math.round(accentRgb.b)}, 0.08)`,
  };
}

/** True if a color is too grey/washed to make a meaningful accent. */
export function isLowSaturation(rgb: RGB, threshold = 0.15): boolean {
  return saturation(rgb) < threshold;
}
