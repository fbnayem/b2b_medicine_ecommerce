import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { green, red, neutral } from '@medsupply/design-tokens';
import { colour, layout } from '../theme';

/**
 * "That worked" and "that did not", announced rather than only shown.
 *
 * Mobile said this four different ways: an `Alert.alert('Saved', …)` that
 * interrupts and must be dismissed, an inline green box, a red line of text,
 * and — most often — nothing at all. A rider who taps *Confirm delivery* and
 * sees the button return to normal cannot tell success from a dropped request.
 *
 * `accessibilityLiveRegion` is the point of this component rather than the
 * colour. TalkBack and VoiceOver announce a live region when its contents
 * change, so somebody who is not looking at the screen still learns that the
 * payment posted.
 *
 * The API is deliberately `toast.success(…)` / `toast.error(…)`, matching
 * `apps/web/src/components/ui/toast.tsx`, so a call site reads the same on both
 * clients. It is a module-level emitter rather than a hook for the same reason
 * it is on web: it has to be callable from a `catch` block, where a hook cannot
 * go.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  text: string;
}

type Listener = (message: ToastMessage) => void;

let nextId = 1;
const listeners = new Set<Listener>();

function emit(tone: ToastTone, text: string): void {
  const message: ToastMessage = { id: nextId++, tone, text };
  for (const listener of listeners) listener(message);
}

export const toast = {
  success: (text: string) => emit('success', text),
  error: (text: string) => emit('error', text),
  info: (text: string) => emit('info', text),
};

/** Intended for tests, which must not inherit another case's subscribers. */
export function resetToasts(): void {
  listeners.clear();
}

const TONE_COLOURS: Record<ToastTone, { background: string; text: string }> = {
  success: { background: green[700], text: colour.onBrand },
  error: { background: red[700], text: colour.onBrand },
  info: { background: neutral[800], text: colour.onBrand },
};

/** How long a message stays before it clears itself. */
const DWELL_MS = 4000;

/**
 * Rendered once, by the authenticated layout, above everything else.
 *
 * Anchored to the bottom because this is a one-handed application: the top of
 * a modern phone cannot be reached with a thumb, and a message that must be
 * dismissed by hand should be dismissible where the hand already is.
 */
export function Toaster() {
  const [message, setMessage] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const listener: Listener = (next) => setMessage(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), DWELL_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const tone = message ? TONE_COLOURS[message.tone] : null;

  return (
    <View
      // Present even when empty. A live region that is mounted only while it
      // has content is announced inconsistently, because the assistive
      // technology has nothing to observe until it is already too late.
      accessibilityLiveRegion="polite"
      testID="toaster"
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: layout.space[4],
        right: layout.space[4],
        bottom: layout.space[6],
      }}
    >
      {message && tone ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={message.text}
          onPress={() => setMessage(null)}
          style={{
            minHeight: layout.minTapTarget,
            justifyContent: 'center',
            backgroundColor: tone.background,
            borderRadius: layout.radius.md,
            paddingHorizontal: layout.space[4],
            paddingVertical: layout.space[3],
            shadowColor: neutral[900],
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}
        >
          <Text style={{ color: tone.text, fontSize: layout.fontSize.base, fontWeight: '600' }}>
            {message.text}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
