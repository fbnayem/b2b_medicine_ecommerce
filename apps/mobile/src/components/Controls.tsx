import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colour, layout } from '../theme';

/**
 * Buttons and fields, with the tap target and the label built in.
 *
 * `minTapTarget` is 44 because these screens are used one-handed, outdoors,
 * frequently through a glove — the token package says so and every hand-written
 * `Pressable` had to remember it. A field's label and its error message were
 * likewise re-wired per screen, which is how controls end up unlabelled.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  label: string;
  /**
   * What a screen reader announces, when the visible label is not a sentence.
   *
   * Defaults to `label`, which is right for every button whose face carries
   * words. It is wrong for the few that carry a symbol: a quantity stepper
   * announcing "minus" tells somebody the shape of the button rather than what
   * pressing it does, and "one fewer Napa" is the thing they need.
   */
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks further presses — a double-tap must not double-post. */
  busy?: boolean;
  style?: ViewStyle;
}

function background(variant: ButtonVariant, pressed: boolean): string {
  if (variant === 'secondary') return pressed ? colour.brandSubtle : colour.surface;
  if (variant === 'danger') return pressed ? colour.danger : colour.danger;
  return pressed ? colour.brandStrong : colour.brand;
}

export function Button({
  label,
  accessibilityLabel,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  style,
}: ButtonProps) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(busy) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: layout.minTapTarget,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: layout.space[2],
          paddingHorizontal: layout.space[4],
          borderRadius: layout.radius.md,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colour.border,
          backgroundColor: background(variant, pressed),
          opacity: inactive ? 0.5 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'secondary' ? colour.text : colour.onBrand} />
      ) : null}
      <Text
        style={{
          fontSize: layout.fontSize.base,
          fontWeight: '600',
          color: variant === 'secondary' ? colour.text : colour.onBrand,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A row of queue filters, announced as the toggles they are.
 *
 * Every queue screen built its own row of `Pressable`s coloured by an `active`
 * style, so which filter was applied was visible and silent — a screen reader
 * read six identically-named buttons with no indication of which one was on.
 * `aria-pressed`'s React Native equivalent is `accessibilityState.selected`,
 * and it is the whole reason this is a component rather than a style.
 */
export function FilterChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly FilterOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[2] }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value || 'all'}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={{
              minHeight: layout.minTapTarget,
              justifyContent: 'center',
              paddingHorizontal: layout.space[3],
              borderRadius: layout.radius.full,
              borderWidth: 1,
              borderColor: selected ? colour.brand : colour.border,
              backgroundColor: selected ? colour.brand : colour.surface,
            }}
          >
            <Text
              style={{
                color: selected ? colour.onBrand : colour.text,
                fontWeight: '600',
                fontSize: layout.fontSize.sm,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface FieldProps {
  label: string;
  hint?: string;
  /** Shown instead of the hint, and announced. */
  error?: string;
  children: ReactNode;
  style?: ViewStyle;
}

export function Field({ label, hint, error, children, style }: FieldProps) {
  return (
    <View style={[{ gap: layout.space[1] }, style]}>
      <Text style={{ fontSize: layout.fontSize.sm, fontWeight: '600', color: colour.text }}>
        {label}
      </Text>
      {children}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ fontSize: layout.fontSize.sm, color: colour.danger }}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text style={{ fontSize: layout.fontSize.sm, color: colour.textMuted }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export interface InputProps extends TextInputProps {
  label: string;
  invalid?: boolean;
}

/**
 * `accessibilityLabel` is required rather than optional.
 *
 * React Native does not associate a nearby `<Text>` with a `TextInput` the way
 * a `<label for>` does on the web, so an unlabelled input is genuinely
 * unlabelled to a screen reader. Making it part of the signature is what stops
 * that being forgotten.
 */
export function Input({ label, invalid, style, ...rest }: InputProps) {
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={colour.textMuted}
      style={[
        {
          minHeight: layout.minTapTarget,
          borderWidth: 1,
          borderColor: invalid ? colour.danger : colour.border,
          borderRadius: layout.radius.md,
          paddingHorizontal: layout.space[3],
          fontSize: layout.fontSize.base,
          color: colour.text,
          backgroundColor: colour.surface,
        },
        style,
      ]}
      {...rest}
    />
  );
}
