/**
 * The web application's UI primitives.
 *
 * Not a package, deliberately: mobile cannot import DOM components, so a
 * package would buy nothing but another node in a build graph that has already
 * broken this project once. What *is* shared with mobile lives in
 * `@medsupply/design-tokens` — the values — and in `@medsupply/navigation` —
 * the policy.
 */
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Field, Input, Select, Textarea, type FieldProps } from './Field';
export {
  EmptyState,
  ErrorState,
  LoadingState,
  Skeleton,
  type EmptyStateProps,
  type ErrorStateProps,
} from './Feedback';
export { ConfirmDialog, Dialog, type ConfirmDialogProps, type DialogProps } from './Dialog';
export {
  Badge,
  Card,
  FilterTabs,
  PageHeader,
  Pagination,
  Table,
  Td,
  Th,
  type BadgeTone,
  type PageHeaderProps,
} from './Data';
export { StatusPill, statusLabel, type StatusKind } from './StatusPill';
export { toast, Toaster } from './toast';
