# Database Design

## Core Entities

### User

`_id`, `email`, `passwordHash`, `firstName`, `lastName`, `role`, `status`, `lastLogin`, `createdAt`

### Shop

`_id`, `reference`, `name`, `ownerId` (ref User), `phones`, `emails`, `licenceNumber`, `licenceExpiry`, `creditLimit`, `managerId`, `status`

### Medicine

Human-readable reference; unique SKU and optional barcode; complete catalogue data; integer-minor-unit cost/selling prices; order limits; classification; cold-chain and active flags; creator and timestamps. Indexed for catalogue search.

Phase 42 added the supplier record: `popularity` (ordered / viewCount / ratingCount), `attributes`, `tags`, `shortDescription`, `fullName`, `sourceSlug`, `genericId`, `categoryIds`, `deliveryRestriction`, `listedElsewhere` and `hasSupplierPhoto`. All optional and absent on hand-entered rows. Only `popularity.ordered` and `tags` are indexed — the collection already carries 64 MB of index, so each field had to argue for one separately.

`listedElsewhere` holds the supplier's own stock snapshot, dated. It exists to take that job away from `isActive`, which previously meant "the supplier had stock on the day we scraped" and hid 24,188 products — 43% of the catalogue — from every shop owner. `isActive` now means whether _we_ sell the line.

### MedicineBatch

Medicine reference; per-medicine unique batch number; manufacturing/expiry dates; prices; received quantity; embedded stock-state quantities; warehouse location; block/quarantine flags; optimistic version; creator and timestamps. Indexed for FEFO.

### InventoryBalance

Phase 3 stores the balance atomically on each batch: `onHand`, `available`, `reserved`, `picking`, `packed`, `damaged`, `expired`, `returned`, and `quarantined`.

### StockMovement

Append-only medicine/batch movement containing type, signed quantity, full before/after balances, reason, business reference, actor/role, unique idempotency key, correlation ID and timestamp.

### Counter

Atomic per-prefix/per-year sequence for collision-safe visible references such as `MED-2026-000001`.

### Order

Public reference, shop/submitter, embedded medicine and price snapshots, delivery-address/contact snapshots, payment method, PO reference, notes, integer-minor-unit estimate fields, controlled status/history, submission idempotency key, cancellation request, submission timestamp and optimistic version. Indexed by shop/status/date.

### OrderItem

`_id`, `orderId`, `medicineId`, `quantityRequested`, `estimatedUnitPrice`

### OrderApproval

`_id`, `orderId`, `managerId`, `approvedAt`, `notes`

### PickingList & PickingItem

Unique `orderId` and `approvalId`; status (`PENDING`, `PICKING`, `PAUSED`, `PACKING`, `BLOCKED_DISCREPANCY`, `PACKED`); optimistic version; start/completion actor timestamps; allocated medicine/batch lines with allocated, picked, packed and shortfall quantities; embedded append-only discrepancy reports and management resolutions.

### Package & PackedItem

Unique human reference, order and invoice; package count; optional weight; packed actor/timestamp; handover status; unique barcode payload; notes and timestamps.

### Invoice

Unique reference and one invoice per order; version/status; immutable supplier, shop, order, billing and delivery snapshots; packed medicine/batch/expiry line snapshots; integer-minor-unit subtotal, discounts, delivery, tax, previous balance, paid, due and outstanding totals; payment terms; invoice/due/issue dates; authorised issuer and configurable footer. Issued documents reject mutation through the document model; later financial work must use adjustments or revisions.

### Delivery

Unique `DEL-YYYY-NNNNNN` reference and one-to-one order/package/invoice links; shop, immutable address/contact snapshots; controlled status, priority, assignee and expected date; configurable proof requirements; handover/acknowledgement, pickup/route/arrival timestamps; hashed expiring OTP data; receiver/OTP/signature/photo/GPS proof; integer-minor-unit collection snapshot; failure and return custody data; transition history; processed idempotency keys and optimistic version. Indexed for status/priority queues and assignee workload.

### ProofFile

Delivery and proof purpose; validated JPEG/PNG metadata, bounded two-megabyte binary content, SHA-256 digest and uploader. The database adapter is the functional local provider implementation and can be replaced behind `ProofFileStorage` for object storage.

### Payment

`_id`, `reference`, `shopId`, `invoiceId`, `amount`, `method`, `status`

### LedgerEntry

`_id`, `shopId`, `type` (DEBIT/CREDIT), `amount`, `referenceId`, `balanceAfter`

### AuditLog

`_id`, `actorId`, `action`, `entityType`, `entityId`, `timestamp`, `ip`

### Notification

Recipient, type, title/body, related entity, read timestamp and creation timestamp. Phase 4 creates in-app order-submission notifications through a replaceable provider interface.

### OrderApproval

Unique order decision with manager, approved line quantities, approved price/discount snapshots, FEFO batch allocations, order discount, delivery charge, totals, notes, reason and credit-override flag.

### PickingList

Unique per-order fulfilment work record created atomically at approval, containing allocated medicine/batch quantities and picking progress.

### Phase 6 transaction boundary

Starting picking atomically changes all allocated batches from `reserved` to `picking`. Packing atomically changes actual quantities from `picking` to `packed`, releases unused units to `available`, writes immutable StockMovements, creates Invoice and Package, updates order/list state, and writes audit/notification records. Unique order indexes prevent duplicate invoices and packages.

### Phase 7 transaction boundaries

Packing now creates the Delivery in the same transaction as Invoice, Package and `READY_FOR_DELIVERY`. Assignment, handover, pickup, route start, completion, failure and return actions transactionally coordinate Delivery, Order, Package custody, AuditLog and Notification data. Proof files are stored inside the completion transaction. Exact action-key replays are returned without repeating side effects.

## Phase 8 collections

- `payments`: unique human/payment/idempotency references, Shop and optional Invoice/Delivery links, positive safe-integer amount, method/source, collection/posting/custody state, allocation, proof link, receipt and reversal metadata. One Delivery can create at most one Payment.
- `paymentattachments`: immutable bounded JPEG/PNG/PDF bytes with content digest, MIME/content signature validation and uploader.
- `ledgertransactions`: append-only `LED` journal headers with balanced embedded debit/credit entries, source uniqueness, Shop dimensions, Invoice/Payment/Delivery links and signed customer-position delta.
- `creditreservations`: unique per Order; active/consumed/released approved exposure with immutable credit/override snapshot and lifecycle deltas. Migration repairs have explicit `MIGRATION_BACKFILL` provenance, original-approval metadata, and a unique request-bound idempotency key.
- `migrationruns`: rerunnable migration attempts, mode/status, statistics and bounded anomaly details.

Important indexes include unique Payment request keys, scoped method/transaction references, sparse Delivery and receipt references, unique Ledger source keys, Shop/date reporting indexes, unique CreditReservation Order links and sparse unique migration-backfill keys. `Shop.outstandingBalance` and `reservedCreditMinor` are rebuildable projections; reconciliation compares them with journal/reservation authority.

## Phase 9 collections

- `notifications`: expanded with `event`, `category`, `priority`, `link`, `metadata`, `archivedAt`, `correlationId` and a unique sparse `dedupeKey`. The legacy `type` field is retained and equals `event` for new records, so Phase 4-8 history stays readable.
- `notificationpreferences`: one document per user holding optional default channels, per-event channel overrides, muted events and Asia/Dhaka quiet hours. An absent document resolves to the catalogue defaults, so a user is notified without ever visiting the settings screen.
- `notificationdeliveries`: one row per recipient, channel and occurrence, with status, attempt count, provider reference, last error and suppression reason. The unique `idempotencyKey` makes a replayed dispatch a no-op and lets a queued job be resumed after a crash.
- `pushdevices`: Expo push tokens unique across users, with platform, device name, last-seen timestamp and a disable reason set when the provider reports `DeviceNotRegistered`.
- `activityevents`: append-only user-facing timeline with action, category, entity, denormalised `orderId`/`shopId` cross-links, actor snapshot, `visibleToRoles`, `visibleToShop` and a unique `dedupeKey`.

Indexes cover recipient/date, recipient/read-state, recipient/category, entity history, delivery status sweeps, and activity lookups by entity, order, shop, category and time. Notification and activity writes inside a business transaction use the caller's session, so a rolled-back transaction leaves no notification behind.

## Phase 10 collections

- `systemsettings`: one document per settings group (`business`, `finance`, `inventory`, `delivery`, `notifications`, `localisation`, `security`) with a unique immutable `group`, a mixed `values` object, an optimistic-concurrency `version` and the administrator who last saved it. A group with no document falls back to the environment and then to the built-in default, which is why an upgraded deployment keeps working before anyone opens the settings screen.
- `users`: gained an optional `phone` used by the SMS and WhatsApp notification channels.

A group is the unit an administrator edits, the unit that is audited and the unit that carries its own version, so two administrators editing unrelated groups never collide. Persisted values are merged field-wise over the fallback, so a settings document written before a schema change never hides a newly added field. Settings changes are audited against a deterministic entity id derived from the group name, which keeps the audit query surface identical to every other entity.

## Phase 11 collections

- `returns`: one customer return request. Carries the order, invoice and shop, the status and its history, and one line per returned invoice batch line. Each line keeps the invoiced quantity as a copied ceiling, the requested, approved and received quantities, the four disposition quantities (restocked, damaged, expired, quarantined), the unit price, the prorated discount and the calculated refund. Also holds the requested, approved and received totals, the reviewer, collector and receiver, an optimistic-concurrency `version`, the applied idempotency keys (hidden from responses) and the order status the request interrupted so a rejection can put the order back where it was. Indexed by shop, status and invoice.
- `creditnotes`: the issued credit document, one per return through a unique `returnId`, so a second credit cannot double-refund. Snapshots the supplier and customer identity at issue time, carries the credited lines and totals, and links the `LedgerTransaction` it posted. Immutable once written: correcting a credit note means posting a balancing adjustment, never editing the original.

`medicinebatches.quantities.returned` becomes live in this phase. A receipt books goods into `onHand` and `returned` together; the inspection then moves each unit out of `returned` into `available`, `damaged`, `expired` or `quarantined`. Returned stock is therefore never allocatable before somebody has looked at it. Damaged and expired units leave `onHand` exactly as the existing write-off movements do — they are physically present but permanently unsaleable.

`stockmovements` gains five types — `RETURN_RECEIPT`, `RETURN_RESTOCK`, `RETURN_DAMAGED`, `RETURN_EXPIRED` and `RETURN_QUARANTINED` — each keyed on the return and batch, so a replayed receipt is a no-op rather than a second booking.

No migration is required. The two new collections start empty, `quantities.returned` was already present and zero on every existing batch, and no existing document is rewritten.

## Phase 42 collections

- `cataloguesourcerecords`: one document per source product — the supplier's complete nested record (`raw`, or `rawText` when the bytes are not valid JSON), a `digest` over those bytes, and `aux` carrying the sibling rows the record does not contain (image metadata, SEO prose, FAQ, computed relations, category rows). Unique on `(source, sourceId)`. Created with **zstd block compression**; without it the 3.1 GB of raw JSON is not worth keeping, with it the archive costs a few hundred megabytes. Nothing in the application reads it: it exists so any mapping decision is reversible by migration instead of a re-scrape, and so "no information was lost" is checkable rather than asserted.
- `medicinecontents`: the supplier's long-form copy, **one document per (medicine, language)** rather than one per section. Row-per-section would be 1.38 M documents; the read is always "the whole monograph for one product in one language, in display order", which is one document. Sections carry `group`, `title`, `body` (uncapped), `position` and, on safety rows, `safety.type` and `safety.tag`. Unique on `(medicineId, lang)`, plus a text index over `sections.body` and `sections.title` so a pharmacist can search by what a drug treats rather than only by its name.
- `medicinerelations`: **restructured** from one row per relation to one document per `(fromId, kind)` holding an ordered `items` array. The row shape cost 457 MB of index to describe 188 MB of data, and the full 3.6 M supplier relations would have reached roughly 1.2 GB; as arrays it is ~224,000 documents under a single `{fromId, kind}` index. The old unique `(fromId, toId, kind)` index is retired — it existed only for import idempotency, which delete-then-insert per product now provides.

`MedicineRelationKind` gained `SAME_BRAND` and `PROMOTED`. `PROMOTED` is the supplier's bestseller carousel and must be labelled as advertising wherever it is shown; for prescription lines it returns unrelated products.

**A migration is required, and it is a reset.** The relation restructure changes document shape, so `pnpm --filter @medsupply/api reset:catalogue --apply` followed by a full import is the supported path — the unique `{fromId, kind}` index cannot build while old-shape rows are present.

## Phase 12 index and session changes

No new collection and no migration. Every change is an index or a field on an existing document, and nothing already stored is rewritten.

### Sessions

`sessions` gains `revokedReason` (`SIGNED_OUT`, `SIGNED_OUT_EVERYWHERE`, `REVOKED_BY_ADMIN`, `TOKEN_REUSE`, `ROLE_CHANGED`) and `lastUsedAt`, an index on `{ userId: 1, createdAt: -1 }` for listing and bulk revocation, and a TTL index on `expiresAt` with a one-day grace period. The grace matters: reuse detection has to be able to read a session shortly after it expires in order to recognise a replayed token rather than silently missing it.

`refreshTokenHash` now holds an `hmac:`-prefixed HMAC rather than a bcrypt hash. Rows written before this phase keep their bcrypt value and are verified with bcrypt until they rotate, so the change signs nobody out.

### Report coverage

Phase 11 recomputes every report from source records, and each of those aggregations began with a match that no index served. These were collection scans that grew with turnover:

- `invoices`: `{ status: 1, invoiceDate: 1 }`, `{ shopId: 1, status: 1, invoiceDate: 1 }`, `{ issuedAt: 1 }`
- `orders`: `{ createdAt: -1 }` for the funnel across every shop
- `deliveries`: `{ createdAt: -1 }`, `{ shopId: 1, createdAt: -1 }`
- `returns`: `{ requestedAt: -1 }`, `{ status: 1, completedAt: 1 }`, `{ shopId: 1, status: 1, completedAt: 1 }`
- `stockmovements`: `{ createdAt: -1 }`, `{ type: 1, createdAt: -1 }`
- `auditlogs`: `{ createdAt: -1 }`, `{ action: 1, createdAt: -1 }`, `{ actorId: 1, createdAt: -1 }` — the audit viewer pages newest-first through a collection that only ever grows
- `users`: `{ role: 1, status: 1 }`, `{ lastName: 1, firstName: 1 }`

An integration test asserts with `explain()` that the report and audit queries are served by an index rather than a `COLLSCAN`, so a future change that removes one fails the build rather than the dashboard.

### Applying them

Mongoose builds indexes in the background on first use, which is unsafe as a release step: on a collection with real volume the first request after a deployment can be the one that triggers a long build, and until it completes the query it was meant to serve runs as a scan. Make it explicit:

```bash
pnpm --filter @medsupply/api indexes              # report what is missing; exits non-zero if any are
pnpm --filter @medsupply/api indexes -- --apply   # create them
pnpm --filter @medsupply/api indexes -- --apply --prune   # also drop indexes the models no longer declare
```

Pruning is opt-in because an index this codebase does not know about may have been added deliberately by an operator.

### Aggregation time limit

Every model the reports aggregate over carries a `pre('aggregate')` guard that sets `maxTimeMS` from `DB_QUERY_TIMEOUT_MS` unless the caller set one. A limit in the API would only stop waiting for the operation; `maxTimeMS` makes the database abandon it, which is the only limit that actually frees the resource. A migration that genuinely needs longer sets its own value and is left alone.
