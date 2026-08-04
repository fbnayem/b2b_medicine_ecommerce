/**
 * The burn-down lists for `uiDiscipline.test.ts`.
 *
 * Phase 3 built a design system, a token package and a translation catalogue,
 * and the page bodies adopted almost none of it: no page used the table
 * primitive, none called `toast()`, three rendered `PageHeader` and none called
 * the translation function. That did not happen because anybody decided
 * against it. It happened because **nothing failed when a page skipped it** —
 * the same reason `POST /api/v1/users` shipped a role bug through twelve
 * phases with no test calling it.
 *
 * So these lists work exactly like `routeCoverage.waivers.ts`:
 *
 *   - Every entry is a page shipping without the guarantee, named individually.
 *     A percentage would hide *which* pages, and which page it is has been the
 *     deciding detail every time in this repository.
 *   - Adding an entry is a deliberate act, reviewed like any other change. The
 *     forty-fourth page cannot quietly join the old world.
 *   - Removing one is forced: the moment a page complies, the test fails on the
 *     stale waiver until it is struck off. **The lists can only shrink.**
 *
 * At the time of writing: 43 pages, of which 36 import the legacy stylesheet,
 * 20 build a raw table, 29 hand-roll a loading string, 40 render no page
 * header, and 43 are untranslated.
 */

/** Still importing the 1,104-line legacy stylesheet. Deleted when this empties. */
export const LEGACY_STYLESHEET: readonly string[] = [
  'ActivityFeed.tsx',
  'AnalyticsDashboard.tsx',
  'AnalyticsReports.tsx',
  'ApprovalQueue.tsx',
  'ApprovalReview.tsx',
  'AuditLogViewer.tsx',
  'CollectionReview.tsx',
  'CustomerLedger.tsx',
  'DeliveryBoard.tsx',
  'DeliveryDetail.tsx',
  'FinancialReports.tsx',
  'FulfilmentQueue.tsx',
  'FulfilmentWork.tsx',
  'InventoryDashboard.tsx',
  'MedicineForm.tsx',
  'PaymentDetail.tsx',
  'PaymentList.tsx',
  'RecordPayment.tsx',
  'SecurityCentre.tsx',
  'ShopDetail.tsx',
  'SystemSettings.tsx',
  'Unauthorized.tsx',
  'UserAdministration.tsx',
];

/**
 * Building a table by hand.
 *
 * `inventory.css` styles those cells `text-align: left; white-space: nowrap`,
 * so money columns are ragged and the table cannot reflow — on a phone it is a
 * strip to be dragged sideways, and delivery riders read these on phones.
 * `DataTable` stacks each row into a labelled block instead.
 */
export const RAW_TABLE: readonly string[] = [
  'AnalyticsReports.tsx',
  'ApprovalQueue.tsx',
  'ApprovalReview.tsx',
  'CollectionReview.tsx',
  'CustomerLedger.tsx',
  'FinancialReports.tsx',
  'FulfilmentWork.tsx',
  'InventoryDashboard.tsx',
  'PaymentList.tsx',
  'SecurityCentre.tsx',
  'ShopList.tsx',
];

/**
 * Hand-rolling a wait.
 *
 * Around twenty different phrasings of the same pause, none announced to a
 * screen reader, and a failure that offers no way to try again. `Resource`
 * renders all three states from one place.
 */
export const HAND_ROLLED_STATE: readonly string[] = [
  'ActivityFeed.tsx',
  'AnalyticsDashboard.tsx',
  'AnalyticsReports.tsx',
  'ApprovalQueue.tsx',
  // `{error || 'Loading review...'}` — the failure and the wait rendered
  // through one expression, so neither can be told from the other.
  'ApprovalReview.tsx',
  'AuditLogViewer.tsx',
  'CollectionReview.tsx',
  'CustomerLedger.tsx',
  'DeliveryBoard.tsx',
  'DeliveryDetail.tsx',
  'FinancialReports.tsx',
  'FulfilmentQueue.tsx',
  'FulfilmentWork.tsx',
  'InventoryDashboard.tsx',
  'PaymentDetail.tsx',
  'PaymentList.tsx',
  'RecordPayment.tsx',
  'SecurityCentre.tsx',
  'SystemSettings.tsx',
  'UserAdministration.tsx',
];

/**
 * Rendering no `PageHeader`, so no `data-test="page-<routeId>"`.
 *
 * `docs/TESTING.md` froze that contract and `PageHeader` emits it by
 * construction — but only three pages render one, so the browser specs fall
 * back to `getByRole` and are more brittle than the document describes.
 */
export const NO_PAGE_HEADER: readonly string[] = [
  'ActivityFeed.tsx',
  'AnalyticsDashboard.tsx',
  'AnalyticsReports.tsx',
  'ApprovalQueue.tsx',
  'ApprovalReview.tsx',
  'AuditLogViewer.tsx',
  'CollectionReview.tsx',
  'CustomerLedger.tsx',
  'DeliveryBoard.tsx',
  'DeliveryDetail.tsx',
  'FinancialReports.tsx',
  'FulfilmentQueue.tsx',
  'FulfilmentWork.tsx',
  'InventoryDashboard.tsx',
  'Login.tsx',
  'MedicineForm.tsx',
  'NotFound.tsx',
  'PaymentDetail.tsx',
  'PaymentList.tsx',
  'RecordPayment.tsx',
  'SecurityCentre.tsx',
  'ShopDetail.tsx',
  'ShopForm.tsx',
  'ShopList.tsx',
  'SystemSettings.tsx',
  'Unauthorized.tsx',
  'UserAdministration.tsx',
];

/**
 * Not wired to the catalogue at all.
 *
 * **This is a wiring gate, not a completeness one**, and saying so matters: it
 * proves a page reads the catalogue, not that every string in it does. A regex
 * cannot tell a user-facing sentence from a `className`, and a gate that
 * pretends otherwise would be trusted for a guarantee it does not give. What it
 * does catch is the state the whole application is in today — 43 pages that
 * never call `t()` at all, behind a language switch that changes the frame and
 * nothing inside it.
 */
export const UNTRANSLATED: readonly string[] = [
  'ActivityFeed.tsx',
  'AnalyticsDashboard.tsx',
  'AnalyticsReports.tsx',
  'ApprovalQueue.tsx',
  'ApprovalReview.tsx',
  'AuditLogViewer.tsx',
  'ChangePassword.tsx',
  'CollectionReview.tsx',
  'CustomerLedger.tsx',
  'Dashboard.tsx',
  'DeliveryBoard.tsx',
  'DeliveryDetail.tsx',
  'FinancialReports.tsx',
  'FulfilmentQueue.tsx',
  'FulfilmentWork.tsx',
  'InventoryDashboard.tsx',
  'Login.tsx',
  'MedicineForm.tsx',
  'NotFound.tsx',
  'PaymentDetail.tsx',
  'PaymentList.tsx',
  'ReadyQueue.tsx',
  'RecordPayment.tsx',
  'SecurityCentre.tsx',
  'ShopDetail.tsx',
  'ShopForm.tsx',
  'ShopList.tsx',
  'SystemSettings.tsx',
  'Unauthorized.tsx',
  'UserAdministration.tsx',
];
