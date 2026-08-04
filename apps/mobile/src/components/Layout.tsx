import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { colour, layout } from '../theme';

/**
 * Screen scaffolding, so thirty-six screens stop inventing their own.
 *
 * Padding, gaps, card borders and heading sizes were retyped on every screen,
 * which is how 34 files ended up carrying raw hex — including both brand
 * greens the token package exists to collapse. These components resolve the
 * tokens once.
 *
 * Named to match `apps/web/src/components/ui`: a `Card` is a `Card` on both
 * clients, and somebody moving between them should not have to learn two
 * vocabularies for the same box.
 */

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  /** Off for a screen that owns a `FlatList`, which must scroll itself. */
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const content = (
    <View style={[{ padding: layout.space[4], gap: layout.space[3] }, style]}>{children}</View>
  );
  if (!scroll) {
    return <View style={{ flex: 1, backgroundColor: colour.canvas }}>{content}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.canvas }}
      contentContainerStyle={{ paddingBottom: layout.space[6] }}
      // A rider reading a delivery should not have the keyboard in the way.
      keyboardShouldPersistTaps="handled"
    >
      {content}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          backgroundColor: colour.surface,
          borderColor: colour.border,
          borderWidth: 1,
          borderRadius: layout.radius.lg,
          padding: layout.space[4],
          gap: layout.space[2],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text
      accessibilityRole="header"
      style={{ fontSize: layout.fontSize.lg, fontWeight: '600', color: colour.text }}
    >
      {children}
    </Text>
  );
}

export interface ListRowProps {
  label: string;
  value: ReactNode;
  /** Right-aligned with the label, for money and quantities. */
  numeric?: boolean;
}

/**
 * A labelled value.
 *
 * The mobile equivalent of the web table's stacked layout: a phone has no room
 * for a header row, so every value carries its own label. This is the shape the
 * `DataTable` collapses to on the web, deliberately, so the same record reads
 * the same way on both.
 */
export function ListRow({ label, value, numeric }: ListRowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: layout.space[4],
        paddingVertical: layout.space[1],
      }}
    >
      <Text style={{ fontSize: layout.fontSize.sm, color: colour.textMuted }}>{label}</Text>
      <Text
        style={{
          flexShrink: 1,
          fontSize: layout.fontSize.base,
          color: colour.text,
          textAlign: numeric ? 'right' : 'left',
          // React Native has no `tabular-nums` shorthand; this is the same
          // request and it is what lets a column of amounts be scanned.
          fontVariant: numeric ? ['tabular-nums'] : undefined,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * One number with its name, for the dashboards.
 *
 * Three screens each built their own — finance, analytics and account — with
 * different label sizes, different value weights and their own idea of what
 * "this one is bad" looks like. `tone` is the only variation that carries
 * meaning, and it is drawn from the same tokens as everything else.
 */
export function Metric({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string | number;
  tone?: 'normal' | 'warning';
}) {
  return (
    <View
      style={{
        width: '48%',
        minWidth: 145,
        flexGrow: 1,
        backgroundColor: colour.surface,
        borderColor: colour.border,
        borderWidth: 1,
        borderRadius: layout.radius.lg,
        padding: layout.space[4],
      }}
    >
      <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>{label}</Text>
      <Text
        style={{
          marginTop: layout.space[1],
          fontSize: layout.fontSize.xl,
          fontWeight: '700',
          color: tone === 'warning' ? colour.danger : colour.text,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/** A whole card that is pressable, for a list that leads somewhere. */
export function CardLink({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: layout.minTapTarget,
        backgroundColor: pressed ? colour.brandSubtle : colour.surface,
        borderColor: colour.border,
        borderWidth: 1,
        borderRadius: layout.radius.lg,
        padding: layout.space[4],
        gap: layout.space[2],
      })}
    >
      {children}
    </Pressable>
  );
}
