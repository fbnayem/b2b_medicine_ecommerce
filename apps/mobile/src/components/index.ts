/**
 * The mobile application's UI primitives.
 *
 * There were none. Thirty-six screens each wrote their own padding, borders,
 * headings, buttons and error text, which is why 34 of them carry raw hex
 * despite `theme.ts` re-exporting the design tokens correctly — the tokens
 * existed and there was nothing to put them in.
 *
 * The names deliberately match `apps/web/src/components/ui`. What is genuinely
 * shared between the two clients lives in `@medsupply/design-tokens` (the
 * values); these are the DOM-free half, and keeping the vocabulary identical is
 * what stops the two drifting into different ideas of what a `Card` is.
 */
export { EmptyState, ErrorState, LoadingState } from './Feedback';
export type { EmptyStateProps, ErrorStateProps } from './Feedback';
export { Card, CardLink, ListRow, Screen, SectionTitle } from './Layout';
export type { ListRowProps } from './Layout';
export { Button, Field, Input } from './Controls';
export type { ButtonProps, ButtonVariant, FieldProps, InputProps } from './Controls';
export { Badge, StatusPill, statusLabel } from './Status';
export type { BadgeTone, StatusKind } from './Status';
export { AskProvider, useAsk, requireReason } from './Ask';
export { Toaster, toast, resetToasts } from './Toast';
export type { ToastMessage, ToastTone } from './Toast';
