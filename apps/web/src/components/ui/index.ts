/**
 * The web application's UI primitives.
 *
 * Not a package, deliberately: mobile cannot import DOM components, so a
 * package would buy nothing but another node in a build graph that has already
 * broken this project once. What *is* shared with mobile lives in
 * `@medsupply/design-tokens` — the values — and in `@medsupply/navigation` —
 * the policy.
 */
export {
  Button,
  LinkButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type LinkButtonProps,
} from './Button';
export { Field, Input, Select, Textarea, type FieldProps } from './Field';
export { HelpTip, type HelpTipProps } from './HelpTip';
export {
  EmptyState,
  ErrorState,
  FormNotice,
  LoadingState,
  Skeleton,
  type EmptyStateProps,
  type ErrorStateProps,
  type FormNoticeProps,
  type FormProblem,
} from './Feedback';
export { ConfirmDialog, Dialog, type ConfirmDialogProps, type DialogProps } from './Dialog';
export {
  Badge,
  Card,
  FilterTabs,
  PageHeader,
  Pagination,
  Stat,
  StatGrid,
  Table,
  Td,
  Th,
  type BadgeTone,
  type PageHeaderProps,
  type StatProps,
} from './Data';
export { DataTable, type Column, type DataTableProps } from './DataTable';
export { ListToolbar, type ListToolbarProps } from './ListToolbar';
export { TableLink } from './TableLink';
export { ProductImage, type ProductImageProps } from './ProductImage';
export { Resource, type ResourceProps } from './Resource';
export { StatusPill, statusLabel, type StatusKind } from './StatusPill';
export { toast, Toaster } from './toast';
export { AskProvider, requireReason, useAsk } from './ask';
