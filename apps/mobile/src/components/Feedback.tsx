import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';
import { colour, layout } from '../theme';

/**
 * Loading, empty and error, said once — the mobile half.
 *
 * Every screen wrote its own. `ready.tsx` is representative: a red line of text
 * reading "Unable to load ready packages. Pull down to retry." and nothing to
 * press. Pull-to-refresh is discoverable to the person who wrote it and to
 * nobody wearing gloves in a cold store who has just watched a screen fail.
 *
 * Deliberately the same three names and the same shapes as
 * `apps/web/src/components/ui/Feedback.tsx`. The two clients have already
 * drifted once over things this small — web guards its refresh interceptor
 * against an infinite loop and mobile does not — and a shared vocabulary is
 * cheaper to keep than to restore.
 */

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <View
      /*
       * `accessible` is not decoration here.
       *
       * React Native exposes `Text` to a screen reader by default and a `View`
       * not at all, so `accessibilityRole` on a plain `View` is inert — the
       * role is declared and never reaches TalkBack or VoiceOver. This
       * component and `ErrorState` below both shipped that way, which meant the
       * two states a rider most needs announced were the two that said nothing.
       * Caught by the first render test written against them.
       */
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: layout.space[3],
        padding: layout.space[6],
      }}
    >
      <ActivityIndicator color={colour.brand} />
      <Text style={{ fontSize: layout.fontSize.base, color: colour.textMuted }}>{label}…</Text>
    </View>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  style?: ViewStyle;
}

export function EmptyState({ title, description, action, style }: EmptyStateProps) {
  return (
    <View
      style={[
        {
          alignItems: 'center',
          gap: layout.space[2],
          padding: layout.space[6],
          borderRadius: layout.radius.lg,
          borderWidth: 1,
          borderColor: colour.border,
          borderStyle: 'dashed',
          backgroundColor: colour.surface,
        },
        style,
      ]}
    >
      <Text
        style={{
          fontSize: layout.fontSize.lg,
          fontWeight: '600',
          color: colour.text,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {description ? (
        <Text
          style={{
            fontSize: layout.fontSize.base,
            color: colour.textMuted,
            textAlign: 'center',
          }}
        >
          {description}
        </Text>
      ) : null}
      {action ? <RetryButton label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  /** The correlation identifier, so a rider can read it out over the phone. */
  reference?: string;
  onRetry?: () => void;
  style?: ViewStyle;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  reference,
  onRetry,
  style,
}: ErrorStateProps) {
  return (
    <View
      // See `LoadingState` above: without `accessible`, the alert role on a
      // `View` never reaches a screen reader.
      accessible
      accessibilityRole="alert"
      style={[
        {
          gap: layout.space[2],
          padding: layout.space[4],
          borderRadius: layout.radius.lg,
          borderWidth: 1,
          borderColor: colour.danger,
          backgroundColor: colour.surface,
        },
        style,
      ]}
    >
      <Text style={{ fontSize: layout.fontSize.base, fontWeight: '600', color: colour.text }}>
        {title}
      </Text>
      <Text style={{ fontSize: layout.fontSize.base, color: colour.text }}>{message}</Text>
      {reference ? (
        <Text style={{ fontSize: layout.fontSize.sm, color: colour.textMuted }}>
          Reference: {reference}
        </Text>
      ) : null}
      {onRetry ? <RetryButton label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

/**
 * A real control rather than an instruction to pull down.
 *
 * Sized to `minTapTarget`, which the token package sets at 44px because these
 * screens are used one-handed, outdoors, sometimes through a glove.
 */
function RetryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: layout.minTapTarget,
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: layout.space[4],
        borderRadius: layout.radius.md,
        borderWidth: 1,
        borderColor: colour.border,
        backgroundColor: pressed ? colour.brandSubtle : colour.surface,
      })}
    >
      <Text style={{ fontSize: layout.fontSize.base, fontWeight: '600', color: colour.text }}>
        {label}
      </Text>
    </Pressable>
  );
}
