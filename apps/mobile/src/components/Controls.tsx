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
      accessibilityLabel={label}
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
