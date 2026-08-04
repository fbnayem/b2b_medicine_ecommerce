import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { colour, layout } from '../theme';
import { Button, Field, Input } from './Controls';
import { useLanguage } from '../i18n/useLanguage';

/**
 * Asking the person using the app something, without `Alert.alert`.
 *
 * Nine `Alert.alert` calls stood in for every dialog on this client, and five
 * of them guarded money or stock: posting a collection to the customer ledger,
 * issuing a credit note, confirming a cash handover, cancelling a return,
 * signing sessions out. `Alert` is worse than it looks for those:
 *
 *   - it renders **outside React**, so it cannot be translated by the provider
 *     around the tree, cannot be styled, and reads to a non-technical operator
 *     as the phone having done something rather than the application asking;
 *   - it **cannot take text**, so the actions that ought to record *why* —
 *     which the web client now requires, and which the audit record exists to
 *     answer — could only ever be a yes or a no here;
 *   - it is invisible to a render test, so a test can pass while the action it
 *     claims to exercise never happens. That is the same defect the web client
 *     shipped with `window.confirm`, found in phase 21 on the sign-out control.
 *
 * The promise-based shape is deliberately identical to
 * `apps/web/src/components/ui/ask.tsx`, so `await ask.confirm({...})` sits
 * exactly where `Alert.alert(...)` sat and the call site keeps its shape.
 */

interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptRequest {
  kind: 'prompt';
  title: string;
  description?: string;
  label: string;
  hint?: string;
  confirmLabel: string;
  multiline?: boolean;
  initialValue?: string;
  danger?: boolean;
  /** Returns a message to show, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
}

type Request = ConfirmRequest | PromptRequest;

interface AskApi {
  confirm(request: Omit<ConfirmRequest, 'kind'>): Promise<boolean>;
  /** Resolves to the value, or `null` when the person cancels. */
  prompt(request: Omit<PromptRequest, 'kind'>): Promise<string | null>;
}

const MISSING_PROVIDER =
  'Asking something needs <AskProvider>, which app/(protected)/_layout.tsx renders around ' +
  'every authenticated screen. A render test that reaches a dialog should render one too.';

/**
 * The fallback rejects when a dialog is *opened*, not when the hook is called.
 *
 * A screen that merely has a confirmable action on it can then be mounted on
 * its own, while a test that actually reaches a dialog fails and says what to
 * do. Silently resolving would be worse than either: the action would appear
 * confirmed and nothing would happen.
 */
const NO_PROVIDER: AskApi = {
  confirm() {
    return Promise.reject(new Error(MISSING_PROVIDER));
  },
  prompt() {
    return Promise.reject(new Error(MISSING_PROVIDER));
  },
};

const AskContext = createContext<AskApi | null>(null);

export function useAsk(): AskApi {
  return useContext(AskContext) ?? NO_PROVIDER;
}

/**
 * A reason long enough to mean something, for the actions that record one.
 *
 * Takes the translator, same signature as the web client's, so the sentence is
 * read in the language the rest of the dialog is in.
 */
export function requireReason(
  t: (path: string, values?: Record<string, string | number>) => string,
  minimum = 5,
) {
  return (value: string) =>
    value.trim().length < minimum ? t('actions.reasonTooShort', { minimum }) : null;
}

export function AskProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((answer: boolean | string | null) => void) | null>(null);

  const settle = useCallback((answer: boolean | string | null) => {
    resolver.current?.(answer);
    resolver.current = null;
    setRequest(null);
    setValue('');
    setError(null);
  }, []);

  const api = useMemo<AskApi>(
    () => ({
      confirm(next) {
        return new Promise<boolean>((resolve) => {
          resolver.current = (answer) => resolve(answer === true);
          setRequest({ ...next, kind: 'confirm' });
        });
      },
      prompt(next) {
        return new Promise<string | null>((resolve) => {
          resolver.current = (answer) => resolve(typeof answer === 'string' ? answer : null);
          setValue(next.initialValue ?? '');
          setRequest({ ...next, kind: 'prompt' });
        });
      },
    }),
    [],
  );

  function submit() {
    if (!request) return;
    if (request.kind === 'confirm') {
      settle(true);
      return;
    }
    const message = request.validate?.(value) ?? null;
    if (message) {
      setError(message);
      return;
    }
    settle(value);
  }

  const isPrompt = request?.kind === 'prompt';

  return (
    <AskContext.Provider value={api}>
      {children}
      <Modal
        visible={request !== null}
        transparent
        animationType="fade"
        // Android's hardware back button is this platform's Escape, and a
        // dialog that ignores it traps the person inside it.
        onRequestClose={() => settle(isPrompt ? null : false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0,0,0,0.45)',
          }}
        >
          {request ? (
            <View
              /*
               * `accessibilityViewIsModal` and not `accessible`: marking the
               * container accessible would collapse the text input inside it
               * into one node, so the field would stop being reachable. The
               * modal trait is what keeps focus inside the sheet.
               */
              accessibilityViewIsModal
              style={{
                backgroundColor: colour.surface,
                borderTopLeftRadius: layout.radius.xl,
                borderTopRightRadius: layout.radius.xl,
                padding: layout.space[5],
                gap: layout.space[3],
              }}
            >
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text
                  accessibilityRole="header"
                  style={{
                    fontSize: layout.fontSize.lg,
                    fontWeight: '600',
                    color: colour.text,
                  }}
                >
                  {request.title}
                </Text>
                {request.description ? (
                  <Text
                    style={{
                      marginTop: layout.space[2],
                      fontSize: layout.fontSize.base,
                      color: colour.textMuted,
                    }}
                  >
                    {request.description}
                  </Text>
                ) : null}

                {request.kind === 'prompt' ? (
                  <Field
                    label={request.label}
                    hint={request.hint}
                    error={error ?? undefined}
                    style={{ marginTop: layout.space[3] }}
                  >
                    <Input
                      label={request.label}
                      value={value}
                      invalid={Boolean(error)}
                      multiline={request.multiline}
                      autoFocus
                      onChangeText={(next) => {
                        setValue(next);
                        // Clear as they type: an error that stays put while the
                        // text changes reads as the app not listening.
                        if (error) setError(null);
                      }}
                      style={
                        request.multiline
                          ? { minHeight: layout.space[10], paddingTop: layout.space[3] }
                          : undefined
                      }
                    />
                  </Field>
                ) : null}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: layout.space[2] }}>
                <Button
                  variant="secondary"
                  style={{ flex: 1 }}
                  label={
                    (request.kind === 'confirm' ? request.cancelLabel : undefined) ??
                    t('common.cancel')
                  }
                  onPress={() => settle(isPrompt ? null : false)}
                />
                <Button
                  variant={request.danger ? 'danger' : 'primary'}
                  style={{ flex: 1 }}
                  label={request.confirmLabel}
                  onPress={submit}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </AskContext.Provider>
  );
}
