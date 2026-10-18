import { Color } from 'three';

/**
 * Colour scale for reported site energy intensity.
 *
 * Only the worst quartile is painted. A building below the cohort's 75th
 * percentile is dimmed rather than coloured, and everything from the cutoff
 * upward glows red, brighter the heavier it is. The five heaviest get a hotter
 * red still, so they read as the thing to look at first.
 *
 * Painting a quarter of the city rather than all of it is what makes this
 * legible: a scale spanning every building spends most of its range on
 * buildings nobody will act on, while this one spends all of it on the ones
 * that matter.
 *
 * Unlike a spectral ramp, this is a single hue whose lightness rises
 * monotonically in OKLab - measured, not assumed:
 *
 *   p75 cutoff          #5c1010  L=0.312
 *                       #8f1515  L=0.419
 *                       #c41d1d  L=0.527
 *                       #ef3b2c  L=0.626
 *   p95 and above       #ff7a5c  L=0.729
 *   top five            #ff9d85  L=0.791
 *
 * so the red set survives greyscale and every form of colour vision
 * deficiency, with near-uniform steps (deltas 0.107, 0.107, 0.100, 0.103).
 *
 * Buildings below the cutoff are left exactly as the city draws them - white
 * windows, teal band - rather than dimmed. Worth knowing what that costs:
 * #c8efff sits at L=0.929, above every red here, so a flagged building is
 * always darker than an unflagged one and a building right at the cutoff can
 * read as unlit rather than as marginally over. Severity is carried by hue
 * against the white city, and by brightness only within the red set.
 *
 * Caveat worth repeating wherever this is shown: raw EUI mixes building type
 * with building performance. A hospital legitimately out-consumes a warehouse,
 * so a bright building is not necessarily a badly run one.
 */

/** Cutoff to hottest. Applies only at or above the cohort's p75. */
export const EUI_RAMP = ['#5c1010', '#8f1515', '#c41d1d', '#ef3b2c', '#ff7a5c'] as const;

/** The five heaviest, brighter than the ramp's top so they stand out within it. */
export const EUI_TOP_COLOR = '#ff9d85';
export const EUI_TOP_N = 5;

/** The city's own lit-window colour. Kept for every building below the cutoff. */
export const WINDOW_BASE = '#c8efff';

/** The band's own colour. Kept for every building below the cutoff. */
export const BAND_BASE = '#5eead4';

export type EuiScale = {
  min: number;
  p05: number;
  median: number;
  p75: number;
  p95: number;
  max: number;
  n: number;
};

/** Whether this building falls in the worst quartile, and so gets painted. */
export function isFlagged(eui: number | null | undefined, scale: EuiScale | null): boolean {
  if (eui == null || scale == null) return false;
  return eui >= scale.p75;
}

/**
 * Position on the red ramp, 0..1, across the worst quartile only.
 *
 * Spans p75 to p95 and clamps above, so the handful of extreme filings cannot
 * compress every other flagged building into the dimmest step.
 */
export function euiToT(eui: number, scale: EuiScale): number {
  const lo = scale.p75;
  const hi = scale.p95;
  if (!(hi > lo)) return 1;
  return Math.min(1, Math.max(0, (eui - lo) / (hi - lo)));
}

function rampHex(t: number): string {
  const span = EUI_RAMP.length - 1;
  const idx = Math.min(span - 1, Math.floor(t * span));
  const local = t * span - idx;
  const a = new Color(EUI_RAMP[idx]);
  const b = new Color(EUI_RAMP[idx + 1]);
  return `#${a.lerp(b, local).getHexString()}`;
}

/**
 * Colour for one building, as a hex string.
 *
 * `unflagged` is what a building below the cutoff keeps - the caller passes the
 * channel's own colour, since windows and the band start from different ones.
 */
export function euiHex(
  eui: number | null | undefined,
  scale: EuiScale | null,
  isTop = false,
  unflagged: string = WINDOW_BASE,
): string {
  if (isTop) return EUI_TOP_COLOR;
  if (scale == null) return unflagged;
  if (eui == null) return unflagged;
  if (!isFlagged(eui, scale)) return unflagged;
  return rampHex(euiToT(eui, scale));
}

/**
 * Same colour as a linear-space THREE.Color, for a vertex or instance buffer.
 *
 * three does not colour-manage values written straight into a buffer, so the
 * sRGB hex has to be converted here or everything renders washed out.
 */
export function euiLinearColor(
  eui: number | null | undefined,
  scale: EuiScale | null,
  target = new Color(),
  isTop = false,
  unflagged: string = WINDOW_BASE,
): Color {
  return target.set(euiHex(eui, scale, isTop, unflagged)).convertSRGBToLinear();
}

/** The painted part of the ramp as a CSS gradient, for the legend. */
export function euiGradientCss(): string {
  const stops = EUI_RAMP.map(
    (hex, i) => `${hex} ${((i / (EUI_RAMP.length - 1)) * 100).toFixed(0)}%`,
  );
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
