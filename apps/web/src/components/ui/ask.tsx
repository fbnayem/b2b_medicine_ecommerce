import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfirmDialog } from './Dialog';
import { Field, Input, Textarea } from './Field';

/**
 * Asking the user something, without `window.confirm` or `window.prompt`.
 *
 * Those two were the product's only modal, twenty-two times across eleven
 * files, and they are worse than they look:
 *
 *   - `window.prompt` has no `type="password"`, so an **administrative password
 *     reset was typed in clear text** into a box that also offered no
 *     validation against the configured minimum length;
 *   - the browser dialog cannot be styled, cannot be translated, and appears
 *     detached from the page, which for a non-technical operator reads as the
 *     computer having done something rather than the application asking;
 *   - Playwright auto-dismisses them, so a test written against one *passes*
 *     while silently cancelling the action it claims to exercise.
 *
 * The promise-based shape is what makes replacing them mechanical rather than a
 * rewrite: `const reason = await ask.prompt({...})` sits exactly where
 * `window.prompt(...)` sat, and the call site keeps its shape.
 */

interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptRequest {
  kind: 'prompt';
  title: string;
  description?: ReactNode;
  label: string;
  hint?: ReactNode;
  confirmLabel: string;
  /** `password` never echoes, which is the whole point for a credential. */
  type?: 'text' | 'password' | 'number';
  multiline?: boolean;
  initialValue?: string;
  danger?: boolean;
  /** Returns a message to show, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
}

type Request = ConfirmRequest | PromptRequest;

interface AskApi {
  confirm(request: Omit<ConfirmRequest, 'kind'>): Promise<boolean>;
  /** Resolves to the value, or `null` when the user cancels. */
  prompt(request: Omit<PromptRequest, 'kind'>): Promise<string | null>;
}

const MISSING_PROVIDER =
  'Asking the user something needs <AskProvider>, which AppShell renders around every ' +
  'authenticated page. A test that exercises a dialog should render one too — see ' +
  'renderWithUi in src/testing/render.tsx.';

/**
 * The fallback throws when a dialog is *opened*, not when the hook is called.
 *
 * A page that merely has a confirmable action somewhere on it can then be
 * mounted on its own — which is how every component test in this project works
 * — while a test that actually reaches a dialog still fails, and says what to
 * do about it. Returning something that silently resolved would be worse than
 * either: the action would appear to be confirmed and nothing would happen.
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

export function AskProvider({ children }: { children: ReactNode }) {
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

  const isPrompt = request?.kind === 'prompt';

  return (
    <AskContext.Provider value={api}>
      {children}
      {request && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            // Closing by Escape, by the overlay, or by Cancel all mean the same
            // thing, and all of them must resolve the promise — an unresolved
            // one leaves the caller waiting forever with no visible cause.
            if (!open) settle(isPrompt ? null : false);
          }}
          title={request.title}
          description={request.description ?? ''}
          confirmLabel={request.confirmLabel}
          cancelLabel={request.kind === 'confirm' ? request.cancelLabel : undefined}
          tone={request.danger ? 'danger' : 'primary'}
          onConfirm={() => {
            if (!isPrompt) return settle(true);
            const trimmed = value.trim();
            const message = request.validate?.(trimmed) ?? null;
            if (message) return setError(message);
            settle(trimmed);
          }}
        >
          {isPrompt && (
            <Field label={request.label} hint={request.hint} error={error ?? undefined} required>
              {request.multiline ? (
                <Textarea
                  autoFocus
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError(null);
                  }}
                />
              ) : (
                <Input
                  autoFocus
                  type={request.type ?? 'text'}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const trimmed = value.trim();
                    const message = request.validate?.(trimmed) ?? null;
                    if (message) setError(message);
                    else settle(trimmed);
                  }}
                />
              )}
            </Field>
          )}
        </ConfirmDialog>
      )}
    </AskContext.Provider>
  );
}

/** A reason of at least `minimum` characters, which most of these ask for. */
export function requireReason(minimum = 5) {
  return (value: string) =>
    value.length < minimum
      ? `Please give a reason of at least ${minimum} characters, so the record explains itself later.`
      : null;
}
