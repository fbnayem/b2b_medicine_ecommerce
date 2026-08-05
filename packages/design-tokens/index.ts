/**
 * The one place a colour, a spacing step or a radius is decided.
 *
 * Before this, the two clients carried about 141 distinct hex values between
 * them, 16 of them hand-copied across the boundary, and **three brand greens in
 * simultaneous use** — `#126b45` sixty-one times, `#16724a` twenty-three,
 * `#176b47` three, plus a fourth on web. Nobody chose that; it accumulated.
 *
 * Two artefacts ship from here, both hand-written:
 *
 *   - `index.ts`  — for JavaScript consumers, which on mobile means StyleSheet
 *                   objects and on web means anything computed.
 *   - `theme.css` — the `@theme` block Tailwind v4 reads.
 *
 * They are kept in step by a parity test that lives in the **web** vitest
 * suite, not in this package: CI runs no package tests, so a test here would be
 * a test nothing runs. Codegen was considered and rejected — CI does not use
 * turbo and `apps/web` has no prebuild hook, so a generator would add coupling
 * to a build graph that has already broken this project once.
 *
 * Product code uses the semantic names only. The raw ramps are exported for the
 * mobile StyleSheets, which have no `var()` and must resolve a literal.
 */

// ─── Ramps ───────────────────────────────────────────────────────────────────

/**
 * The brand green, built as a real ramp around the shade already in the widest
 * use, so this is a consolidation rather than a repaint.
 */
export const green = {
  50: '#eef7f2',
  100: '#d3ebdf',
  200: '#a7d7c0',
  300: '#71bd9c',
  400: '#3f9d78',
  500: '#1f815d',
  600: '#126b45',
  700: '#0e5638',
  800: '#0c452e',
  900: '#0a3826',
} as const;

/**
 * Neutrals biased very slightly green, so they read as chosen alongside the
 * brand rather than inherited from a framework. Every step from 500 up clears
 * 4.5:1 on `neutral.0`.
 */
export const neutral = {
  0: '#ffffff',
  25: '#fafbfa',
  50: '#f4f6f5',
  /*
   * 75 and 850 exist so each theme has four distinct surface steps rather than
   * two. Light had `canvas`, `surface-sunken` and `surface-hover` all set to
   * `50`, so a hovered table row was exactly the colour of the page behind it
   * and nothing on screen had any depth; dark had `surface-hover` equal to
   * `surface-raised` for the same reason.
   */
  75: '#eef1ef',
  100: '#e8ebe9',
  200: '#d5dbd7',
  300: '#b3bdb7',
  400: '#8c9a92',
  500: '#5d6b62',
  600: '#485349',
  700: '#374039',
  800: '#242b26',
  850: '#1d231f',
  900: '#161b18',
  950: '#0d100e',
} as const;

/** Status ramps. Each `600` clears 4.5:1 on white; each `700` clears 7:1. */
export const red = {
  50: '#fdf2f2',
  100: '#fbe0e0',
  200: '#f5bcbc',
  600: '#c02626',
  700: '#9b1c1c',
  800: '#7a1616',
} as const;

export const amber = {
  50: '#fdf6e8',
  100: '#f9e8c2',
  200: '#f0d189',
  600: '#8a5300',
  700: '#6f4200',
  800: '#553300',
} as const;

export const blue = {
  50: '#eff4fb',
  100: '#d8e5f5',
  200: '#b0c9ea',
  600: '#1f5fa8',
  700: '#17497f',
  800: '#123a66',
} as const;

/**
 * Two more hues, for the middle of a lifecycle rather than for a verdict.
 *
 * An order passes through twenty-two statuses and **ten of them** were rendered
 * in the same blue: submitted, under review, preparing, packing, packed,
 * invoiced, ready, assigned, handed over and picked up. A queue of those cannot
 * be scanned — every pill has to be read — which defeats the point of a pill.
 *
 * These are the teal and plum already in the chart palette, given ramps so they
 * can be a badge as well as a line. Teal is work happening in the building;
 * plum is work that has left it. Neither is a verdict, so neither borrows the
 * green of success or the red of failure.
 */
export const teal = {
  50: '#eaf5f6',
  100: '#c7e6e9',
  200: '#7fc9d1',
  600: '#0f6f78',
  700: '#0b565d',
  800: '#083f45',
} as const;

export const plum = {
  50: '#f7eff5',
  100: '#ecd9e6',
  200: '#d9a8cc',
  600: '#7a3f6d',
  700: '#623256',
  800: '#4a2641',
} as const;

/**
 * The chart palette. Distinguishable in the common forms of colour blindness
 * and, crucially, ordered so the first two series separate in greyscale — a
 * printed report is monochrome more often than not.
 *
 * `Chart.tsx` carried its own unrelated blue-and-purple palette; this replaces
 * it, and phase 5 adds dash patterns so series never rely on colour alone.
 */
export const chartLight = [
  '#126b45',
  '#1f5fa8',
  '#8a5300',
  '#7a3f6d',
  '#0f6f78',
  '#485349',
] as const;

/**
 * The same six hues lifted up their ramps for a dark ground.
 *
 * One palette cannot serve both surfaces. The parity test caught `#71bd9c`
 * sitting at 2.22:1 on white — a line nobody can follow — which is the same
 * class of mistake as the two greys that shipped, found the same way.
 */
export const chartDark = [
  '#71bd9c',
  '#b0c9ea',
  '#f0d189',
  '#d9a8cc',
  '#7fc9d1',
  '#b3bdb7',
] as const;

/** The light surface is the default; `Chart.tsx` picks by resolved theme. */
export const chart = chartLight;

// ─── Semantic layer ──────────────────────────────────────────────────────────

export const semanticLight = {
  'color-canvas': neutral[50],
  'color-surface': neutral[0],
  /*
   * Raised stays white: on a light theme elevation is carried by the shadow,
   * because there is nothing above white to go to. Sunken and hover are the
   * two that had to move — they were both `50`, the colour of the canvas, so a
   * table header and a hovered row were invisible as such.
   */
  'color-surface-raised': neutral[0],
  'color-surface-sunken': neutral[100],
  'color-surface-hover': neutral[75],

  'color-border': neutral[200],
  'color-border-strong': neutral[300],

  'color-text': neutral[900],
  'color-text-muted': neutral[500],
  'color-text-inverse': neutral[0],

  'color-brand': green[600],
  'color-brand-strong': green[700],
  'color-brand-subtle': green[50],
  'color-on-brand': neutral[0],

  'color-success': green[600],
  'color-success-subtle': green[50],
  'color-warning': amber[600],
  'color-warning-subtle': amber[50],
  'color-danger': red[600],
  'color-danger-subtle': red[50],
  'color-info': blue[600],
  'color-info-subtle': blue[50],
  /** In the warehouse: preparing, packing, packed, invoiced. */
  'color-progress': teal[600],
  'color-progress-subtle': teal[50],
  /** Out of the warehouse: ready, assigned, handed over, picked up. */
  'color-transit': plum[600],
  'color-transit-subtle': plum[50],

  /** The focus ring. One token, so every interactive primitive shares it. */
  'color-ring': green[500],
} as const;

/**
 * `Record<keyof typeof semanticLight, string>` rather than an object literal: a
 * token added to light and forgotten in dark becomes a **compile error** here,
 * instead of a contrast bug somebody finds in the dark six weeks later.
 */
export const semanticDark: Record<keyof typeof semanticLight, string> = {
  'color-canvas': neutral[950],
  'color-surface': neutral[900],
  'color-surface-raised': neutral[800],
  'color-surface-sunken': neutral[950],
  'color-surface-hover': neutral[850],

  'color-border': neutral[700],
  'color-border-strong': neutral[600],

  'color-text': neutral[50],
  'color-text-muted': neutral[300],
  'color-text-inverse': neutral[900],

  // Not a naive inversion: `green.600` on a dark ground falls under 4.5:1, so
  // the dark theme reaches up the ramp rather than down.
  'color-brand': green[300],
  'color-brand-strong': green[200],
  'color-brand-subtle': green[900],
  'color-on-brand': neutral[950],

  'color-success': green[300],
  'color-success-subtle': green[900],
  'color-warning': amber[200],
  'color-warning-subtle': amber[800],
  'color-danger': red[200],
  'color-danger-subtle': red[800],
  'color-info': blue[200],
  'color-info-subtle': blue[800],
  'color-progress': teal[200],
  'color-progress-subtle': teal[800],
  'color-transit': plum[200],
  'color-transit-subtle': plum[800],

  'color-ring': green[300],
};

export type SemanticToken = keyof typeof semanticLight;

// ─── Scale ───────────────────────────────────────────────────────────────────

/**
 * A 4px base. The two clients between them used about 23 ad-hoc spacing values;
 * every one of them rounds to a step here.
 */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = { none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 } as const;

/** Nine hand-rolled radii and 25 font sizes across three units collapse to these. */
export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
} as const;

export const fontWeight = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;

export const lineHeight = { tight: 1.25, snug: 1.4, normal: 1.55 } as const;

/**
 * The minimum a finger can reliably hit. In-row action buttons currently
 * compute to 28–30px and are used by warehouse and delivery staff, often
 * standing, often in gloves.
 */
export const minTapTarget = 44;

export const shadow = {
  sm: '0 1px 2px rgba(13, 16, 14, 0.06)',
  md: '0 2px 8px rgba(13, 16, 14, 0.08)',
  lg: '0 8px 24px rgba(13, 16, 14, 0.12)',
} as const;

/** Named so a dialog can never accidentally sit under a sticky header. */
export const zIndex = { base: 0, sticky: 10, overlay: 100, dialog: 200, toast: 300 } as const;

// ─── Brand ───────────────────────────────────────────────────────────────────

/**
 * Fallback branding, used until `GET /settings/branding` answers. The name was
 * hard-coded in two places on web, and `app.json` still said `"mobile"`.
 */
export const brand = {
  name: 'MedSupply B2B',
  /** Mirrored in `apps/mobile/app.json`, which no package can reach. */
  notificationColor: green[600],
  currencySymbol: '৳',
} as const;

/** Every token, flattened, for the parity test and anything generic. */
export const tokens = {
  green,
  neutral,
  red,
  amber,
  blue,
  chartLight,
  chartDark,
  chart,
  semanticLight,
  semanticDark,
  space,
  radius,
  fontSize,
  fontWeight,
  lineHeight,
  shadow,
  zIndex,
  minTapTarget,
  brand,
} as const;
