import { StyleSheet } from 'react-native';
import {
  green,
  minTapTarget,
  neutral,
  radius,
  red,
  amber,
  blue,
  fontSize,
  fontWeight,
  space,
  semanticLight,
} from '@medsupply/design-tokens';

/**
 * The mobile half of the token package.
 *
 * React Native has no `var()`, so a StyleSheet must resolve a literal — which
 * is why the raw ramps are exported from the package at all. Before this,
 * mobile carried around 70 of its own hex values, sixteen of them hand-copied
 * from the web app, including a second and a third brand green.
 *
 * Light only for now, deliberately. `app.json` pins `userInterfaceStyle` to
 * light and the screens are written against it; unpinning that and rendering a
 * dark theme correctly on every screen is real work rather than a re-export,
 * and doing it badly would leave a rider with white text on white.
 */
export const colour = {
  canvas: semanticLight['color-canvas'],
  surface: semanticLight['color-surface'],
  border: semanticLight['color-border'],
  text: semanticLight['color-text'],
  textMuted: semanticLight['color-text-muted'],
  brand: semanticLight['color-brand'],
  brandStrong: semanticLight['color-brand-strong'],
  brandSubtle: semanticLight['color-brand-subtle'],
  onBrand: semanticLight['color-on-brand'],
  success: green[600],
  warning: amber[600],
  danger: red[600],
  info: blue[600],
  disabled: neutral[300],
} as const;

export const layout = {
  space,
  radius,
  fontSize,
  fontWeight,
  /**
   * Every pressable on this application is used one-handed, often outdoors,
   * frequently by somebody wearing gloves in a cold store. 44px is the floor,
   * not the target.
   */
  minTapTarget,
} as const;

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.canvas },
  content: { padding: space[4], gap: space[3] },
  card: {
    backgroundColor: colour.surface,
    borderColor: colour.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space[4],
    gap: space[2],
  },
  title: { fontSize: fontSize['2xl'], fontWeight: '600', color: colour.text },
  heading: { fontSize: fontSize.lg, fontWeight: '600', color: colour.text },
  body: { fontSize: fontSize.base, color: colour.text },
  muted: { fontSize: fontSize.sm, color: colour.textMuted },
  action: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colour.brand,
  },
  actionText: { color: colour.onBrand, fontSize: fontSize.base, fontWeight: '600' },
  secondaryAction: {
    minHeight: minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surface,
  },
  secondaryActionText: { color: colour.text, fontSize: fontSize.base, fontWeight: '600' },
});
