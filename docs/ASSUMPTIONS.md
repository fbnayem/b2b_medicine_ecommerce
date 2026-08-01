# Assumptions

- Real-time updates via Socket.IO will use standard authorization patterns (passing JWT token).
- Currency is strictly BDT, stored as integer minor units (poisha).
- Deliveries are internally handled by the system's own delivery persons, not third-party couriers.
- A single mobile app will serve all roles via Expo Router role-based navigation.
- The `packages/` monorepo configuration will heavily rely on simple TypeScript exports mapped via `package.json` `main` and `types`.
- Phase 3 uses a 90-day near-expiry threshold until the configurable settings module is delivered in Phase 10; API callers may supply a bounded override for operational views.
- A batch number is unique within a medicine, because manufacturers may reuse the same batch identifier across unrelated products.
- General availability shown to Shop Owners is deliberately qualitative; exact batch quantities, warehouse locations, and all cost prices remain internal.
- MongoDB must run as a replica set in every environment where stock-changing transactions are used; local Docker Compose initializes a single-node `rs0` replica set.
- Stock quantities are whole saleable units. Fractional inventory is not supported.
- Phase 4 estimates use each shop's existing percentage discount and a zero delivery charge until configurable pricing settings are introduced; all calculations use integer minor units.
- A Shop Owner belongs to one ordering shop in the current modular-monolith scope.
- Cancellation requests do not directly change order status; a manager action in Phase 5 decides whether the order becomes `CANCELLED`.
- Phase 6 treats the FEFO batches reserved at approval as the allowed batch selections. Storekeepers confirm those exact batches; changing allocation requires a discrepancy and management resolution rather than an untracked substitution.
- Starting picking moves the complete approved allocation into the `picking` stock state. If confirmed/packed quantity is lower, packing releases the full unused allocation to `available` with a `PICKING_RETURN` movement.
- At least one unit must be packed before an invoice/package can be issued. An entirely unavailable order remains blocked for management action.
- Invoice tax defaults to zero basis points until configured through `INVOICE_TAX_BASIS_POINTS`; Phase 10 will move business identity, footer, and tax configuration into persisted System Settings.
- Business identity uses environment-backed settings during Phase 6 so invoices are functional without waiting for Phase 10. Missing optional address/phone/email/footer values render as blank rather than hard-coded business data.
- A single issued invoice and package are allowed per order in Phase 6. Corrections must use the later revision/cancellation/adjustment process and never silently mutate the issued snapshot.
- Medicine product barcodes are used by the mobile camera flow; the exact allocated batch database identifier is the manual fallback until batch-specific printable barcode values are added to receiving.
- Integration tests may use an isolated in-process MongoDB replica set when Docker is unavailable. This preserves real transaction/concurrency semantics rather than replacing MongoDB with mocks.
- Phase 7 proof requirements are configured with `DELIVERY_REQUIRED_PROOFS`; the safe local default is `OTP`. Supported comma-separated values are `OTP`, `SIGNATURE`, `PHOTOGRAPH`, and `GPS`, and each configured item is mandatory at completion.
- The local OTP adapter sends a random six-digit, ten-minute code to the Shop Owner's in-app notifications and stores only a salted application digest. SMS/WhatsApp can replace this provider without changing delivery business logic.
- Proof images use a bounded, magic-byte-validated database storage adapter for local development. Production object storage will replace the provider; SVG and arbitrary file types are intentionally rejected.
- A delivery may be reassigned before handover. After physical handover it must be failed and returned to Storekeeper custody before a Manager can reassign it for a safe second attempt.
- Phase 7 records delivery collections as `PENDING_POSTING` snapshots only. It does not claim a posted financial result; Phase 8 will create Payment and balanced Ledger entries and reconcile the invoice/shop balance.
- Assigned deliveries and non-financial status actions are persisted in app-scoped AsyncStorage without credentials. Proof images and financial completion payloads are never placed in unencrypted offline storage; the proof screen retains them only in memory and retries one stable idempotency key after reconnection. The UI never displays completion as server-confirmed until the API succeeds.
- The web delivery board refreshes silently every 15 seconds and also exposes manual retry. Socket transport can replace this polling boundary without changing server state rules.

## Phase 8

- Because the supported roles do not include Finance, `MANAGER`, `ADMIN` and `SUPER_ADMIN` are finance operators. Payment reversal and manual ledger adjustments are restricted to Admin/Super Admin.
- A Manager may override a credit limit, overdue block or manual credit block only while approving an Order and only with a meaningful internal reason; the complete decision snapshot is immutable.
- `CREDIT` is an Order payment term, not money received. Cash, bank transfer, mobile financial service, cheque and other channels receive new funds; `ADVANCE_BALANCE` applies an existing customer credit.
- Delivery collections require Manager/Admin verification by default. Setting `DELIVERY_COLLECTION_REQUIRES_VERIFICATION=false` enables transactional auto-posting.
- Customer advance support is enabled by default but every excess/unallocated Payment must explicitly set `allowAdvance`; `CUSTOMER_ADVANCE_ENABLED=false` disables new excess allocation.
- Ledger transactions are financial truth. Shop outstanding and reserved fields are rebuildable compatibility/concurrency projections, while issued Invoice paid/due snapshots remain unchanged.
- Bangladesh has no daylight-saving transition; date-only finance filters use the fixed Asia/Dhaka UTC+06:00 boundary.
- Legacy `MOBILE_BANKING` is accepted only for migration/read compatibility and canonicalised to `MOBILE_FINANCIAL_SERVICE` for new records.
- A migrated reservation records `MIGRATION_BACKFILL` provenance and the original approval metadata; the authenticated migration operator is not represented as having made a new credit override. Its stable idempotency key binds the Order and reason, and the active-reservation total rebuilds the Shop projection.

## Phase 9

- In-app notifications are the durable record of an event and cannot be switched off. Preferences govern only the optional email, SMS, push and WhatsApp channels, so a muted event still leaves an auditable in-app record and a `SUPPRESSED` delivery row explaining why nothing was sent.
- The event catalogue is closed and its keys reuse the exact `type` strings written by Phases 4-8, so historical notifications remain readable and the migration can backfill them without guessing.
- Quiet hours use Asia/Dhaka and hold push, SMS and WhatsApp while still allowing email. `CRITICAL` events - delivery verification codes, failed deliveries, payment reversals and credit blocks - always bypass quiet hours, because suppressing them would cause an operational failure rather than a minor annoyance.
- Preferences apply per user, not per role. An account-wide default channel therefore applies to every event; that is treated as the user's explicit choice rather than being narrowed to the template's defaults.
- Redis is optional. Without it the API uses an in-process queue with identical retry semantics and a single-instance Socket.IO server. This is a documented single-instance deployment, not a silent downgrade: the queue driver is logged at start-up and every dispatch outcome remains visible in `notificationdeliveries`.
- Email, SMS and WhatsApp share one signed-webhook adapter because all three vendors are reachable through a single JSON POST. When no webhook is configured the adapter logs the fully rendered message so development remains functional without credentials.
- Expo's public push endpoint requires no credential, so push is a real implementation rather than a stub. Push tokens are unique across users and move to whoever registered the device last, which prevents a shared device from notifying a previous account.
- ActivityEvent is a separate user-facing stream rather than a view over AuditLog. Audit records exist for forensics and contain before/after values that must never reach a customer, so timeline visibility is stored explicitly per event.
- Notifications and activity written inside a business transaction use the caller's session and are dispatched after a short delay; a missing delivery row at dispatch time is treated as an aborted transaction rather than an error. A sweeper re-queues any PENDING row older than a minute so a lost enqueue cannot drop a notification.
- Realtime is an accelerator, not a dependency. Web views that gained socket updates kept a slower polling fallback, so a blocked websocket degrades to the previous behaviour instead of showing stale data.
- The near-expiry digest window used `NEAR_EXPIRY_DAYS` (default 90); Phase 10 moved it into persisted system settings, where the environment variable remains the fallback.
- A user's phone number is optional; SMS and WhatsApp fall back to the shop's primary phone for Shop Owners and are recorded as suppressed with a reason when no number is known.

## Phase 10

- Configuration is split by owner. Infrastructure — database, Redis, JWT secret, CORS allow-list, provider webhooks — stays in the environment because it is needed before the database is reachable and must not be editable through an authenticated web form. Business policy moves into System Settings.
- Resolution is persisted, then environment, then built-in default, applied per field rather than per group. This is what lets an existing deployment upgrade with no configuration change, and lets an administrator override one field without restating the rest.
- Settings are stored one document per group. A group is the unit an administrator edits, audits and versions, so two administrators editing unrelated groups never collide; a single whole-settings document would have made every concurrent save a conflict.
- A group must be replaced in full, not patched. A partial write would silently retain a field the administrator believed they had removed.
- The migration seeds only groups the environment actually configures. Seeding groups that sit at built-in defaults would freeze today's defaults into the database and stop them tracking future releases.
- Invoices, receipts and statements keep snapshotting business identity at issue time. Changing the business name never rewrites an issued document, matching the rule the ledger already follows.
- Settings are cached in memory with a 30-second TTL. A local save invalidates immediately; the TTL is how other instances converge. This is a deliberate bound on staleness rather than a distributed cache, which would add Redis to a path that must work without it.
- `localisation.timezone` is consumed by notification quiet hours and digest day boundaries. Finance day boundaries stay on Asia/Dhaka: moving them would change which period a posted transaction belongs to, which is a finance-calendar decision rather than a display setting.
- The locale setting accepts `bn` today so enabling Bangla later needs no schema or data migration. The string catalogue itself is not yet extracted, so the interface remains English.
- Only a Super Admin may administer privileged accounts or grant privileged roles, nobody may change their own role or deactivate themselves, and the last active Super Admin is protected. These are unrecoverable failure modes, so they are enforced in the service rather than left to interface discipline.
- A role change or a non-active status revokes sessions immediately, because a removed privilege must not outlive the change in an open session.
- Administrative password resets set a temporary password and force a change at next sign-in. The password is never audited; only that a reset happened, by whom and why.
- Sign-in is audited as AGENTS requires. A failed attempt against an unknown email records no actor rather than inventing one, so the audit log never implies an account that does not exist.

## Phase 11

- A return is raised against an invoice, not an order. The invoice is what the customer was charged for and what carries batch and price, so it is the only record that can bound both the returnable quantity and the refund.
- Only a delivered order can be returned. Goods that never reached the customer are handled by the existing delivery failure and return-to-store path, which is a custody problem rather than a sales return.
- Open returns hold a claim on the invoice line; rejected and cancelled ones release it. Two open requests can therefore never together exceed what was invoiced, and a withdrawn request does not permanently consume the customer's entitlement.
- Approving nothing is recorded as a rejection rather than an approved return worth zero, so no return sits alive with nothing to collect.
- The refund follows the invoice's own arithmetic in order: line discount prorated, then a proportional share of the order-level discount, then tax on what remains. Crediting the gross line value would refund more than was charged.
- The delivery charge is never refunded. It was incurred to move the goods and that cost is not recovered when they come back, so returning an entire invoice still leaves the delivery charge and its tax with the customer.
- Receiving the goods recalculates the credit from what actually arrived, not from what was approved. Approval sets a ceiling; the warehouse sets the figure.
- Stock and money move at different moments and by different hands. Receiving books stock in; a separate finance action issues the credit note and posts to the ledger. A received return therefore waits in a visible queue rather than crediting an account the moment a carton is opened.
- Returned goods land in the `returned` bucket and leave it only through an explicit disposition. Nothing that came back is allocatable before somebody has inspected it.
- An expired batch can be received but never restocked. The units are recorded as expired so the physical count stays honest without expired stock re-entering FEFO allocation.
- Damaged and expired returned units leave `onHand`, matching the existing write-off movements. They are physically present but permanently unsaleable, and counting them as on hand would overstate the stock value.
- A credit note is immutable and one per return. Correcting a credit means posting a balancing adjustment, exactly as a posted payment is corrected, never editing the issued document.
- An order becomes `RETURNED` only when every invoiced unit has come back. A partial return credits the customer and leaves the order delivered, because the customer still keeps part of it.
- Reports are recomputed from the source records on every request rather than maintained as rollups. A rollup can drift from the ledger; a recomputation cannot. The cost is that a very wide date range does real work, which is a tuning problem rather than a correctness one.
- Report periods use the Asia/Dhaka business calendar, matching the ledger's day boundary rather than the localisation display setting. A report and the statement it summarises must agree on which day a transaction belongs to.
- Returned value is attributed to a dimension only where the return record itself carries the key — medicine and customer. Category, manufacturer and territory report sales without a returned column rather than inferring one from a second catalogue join that could disagree with the invoice snapshot.
- Charts are hand-written SVG rather than a charting dependency, and every chart is paired with the same figures as a real data table. The numbers must reach a reader who cannot see the picture, and a chart library would have added a large dependency for decoration.
- CSV exports carry a byte order mark and neutralise leading `=`, `+`, `-` and `@`. Without the mark Excel misreads the currency symbol and Bangla names; without the escaping a value copied out of the database could execute as a formula on the reader's machine.
- Mobile approves a return in full or rejects it; partial quantities are decided on the web. A per-line quantity grid is a desk task, and offering a cramped version of it invites the wrong number to be approved.

## Phase 12 security, performance and release readiness

- Rate limiting is hand-written against a store interface rather than taken from a package. The project already has that shape in `jobQueue` - Redis when configured, an identical in-process fallback otherwise - and a package's default memory store would have needed a second dependency to become shared anyway. Doing it directly also allows keying by user rather than only by address.
- Rate limiting fails open when its store is unreachable, and logs it. A limiter that fails closed turns a Redis blip into a total outage, which is a worse outcome than briefly unmetered traffic.
- A fixed window is used rather than a sliding log. The known failure mode is that a caller can send up to twice the limit across a boundary; for protecting sign-in and report aggregations that is an acceptable trade for one integer per key.
- Rate-limit budgets without Redis are per instance. This is documented rather than hidden: a single-instance deployment is supported and correct, a horizontally scaled one needs Redis.
- Refresh tokens are stored as an HMAC rather than a bcrypt hash. bcrypt exists to make a low-entropy secret expensive to guess, and a refresh token is high-entropy inside a signed JWT, so the deliberate cost bought nothing and was paid twice on every rotation. Existing bcrypt hashes still verify until they rotate.
- Presenting an already-rotated refresh token is treated as theft and revokes every session for that user, even though a legitimate client that lost the rotation response would look identical. The system cannot tell them apart, and the cost of being wrong is a stolen account in one direction and a sign-in in the other.
- Access tokens issued before this phase carry no session identifier and are accepted until they expire, rather than signing every user out on release. The exposure is at most one access-token lifetime after a deployment.
- Session revocation is checked on every authenticated request with a second primary-key lookup. The alternative - a token version cached in memory - would be faster and would also be wrong across instances for as long as the cache lived.
- Sign-in still returns different statuses for an unknown account, an inactive one and a locked one, because those messages are genuinely useful to the person reading them and this is a closed system where accounts are created by administrators. The timing oracle is closed with a decoy comparison, which is the part an attacker could have used at scale.
- Unsafe request keys are removed rather than rejected. A request carrying one is either an attack, which should not be given a diagnostic, or a client bug, which then fails ordinary validation with a message about the field rather than a confusing security error.
- The Express query parser is replaced with a flat one built on `URLSearchParams`. Nothing in this codebase relies on nested query objects, and a parser that cannot produce them is a stronger guarantee than a filter applied afterwards.
- Mongoose's global `sanitizeFilter` is deliberately not enabled. It wraps every operator in `$eq` unless each call site opts out, which would break the hundreds of legitimate `$in`, `$gte` and `$lte` filters this codebase depends on. Untrusted input is constrained where it enters instead.
- In production, an unexpected failure returns a fixed message and a correlation identifier. Exception text routinely contains a hostname, a file path or part of the failing query, and none of that is the caller's business. Deliberate refusals keep their message, because hiding those just produces a support ticket.
- The API reference is rendered by the API from its own OpenAPI document rather than by loading Swagger UI from a CDN. Allowing a third-party origin to run scripts on the API's own domain is a poor trade for nicer collapsible panels.
- The OpenAPI route table is declared by hand rather than reflected off the Express router. The router knows a path and a method but nothing about who may call it, and the permission column is the part a reader most needs.
- Report aggregations carry a `maxTimeMS` guard rather than an API-side timeout. Only the database abandoning the operation actually frees the resource; the API giving up merely stops waiting for it.
- Response compression is done by nginx in the reference deployment and by the `compression` middleware otherwise. Compressing in Node costs an event loop that has transactions to run, but a deployment without a proxy should not have to ship uncompressed reports.
- Health is split into liveness and readiness. Liveness must not fail because the database blinked, or a recoverable fault gets the container restarted; readiness must fail in exactly that case, so the instance leaves the load balancer rather than answering with errors.
- Session management is exposed to every role, not only administrators. The person best placed to notice an unfamiliar device is its owner, and until this phase a lost phone required an administrator.
- Another user's session identifier returns "not found" rather than "forbidden". "Forbidden" would confirm that the identifier names a real session.
- The Phase 12 container images are built and verified in CI but not pushed. Proving the Dockerfiles work needs no registry credentials, and choosing a registry is a deployment decision this repository should not make.

### Verified once a container runtime became available

- The operational scripts ship inside the API image. The alternative — running them from a checkout on the release machine — needs a matching toolchain wherever a release happens, which is most of what shipping an image avoids.
- The bootstrap password is supplied by the operator rather than generated by the script. A generated password has to be printed to be usable, and a credential in a deployment log is a credential in a log aggregator. Forcing a change at first sign-in then makes the environment variable's exposure temporary rather than permanent.
- Bootstrap refuses to act when a Super Admin already exists, rather than updating one. Overwriting the highest-privilege account from an unauthenticated script is a silent takeover, and every account after the first belongs in the audited administrative flow.
