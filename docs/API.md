# MedSupply B2B API

## Naming & Conventions

- **Base URL**: `/api/v1`
- **Format**: JSON requests and responses
- **Pagination**: Query params `?page=1&limit=20`. Responses include `{ data: [...], meta: { total, page, limit, pages } }`
- **Error Responses**:
  ```json
  {
    "error": {
      "code": "VALIDATION_FAILED",
      "message": "Invalid input data",
      "details": [...]
    }
  }
  ```

## Core endpoints

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /users/me`
- `GET /shops`
- `POST /orders`

## Phase 3 Inventory endpoints

All endpoints require authentication. Catalogue reads allow Shop Owners, while batch and movement reads are internal. Cost prices are removed from Storekeeper and Shop Owner responses.

- `GET /inventory/medicines` — searchable, paginated catalogue with general availability.
- `POST /inventory/medicines` — create medicine (Super Admin, Admin, Manager).
- `GET /inventory/medicines/:id` and `PATCH /inventory/medicines/:id` — detail and management.
- `GET /inventory/batches` and `GET /inventory/batches/:id` — exact batch inventory and warning filters.
- `POST /inventory/batches/receive` — receive an initial medicine batch.
- `POST /inventory/batches/:id/operations` — controlled, idempotent stock transition.
- `POST /inventory/batches/:id/adjust` — reconcile on-hand stock without reducing below commitments.
- `PATCH /inventory/batches/:id/block` — block or unblock a batch with a reason.
- `POST /inventory/allocations/reserve` — atomic FEFO reservation across eligible batches.
- `GET /inventory/movements` — immutable, paginated movement ledger.

Operation types are `ADDITION`, `DAMAGE`, `EXPIRY`, `QUARANTINE`, `QUARANTINE_RELEASE`, `RESERVATION`, `RESERVATION_RELEASE`, `PICKING`, `PICKING_RETURN`, `PACKING`, and `PACKING_REVERSAL`.

## Phase 4 Order endpoints

- `GET /orders` and `GET /orders/:id` — role-filtered history and details; Shop Owners are isolated to their own shop.
- `POST /orders/drafts` — save a stock-neutral draft.
- `PATCH /orders/drafts/:id` and `DELETE /orders/drafts/:id` — modify/delete only while `DRAFT`.
- `POST /orders/submit` or `POST /orders/drafts/:id/submit` — validate shop/address/items, snapshot prices and submit idempotently.
- `POST /orders/:id/duplicate` — create a repriced draft from an earlier order.
- `POST /orders/:id/cancellation-request` — request cancellation in an eligible early state.

Submission accepts an `idempotencyKey`; its unique database constraint prevents duplicate orders from repeated taps or network retries. Cart and draft operations never reserve stock.

## Phase 5 approval endpoints

- `GET /approvals/queue` and `GET /approvals/:id` — manager queues and detailed shop, stock and history review context.
- `POST /approvals/:id/start` — optimistic `SUBMITTED -> UNDER_REVIEW` transition.
- `POST /approvals/:id/hold` and `POST /approvals/:id/reject` — reasoned, version-checked decisions.
- `POST /approvals/:id/approve` — full or partial approval with quantity, price, line/order discount and delivery-charge controls.

Approval reserves FEFO batches, creates the approval and picking list, and changes order state in one MongoDB transaction. A stale version or stock conflict rolls back the entire decision.

## Phase 6 fulfilment endpoints

- `GET /fulfilment/queue?status=PENDING|PICKING|PAUSED|PACKING|BLOCKED_DISCREPANCY|PACKED` - internal role queue.
- `GET /fulfilment/picking/:id` - allocated FEFO batches, progress, and discrepancies.
- `POST /fulfilment/picking/:id/start` - versioned Storekeeper action moving reserved stock to picking.
- `POST /fulfilment/picking/:id/progress` - Storekeeper batch/quantity confirmation with `SAVE`, `PAUSE`, or `COMPLETE` action.
- `POST /fulfilment/picking/:id/resume` - resume a paused list.
- `POST /fulfilment/picking/:id/discrepancies` - block work and notify management.
- `POST /fulfilment/picking/:id/discrepancies/resolve` - Manager/Admin resolution returning work to picking.
- `POST /fulfilment/picking/:id/pack` - confirm every picked batch, package metadata, and any required shortfall reasons.
- `GET /fulfilment/ready` - packages awaiting delivery handover.
- `GET /fulfilment/invoices/:id` - issued invoice; Shop Owners are isolated by shop ownership.
- `GET /fulfilment/invoices/:id/pdf?layout=a4|thermal` - authenticated on-demand immutable invoice rendering.

All write actions require the current picking-list `version`. Packing confirmation releases unused picking stock and issues one Invoice and Package from actual packed batch quantities in the same MongoDB transaction.

## Phase 7 delivery endpoints

- `GET /deliveries` - paginated delivery board; Delivery Persons see only their assignments and Shop Owners see only owned shops. Supports `status`, `priority`, `assignedTo`, and `q` filters.
- `GET /deliveries/personnel` - active Delivery Persons with current active-delivery counts (Manager/Admin).
- `GET /deliveries/order/:orderId` and `GET /deliveries/:id` - role- and record-filtered delivery details, timeline, invoice/package snapshots, failure and appropriate receiver proof.
- `GET /deliveries/proof/:fileId` - authenticated proof image stream with delivery record-level access checks.
- `POST /deliveries/:id/assign` - assign, pre-handover reassign, or reassign a physically returned package for another attempt.
- `POST /deliveries/:id/handover` - Storekeeper confirmation of the exact package, invoice and count.
- `POST /deliveries/:id/acknowledge` and `/pickup` - assigned Delivery Person custody acknowledgement and pickup.
- `POST /deliveries/:id/start` and `/arrived` - route start and arrival actions.
- `POST /deliveries/:id/send-otp` - generate a hashed, ten-minute receiver OTP; the local adapter sends it as an in-app Shop Owner notification.
- `POST /deliveries/:id/complete` - validate configured OTP/signature/photo/GPS proof, receiver, delivered count and collection snapshot, then complete or partially complete the order.
- `POST /deliveries/:id/fail`, `/returning`, and `/returned` - reasoned failure and two-sided return-to-store custody flow.
- `POST /deliveries/:id/cancel` - cancel an uncollected delivery (Manager/Admin).

Every delivery write requires `version` and an `idempotencyKey`. Exact key replays return the existing result. State, role, assignee, package count, proof and order side effects are enforced on the server; clients cannot write status fields directly.

## Phase 8 payment and finance endpoints

- `GET /payments` and `GET /payments/:id` - role/record-filtered Payment history and detail.
- `POST /payments` - record a pending manual Payment; supports Invoice/Delivery links, integer `amountMinor`, proof, explicit advance policy and a unique `idempotencyKey`.
- `POST /payments/:id/post` and `/fail` - Manager/Admin verification actions. Posting allocates the current Invoice due inside a transaction.
- `POST /payments/:id/reverse` - Admin/Super Admin full reversal with required reason; the original journal remains intact.
- `POST /payments/:id/handover` and `GET /payments/my-collections` - Delivery Person cash custody and own history.
- `GET /payments/:id/receipt?format=json|pdf` and `/attachment` - authenticated, record-scoped receipt/proof access.
- `GET /finance/my/summary`, `/my/invoices`, `/my/statement` - Shop Owner ledger-derived account views.
- `GET /finance/my/collections` - Delivery Person server-calculated Dhaka-day collection summary/history.
- `GET /finance/shops/:shopId/summary|invoices|ledger|statement` - internal customer account operations.
- `GET /finance/reports/summary|outstanding|overdue|collections` - management finance reports.
- `POST /finance/adjustments` - Admin/Super Admin opening/debit/credit/return journal action.
- `GET /finance/reconciliation/:shopId` and `POST /finance/reconciliation/:shopId/repair` - anomaly read and authorised Invoice-charge/projection repair.
- `POST /finance/credit-reservations/backfill` - Admin/Super Admin audited repair for an approved credit Order reported by the Phase 8 migration scan; requires a stable `idempotencyKey`, and changed replay intent is rejected.

Delivery completion additionally accepts `noPaymentCollected`, `collectedAmountMinor`, an eligible `collectionMethod`, optional `transactionReference`, and validated `paymentProof`. Its response metadata includes the created Payment reference/status. New settlement methods are `CASH`, `BANK_TRANSFER`, `MOBILE_FINANCIAL_SERVICE`, `CHEQUE`, `ADVANCE_BALANCE`, and `OTHER`; `CREDIT` remains an Order term.

## Phase 9 notification and activity endpoints

All notification reads and writes are scoped to the authenticated caller; one user can never read or mark another user's inbox.

- `GET /notifications` - paged inbox with `category`, `event`, `unreadOnly` and `includeArchived` filters.
- `GET /notifications/unread-count` - unread total plus a per-category breakdown, used for badges.
- `GET /notifications/catalogue` - closed event catalogue with each event's category, priority and default optional channels; the preferences screens render from this.
- `GET /notifications/preferences` and `PUT /notifications/preferences` - per-user default channels, per-event overrides, muted events and Asia/Dhaka quiet hours.
- `POST /notifications/read` - marks the listed notifications read.
- `POST /notifications/read-all` - bulk mark-read, optionally narrowed by `category` and bounded by `before` so notifications that arrived after the client rendered stay unread.
- `POST /notifications/archive` - archives and marks read; archived records are excluded from the default list.
- `POST /notifications/devices` and `DELETE /notifications/devices` - Expo push token registration and removal. A token registered by a second user moves to that user rather than fanning out to both.
- `GET /notifications/:id/deliveries` - Admin/Super Admin per-channel attempt rows (status, attempts, provider reference, suppression reason).
- `POST /notifications/test` - Admin/Super Admin channel check that emits a real notification through the normal pipeline.
- `GET /activity/timeline?entityType=&entityId=` - permission-filtered history for one record. An `Order` timeline also absorbs its delivery, invoice and payment events; a `Shop` timeline absorbs everything carrying that `shopId`.
- `GET /activity` - organisation-wide feed with `category`, `shopId` and `from`/`to` filters, filtered per record by the viewer's role.

### Real-time channel

Socket.IO is served at path `/realtime` on the API origin. The access token is supplied through the handshake `auth.token` payload, not the query string. On connection the server joins the socket to `user:<id>`, `role:<ROLE>` and, for Shop Owners, `shop:<id>` for each owned shop.

Server events: `realtime:connected`, `notification:created`, `notification:updated`, `notification:unread-count`, `order:updated`, `approval:updated`, `fulfilment:updated`, `delivery:updated`, `payment:updated`, `inventory:updated` and `activity:created`. Entity updates share one payload shape (`entityType`, `entityId`, `reference`, `status`, `orderId`, `shopId`, `at`) so a client can invalidate its cache without per-domain parsing.

## Phase 10 settings and administration endpoints

- `GET /settings/branding` - name, logo, locale, date format, currency and time zone for any signed-in role. Carries no finance, credit or security policy.
- `GET /settings` - Admin/Super Admin view of the effective values, the per-group source (`PERSISTED`, `ENVIRONMENT`, `DEFAULT`), the per-group version, the group descriptions and the fallback each group would revert to.
- `PUT /settings/:group` - replaces one group in full. Requires the `version` from the last read; a stale version returns `409 STALE_SETTINGS` rather than overwriting a concurrent change. Groups are `business`, `finance`, `inventory`, `delivery`, `notifications`, `localisation` and `security`.
- `POST /settings/:group/reset` - removes the persisted override with a required reason, so the group falls back to the environment and then to the built-in default. The previous values are preserved in the audit record.
- `GET /admin/users` - paged directory with `role`, `status` and `q` (name or email) filters. Password hashes are never returned and the search term is escaped, so a regular-expression metacharacter is matched literally.
- `GET /admin/users/:id` - one account plus its active session count.
- `PATCH /admin/users/:id` - name, phone, role or status. A role change or a non-active status revokes that user's sessions in the same operation.
- `POST /admin/users/:id/reset-password` - sets a temporary password, forces a change at next sign-in, clears any lockout and signs out every session. The password itself is never audited; only that a reset happened and the supplied reason.
- `POST /admin/users/:id/revoke-sessions` - signs out every active session with a required reason.
- `GET /admin/audit` - paged, filterable audit log (`action`, `entityType`, `entityId`, `actorId`, `from`, `to`). Read-only: the log has no write endpoint.
- `GET /admin/audit/actions` - distinct action names for the viewer's filter.

Sign-in now writes `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `LOGIN_LOCKED` and `LOGIN_BLOCKED` audit records, and the lockout threshold and duration come from the security settings group. `POST /users` enforces the configured minimum password length, applies the configured force-password-change policy, writes a `USER_CREATED` audit record and refuses to create a privileged account unless the caller is a Super Admin.

The Socket.IO channel gains `settings:updated`, carrying the changed group so clients holding branding or formatting values refetch them.

## Phase 11 returns endpoints

- `GET /returns` - paged list with `status`, `shopId`, `reason`, `q` (reference) and date filters. A Shop Owner is narrowed to the shops they own; the reference search term is escaped so a regular-expression metacharacter is matched literally.
- `POST /returns` - creates a return request against an issued invoice. Requires `invoiceId`, a `primaryReason`, at least one line of `medicineId`, `batchId`, `quantity` and `reason`, and an `idempotencyKey`. Rejects a line that is not on the invoice (`LINE_NOT_ON_INVOICE`) and a quantity beyond what the invoice has left (`RETURN_EXCEEDS_INVOICE`). Replaying the key returns the original request with `200`.
- `GET /returns/:id` - one return with its lines, invoice, order, credit note and progress timestamps. Internal review notes are stripped for a Shop Owner.
- `POST /returns/:id/review` - claims the request for one reviewer, moving it to `UNDER_REVIEW`.
- `POST /returns/:id/decision` - records an approved quantity for every requested line. Approving everything gives `APPROVED`, less gives `PARTIALLY_APPROVED`, and approving nothing is recorded as `REJECTED` rather than left as a zero-value return.
- `POST /returns/:id/reject` - rejects with a required reason and releases the order.
- `POST /returns/:id/cancel` - withdraws the request with a required reason. Available to the requesting shop and to management.
- `POST /returns/:id/collect` - records that the goods were collected from the shop.
- `POST /returns/:id/receive` - books the goods in and dispositions each unit as restocked, damaged, expired or quarantined. Refuses more units than were approved (`RECEIPT_EXCEEDS_APPROVAL`) and refuses to restock an expired batch (`EXPIRED_BATCH_RESTOCK`). The credit is recalculated from what actually arrived.
- `POST /returns/:id/credit-note` - issues the credit note, posts `RETURN_CREDIT` to the ledger and closes the return. Refuses a credit that would take total credits past the invoice value (`CREDIT_EXCEEDS_INVOICE`).
- `GET /returns/credit-notes/:id` - one issued credit note; `?format=pdf` renders a printable document.

Every lifecycle action takes the `version` from the last read plus an `idempotencyKey`. A stale version returns `409 STALE_RETURN`; a replayed key returns `200` with `meta.idempotentReplay` set, so a retried request after a dropped response never applies twice. The Socket.IO channel gains `return:updated`.

## Phase 11 reporting endpoints

- `GET /reports/overview` - the management dashboard: sales totals and series, the order funnel with cycle times, delivery performance, returns, receivables ageing, inventory value and the top medicines and customers.
- `GET /reports/sales` - invoiced value, discount, tax, returned value and net after returns, bucketed by `granularity` (`DAY`, `WEEK`, `MONTH`).
- `GET /reports/sales/breakdown` - the same period grouped by `dimension`: `MEDICINE`, `CATEGORY`, `MANUFACTURER`, `SHOP` or `TERRITORY`.
- `GET /reports/orders` - status counts, the submitted/approved/invoiced/delivered funnel, conversion in basis points and average cycle times.
- `GET /reports/inventory` - valuation at cost and retail, valuation by category, expiry buckets, low stock against the configured threshold and dead stock (`deadStockDays`, default 90).
- `GET /reports/deliveries` - success and punctuality rates, failure reasons and per-delivery-person performance including amounts collected.
- `GET /reports/returns` - return rate against sales, reasons, statuses, most-returned medicines and units recovered against units written off.
- `GET /reports/receivables-ageing` - open invoice balances bucketed as not-yet-due, 1-30, 31-60, 61-90 and over 90 days past due, per customer and in total.
- `GET /reports/stock-movements` - movement counts and quantities by type for the period.

Ranged reports take `from` and `to` as `YYYY-MM-DD` plus an optional `granularity` and `shopId`, and default to the current month. Buckets follow the Asia/Dhaka business calendar, the same boundary the ledger uses, so a report and the statement it summarises agree on which day a transaction belongs to. Passing `format=csv` returns a UTF-8 CSV with a byte order mark; any value that begins with `=`, `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet cannot execute it as a formula. A Shop Owner calling a report they are permitted to read is narrowed to their own shop rather than refused.

## Phase 12 platform endpoints

- `GET /health` - liveness. Answers while the process is running, regardless of whether the database is reachable, so a transient database fault does not get the container restarted.
- `GET /health/ready` - readiness. Pings the database and returns `503` when it cannot be reached, so an orchestrator removes the instance from the load balancer instead of collecting errors.
- `GET /health/version` - the deployed version, commit, environment and uptime.
- `GET /api/v1/docs` - a self-contained API reference rendered from the specification below.
- `GET /api/v1/docs/openapi.json` - the OpenAPI 3.1 document, generated from the same Zod schemas the server validates with, so a documented request body is the one that is actually enforced. `pnpm --filter @medsupply/api openapi` writes it to a file for review or client generation.
- `GET /api/v1/auth/sessions` - the signed-in user's own sessions: device, address, when it started, when it was last used and whether it is the current one. No token or hash is returned.
- `DELETE /api/v1/auth/sessions/:id` - ends one of the signed-in user's own sessions. Somebody else's identifier returns `404`, not `403`, so it reveals nothing. Revocation takes effect on the next request rather than at token expiry.
- `POST /api/v1/auth/logout-all` - ends every session for the signed-in user and reports how many were closed.
- `GET /api/v1/admin/runtime` - Admin and Super Admin only. The effective security and performance configuration: version, database pool and query timeout, realtime and queue drivers, rate-limit tiers, token lifetimes, trusted proxy hops and body limits. It reports whether a control is set, never its value, and contains no secret.

### Conventions that changed in Phase 12

- Every failure response carries `error.correlationId`, matching the `x-request-id` response header and the server log line. Quote it when reporting a problem.
- A caller may supply its own `x-request-id` to join its traces to the server's; it is honoured when it matches `[\w-]{8,64}` and replaced otherwise.
- `429 RATE_LIMITED` responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `Retry-After`. Budgets are per tier: sign-in, writes, reports and a global backstop.
- A body over the endpoint's limit returns `413 PAYLOAD_TOO_LARGE`; unparseable JSON returns `400 MALFORMED_JSON`; an unknown route returns `404 NOT_FOUND` in the same envelope as everything else.
- In production, unexpected failures return a fixed message and the correlation identifier rather than the exception text.
- Validation failures return the offending paths, codes and messages, never the submitted values.
