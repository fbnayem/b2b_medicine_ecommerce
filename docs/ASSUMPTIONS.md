# Assumptions

- Real-time updates via Socket.IO will use standard authorization patterns (passing JWT token).
- ~~Currency is strictly BDT, stored as integer minor units (poisha).~~ **Superseded in Phase 12.** Amounts are still integer minor units, but the _scale_ of a minor unit is now the configured currency's ISO 4217 exponent rather than a hard-coded hundred — yen has none and dinar has three, so assuming two was a hundredfold error in one direction and a tenfold one in the other. One currency per deployment, set by `PRIMARY_CURRENCY`; a multi-currency ledger is Phase 14.
- Deliveries are internally handled by the system's own delivery persons, not third-party couriers.
- ~~A single mobile app will serve all roles via Expo Router role-based navigation.~~ **Superseded in Phase 36.** Role-based navigation is unchanged; there are now three applications - Shop, Manage and Rider - because one icon and one store listing cannot be written for a pharmacy owner and a delivery rider at once.
- The `packages/` monorepo configuration will heavily rely on simple TypeScript exports mapped via `package.json` `main` and `types`. **Qualified in Phase 36:** this holds for Node, `tsc` and the API. Vite and Metro both resolve to source instead, because `main` points at a `dist/` that no client build produces.
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

## Road to production, phases 2–6

- **Credit override is an administrator decision.** `PHASE_STATUS.md:166`
  recorded Admin and Super Admin only, `PERMISSIONS.md:29` said Managers as
  well, and the service applied no role check at all. Settled as the stricter
  reading, which is also the documented intent: overriding a credit block
  extends unsecured credit past an agreed limit, which belongs to whoever
  carries that risk. `PERMISSIONS.md` is corrected. Relaxing it later is a
  policy change somebody makes deliberately.
- **Cancellation stops at `PACKED`.** Past that an invoice exists and stock has
  physically left the shelf, so the correct instrument is a return, which
  credits the invoice and receives the goods back. Cancelling there would leave
  an invoice with no order behind it.
- **Numbers stay in Western digits in Bangla.** `bn-BD` would change digits,
  grouping and currency placement at once. Money here is reconciled against
  printed invoices, bank slips and bKash messages, all in Western digits, and
  both money parsers accept only `[0-9]` — so Bengali display without Bengali
  input would give a form that refuses what it just showed you. If the business
  disagrees, this becomes a third localisation setting affecting display of
  non-transactional numbers only, never inputs and never printed invoices.
- **The tenant's language beats the device's.** This is a business tool used on
  shared warehouse terminals and on personal phones; the distributor's choice
  should beat a handset that came with its language already set. A user's own
  explicit choice still beats both.
- **Batch provenance is nullable.** Every batch received before purchasing
  existed has none of it, and making these required would turn stock physically
  sitting on the shelf into a validation error. `recallService` reports
  `predatesPurchasing` explicitly rather than leaving an absent supplier to be
  read as a lost record.
- **The audit log is archived, never deleted, and only after its digest
  verifies.** The other three unbounded collections are operational noise with
  configurable windows.
- **`@medsupply/config` and `@medsupply/constants` remain empty.** They were
  given the standard package scaffold so CI covers them, but nothing in the
  plan calls for content and none was invented.

## Part III, phase 12 — the country-pack seam

- **A country pack is data, not behaviour.** `@medsupply/jurisdictions` holds
  what differs between countries — currency, fiscal year, weekend, week start,
  address rules, licence types — and holds no functions that do anything. The
  date and money functions stay in `@medsupply/utilities`, which reads it. The
  dependency runs one way, which is also what stops the two forming a cycle.
- **Bangladesh was transcribed, not designed.** Every value in the `BD` pack was
  read out of the code it replaces: `Asia/Dhaka` from `DEFAULT_FORMAT_SETTINGS`,
  the Saturday week start from `reportPeriod.ts`, the two licence fields from
  `Shop.ts`, the required `district` from its address sub-schema. The seam is
  only trustworthy if lifting existing behaviour into it changes nothing, so
  this phase introduces no new decision for the installed base.
- **Nothing speculative is modelled.** `LicenceType` lists the two instruments
  Bangladesh issues and `TaxEngineId` lists the one engine that exists. Each
  grows when a pack that needs it arrives, alongside a deployment that can say
  whether the entry is right. Plausible-looking values for countries nobody has
  sold to yet are guesses with types on them.
- **`PRIMARY_COUNTRY` is environment configuration, never an administrable
  setting.** The pack decides the year reference sequences reset on, the day the
  finance calendar starts and the currency amounts are stored in. Changing any
  of those on a live deployment restates history, so it is a migration rather
  than a setting — the same reasoning that already keeps the database URI and
  the signing secrets out of the settings screen. An unrecognised code stops the
  process at boot.
- **Supersedes the Phase 8 entry on the fixed `+06:00` boundary.** Day
  boundaries are resolved through `Intl` in the configured zone, in two passes so
  they stay correct across a daylight-saving transition. Dhaka has none, so the
  Bangladeshi result is byte-identical to the literal offset it replaces; a
  boundary an hour out anywhere that observes DST would move transactions
  between reporting periods.
- **Clarifies the Phase 10 and Phase 11 entries on the finance calendar.** Those
  pinned finance day boundaries and report periods to Asia/Dhaka on the grounds
  that moving them is "a finance-calendar decision rather than a display
  setting". That reasoning is kept intact: the business calendar comes from the
  country pack and **changing `localisation.timezone` still does not move the
  books**. All that changed is that the answer is looked up instead of compiled
  in.
- **Display formatting reaches the server.** `configureFormatting` was called
  from one place in the repository — the web client — so the API rendered every
  invoice, receipt and CSV export with the package defaults regardless of
  configuration. It is now applied on every settings load, and
  `formattingDiscipline.test.ts` fails the build if a second module tries to own
  that state or falls back to the defaults.
- **The settings field named `locale` is a language, not a locale tag.** Its
  schema is `['en', 'bn']`. Passing it to `Intl` directly renders times as
  `03:30 PM` where this product has always shown `03:30 pm`, and `en-BD` is not
  a CLDR locale at all — it silently resolves to `en`. `formattingLocale` maps
  the language to a real tag, and every date formatter forces `-u-nu-latn` so a
  Bangla month name never arrives with Bengali digits, which is what
  `docs/ASSUMPTIONS.md` settled on and what both money parsers can read back.
- **Reference series stay on the calendar year for Bangladesh.** Many tax
  authorities require the invoice series to be gapless within the _financial_
  year, so the basis is a pack property — but switching an existing deployment
  changes the references its customers already quote, which is a decision for
  the business. The year is now read in the business zone rather than from
  `getUTCFullYear()`, which labelled anything issued between midnight and 6 am
  on 1 January in Dhaka with the previous year.
- **Multi-currency is explicitly not in this phase.** One currency per
  deployment; the ledger still balances in raw minor units. Ledger entries
  carrying their own currency, FX rates, revaluation and realised gain/loss are
  Phase 14, and were chosen with the cost stated.

## The commercial model (Phase 8)

The plan named three business rules that had to be settled before the price
resolver could be written, because the model supports either answer and code
cannot invent one. These are the answers, recorded here so the next person
reads a decision rather than guesses at an intention.

- **Price precedence is shop override → assigned price list → medicine
  default.** The most specific arrangement wins, and the resolver records
  **which** of the three it used on the order line. A price that cannot say
  where it came from is a price nobody can defend in a dispute, and disputes
  about price are the ordinary case in this trade rather than the exception.
- **A scheme does not stack with a price-list discount.** Free goods are the
  discount for that line. Allowing both means a rep can hand out an unbounded
  concession by combining two things neither of which looks unusual on its own,
  and the margin only becomes visible after the invoice is issued and
  immutable. Where both apply the scheme wins, because it is the more specific
  arrangement and the one the shop was told about.
- **Free goods do not count toward credit exposure.** Exposure is what the
  customer owes, and they owe nothing for the free units — the invoice charges
  `quantity`, not `quantity + freeQuantity`. The stock leaves either way and
  the recall trace and the controlled register both see all of it, because
  those read `StockMovement`, which records what was dispatched.
- **MRP is data, margin is derived.** `marginBasisPoints` is computed as
  `round((mrp − trade) × 10_000 / mrp)` at the point of display and never
  stored. A stored margin is a third number that can disagree with the two it
  came from, and it would have to be recomputed on every price change.
- **A `SALES` user is scoped by territory, and the record names the human.**
  `Order.placedBy` and `placedOnBehalf` are what make order-on-behalf safe:
  the control is not that the order looks like the shop placed it, but that it
  says plainly who actually did.

## Order entry on mobile (phase 24)

- **An order is never queued offline; a delivery still is.** `offlineQueue.ts`
  exists and deliberately does not serve this screen. A delivery capture is a
  record of something that already happened and the server can accept it late;
  an order needs a live price and a live credit check, both of which are the
  server's answers, so taking one on a dead connection would mean quoting a
  shopkeeper a number this client invented. The screen refuses and says so.
- **"No connection" is inferred from the last request, not from a radio.**
  There is no connectivity library in this app and adding one for a single
  boolean was not worth a dependency. `apiFailure` already distinguishes "the
  request never reached the server" (`NETWORK`, `TIMEOUT`) from "the server
  refused it", and the price quote runs continuously while an order is being
  built — so by the time the submit button matters, a failed quote has already
  answered the question. The cost of the inference is one wasted attempt in the
  case where the connection dies between the last quote and the submission, and
  that attempt is safe: it carries the same idempotency key as any retry.
- **The customer a rep last ordered for is remembered across restarts.** Stored
  under `medsupply.orders.customer.v1` in `AsyncStorage`, and used only while
  that shop is still in the territory-scoped list the server returns — a
  reassigned territory silently drops it rather than opening the screen on a
  customer every submission would be refused for.

## Importing a supplier catalogue (Arogga, phase 25)

- **A prescription line must name its active ingredient; nothing else must.**
  The catalogue required a generic name, a strength and a dosage form on every
  row, which is right for a tablet and impossible for a box of nappies — so
  stocking anything that is not a drug meant inventing all three. The condition
  is `classification`, deliberately, and not `productType`: which shelf a thing
  sits on is a merchandising choice that drifts, whereas whether it is dispensed
  against a prescription is a fact about the product. The imported sample proved
  the distinction — a sunblock and a dermatological cream both arrive filed
  under "Medicine" and neither carries a generic name.
- **`b2b_price` is the trade price, and `price` is not.** The source carries
  both; `price` is what a shopper pays on the storefront. Importing that would
  quote every customer the retail figure and give away the trade margin on the
  first order.
- **Cost price is not in the export at all.** Imported rows take the trade price
  as their cost, so margin reads as **zero** — visibly unknown — rather than as
  a plausible figure nobody entered. A goods receipt supplies the real one. Cost
  of zero was rejected as the alternative because it reports a 100% margin,
  which is a dangerous number to be wrong about.
- **`externalRef` is the upsert key, not the SKU or the reference.** The
  reference is allocated by the counter and differs on every run, so re-running
  keyed on it would duplicate the whole catalogue.
- **The handoff is wrong about the SQLite copy.** It says to prefer
  `arogga.sqlite` because "it has the same data"; its `seo_sections` table has
  no `lang` and no `section` column, so the documented instruction to filter
  descriptions to English cannot be followed from it. `descriptions.csv` carries
  the documented shape and is what the importer reads.
- **Their photography and copy are imported on the operator's authority.** The
  bundle's image pipeline removes Arogga's watermark and the logo burned into
  some artwork, and the descriptions are their marketing and monograph text.
  `--no-images` and `--no-descriptions` turn each off. `meta_title` and
  `meta_description` name Arogga outright and are never imported.

## Serving product photography (phase 24)

- **`/media` is unauthenticated.** Both clients render these through an ordinary
  image loader — a browser's and React Native's `<Image>` — and neither can
  attach a bearer token to one. Signed URLs and streaming every file through an
  authenticated handler are both real designs that buy nothing here: a
  photograph of a box tells a stranger what the box looks like, while prices,
  stock and customers stay behind the API. It has its own rate-limit tier
  (`RATE_LIMIT_MEDIA_MAX`, default 1200) because a catalogue page asks for one
  list and a hundred pictures, and charging both to the global budget lets a
  page throttle the screen that requested it.
- **Only raster images are served, checked on the decoded path.** `.svg` is
  excluded deliberately: it is a document that can carry script, and a browser
  navigated to one directly will execute it. The check decodes first because
  `req.path` does not, so a check written against the raw string reads `%2e%2e`
  as an ordinary segment.
- **The media directory's absence is a missing photograph, never a failed
  boot.** A deployment that mounts nothing at `MEDIA_ROOT` simply has no
  pictures.
- **Pictures are copied into the media root, keyed by source product id.** Two
  products in the export share a filename often enough that flattening would
  silently give one of them the other's photograph; the id is the one thing
  guaranteed unique.

## Importing at full scale (phase 24)

- **A description is capped at 2,000 characters as it arrives, not afterwards.**
  That cap is also the memory bound on the import: 49,000 monographs held in
  full while the products are written is the difference between a batch job and
  an out-of-memory crash.
- **`descriptions.csv` is streamed, because at scale it cannot be read.** ~4.1M
  rows; `readFileSync` on the synthesised equivalent throws
  `Cannot create a string longer than 0x1fffffe8 characters` rather than running
  slowly. Verified against a synthetic full-scale bundle — 57,015 products,
  4.1M description rows, 812 MB — completing in 62 seconds inside a 1 GB heap.
  **The real 57k export has not been run**; the sample is 15 products.
- **A tag with no closing `>` is stripped wherever text is cut.** One row of the
  real sample ends `...</p>\n55:Tcad,<h` inside its quoted field — the exporter
  truncated it mid-write — and capping a description can produce the same shape.

## What the screenshots turned out to be (phase 25)

- **A development server that has stopped reloading is a class of defect, not an
  accident.** The process answering `:5000` had been started thirty-four hours
  earlier with `start` rather than `dev`, and two later `pnpm dev` stacks had
  lost the port to `EADDRINUSE` and stayed alive anyway, so the terminal looked
  healthy. Six route groups added in the meantime — trips, pricing, stocktakes,
  warehouses, `/orders/quote`, `/media` — answered 404, which the client renders
  as "It may have been removed". **Fourteen screens looked like data loss and
  were a stale binary.** `dev.mjs` now refuses to start on a busy port and
  `server.ts` exits on `EADDRINUSE` with a sentence rather than a stack trace.
- **A 404 for an address is not a 404 for a record**, and they no longer share a
  code. `notFoundHandler` emits `NO_SUCH_ENDPOINT`, worded as what it is: this
  build of the client is asking for something this build of the server does not
  serve.
- **The port probe binds exactly as the server binds — no host.** The first
  version passed `'0.0.0.0'` and reported the port free while the API was
  answering on it, because Windows treats the IPv4 and IPv6 wildcards as
  distinct addresses. A check that cannot fail is the defect it was written to
  prevent.
- **Deleting a stylesheet is only finished when every file that referenced it is
  audited.** `inventory.css` went when the _pages_ were converted;
  `uiDiscipline.test.ts` globs `pages/`, so `components/` was never looked at
  and thirty-seven class names went on being written for a file that no longer
  existed. Four components rendered unstyled on at least seven screens, and
  three print layouts printed the application chrome around the document. A
  class that resolves to nothing is not a CSS error — it is silence.
- **The new gate is "this class cannot resolve", not "components must use the
  primitives".** The second is a matter of taste and would be argued with; the
  first is a fact about the build, and a fact is what a gate can hold.
- **Two status tones were added rather than repainting the palette.** Ten of the
  twenty-two order statuses rendered in the same blue, so a queue could not be
  scanned — every pill had to be read. `progress` (teal) is work happening
  inside the building and `transit` (plum) is work that has left it. Both are
  hues already in the chart palette, and both clear 4.5:1 on their own subtle
  background in each theme.
- **`success` deliberately stays equal to `brand`.** In a green-branded product
  that collision is semantically honest, and the separation that was actually
  missing is between the phases of the lifecycle, not between a verdict and the
  brand.
- **Light mode had two greys and now has four.** `canvas`, `surface-sunken` and
  `surface-hover` were all `neutral.50`, so a hovered row was exactly the colour
  of the page behind it. `surface-raised` still equals `surface`: on a light
  theme elevation is carried by the shadow, because there is nothing above
  white to go to.
- **A list that stops without saying so is a correctness defect, not polish.**
  Nine list screens fetched the server's default page — twenty rows for orders —
  and displayed exactly that with no indication anything followed. The reader
  has no reason to doubt it, which makes it worse than an error.

## Not finished filling in a form is not a malfunction (phase 26)

- **"Something went wrong" was the answer to a blank field.** Four hand-rolled
  forms — planning a round, raising a purchase order, requesting a return,
  adding a shop — answered their own validation with `ErrorState`, so leaving a
  field empty was reported in the same words, the same red and the same tone as
  an unreachable database. The screenshot that prompted this shows it exactly: a
  rider chosen, a day chosen, notes typed, and a red alert. Nothing had gone
  wrong; the round had no stops on it yet.
- **`FormNotice` is warning-toned and lists problems separately.** "Choose a
  rider, a day, and at least one stop" is one sentence covering three
  requirements, and it does not tell somebody who has already met two of them
  which one they are missing. Each problem now stands alone and can carry the
  reader to the control it is about — on a form two panels deep, that is the
  difference between being told and being helped.
- **The notice is derived from state, not captured at submit.** So it shrinks as
  the form is filled in rather than going on naming a problem already fixed.
  Focus is driven by a separate submit counter, because moving the cursor every
  time the list changes would yank it out of the field being corrected.
- **`role="alert"` _and_ focus, following the GOV.UK error summary.** Focus alone
  conveys the heading but not reliably the list; the alert alone is missed by
  anybody who has scrolled past.
- **Native `required` still guards the fields that carry it.** On the round form
  the browser refuses to submit without a rider, so the application's own
  `needRider` problem is effectively unreachable through the button. It is kept
  as the second line rather than removed: the two mechanisms disagree about
  nothing, and the notice is what a keyboard or screen-reader user meets if the
  native bubble is dismissed.
- **The shared feedback primitives were English-only, and nothing could see it.**
  `ErrorState`, `LoadingState`, `Resource` and `DataTable` wrote their defaults
  as literals while `packages/i18n` held Bangla for every one of them and
  `apps/mobile` was already reading it. A component that never asks the
  catalogue produces no missing key, no type error and no lint warning — so the
  language toggle worked everywhere except on a failure, which is the one
  surface a confused user stops to read. `uiStrings.test.ts` is the gate.
- **One empty list was three different facts.** The round form rendered "Nothing
  is waiting to go on a round" while the request was in flight, when the request
  had failed, and when the list was genuinely empty. The failed case is the
  worst of the three: the reader has no reason to doubt it. It reads through
  `Resource` now, which has always distinguished them.
- **An empty list scoped to a filter must say so.** `/trips/plannable` is
  filtered by the chosen rider, and the wording did not mention the rider — so a
  screen showing nothing while another rider had six stops was telling the truth
  about the query and a lie about the business.
- **A screen with no possible successful outcome says so before it is filled
  in.** With no delivery assigned to any rider there is no round to plan, and
  the form used to let somebody pick a vehicle and type notes before telling
  them. That state is now named at the top with a link to where the work
  actually starts.

## Phase 27 — managing a medicine, explaining a field, keeping the app in step

- **Sections, not tabs, on the medicine page.** Tabs would hide three quarters
  of the page from the accessibility scan, break Ctrl-F and printing, need a
  keyboard model that exists nowhere else in forty-three pages, and force a rule
  for what happens when a manager pastes `?tab=offers` to a storekeeper who has
  no such tab. A one-tab tablist for a shop owner is furniture. Sections give
  deep links for nothing: each card carries an `id` and an `<h2>`.
- **No `version` field on `Medicine`.** `PriceList` and `Scheme` carry optimistic
  concurrency and copying it here would be a migration wearing a one-line diff:
  a Mongoose `default: 0` does not backfill documents that already exist, so
  `undefined !== 0` would refuse the first edit of every medicine in the
  catalogue as a conflict. The blast radius differs too — a price list is
  replaced as a whole sheet, so a lost update destroys somebody's prices,
  whereas a medicine is patched field-wise and two managers editing different
  fields both land.
- **A one-field price change as well as the edit form.** `UpdateMedicineSchema`
  has always accepted a patch of one field, while the only UI that could produce
  one demanded nineteen controls, three conditionally required and one pair
  carrying a cross-field rule. It re-checks against the **stored** MRP, mirroring
  the merge the server performs before running the same rule itself — comparing
  against a field on screen would be comparing against a number nobody saved.
- **Delisting is what "delete" means here, and the confirmation says so.** There
  is no delete endpoint and there should not be: a medicine is named by every
  order that ever contained it, and removing the row would leave those orders
  pointing at nothing.
- **Margin is measured against the MRP, never against cost.** A markup over cost
  is a different figure and one keystroke away, so the label says which it is,
  and margin is safe to show anyone who may see prices while cost is not.
- **Popover, not Tooltip, for the "i" icon.** A Radix tooltip is hover and focus
  only and **does not open on tap**; this audience includes storekeepers on
  phones. Hover opens it with a mouse, a tap latches it, the pointer can travel
  onto the panel, and Escape dismisses it — WCAG 2.1 SC 1.4.13.
- **Three tiers of guidance, and the rule that separates them.** If omitting a
  value causes an error it is a **hint**; if it causes a wrong-but-valid value it
  is a **help tip**; a **placeholder** is only an example of the shape. A tooltip
  is never a substitute for a hint — nobody should have to open a popover to
  learn a required format.
- **A manager may create a delivery person or a storekeeper, and nothing else.**
  Trip planning and delivery assignment are `MANAGEMENT`, so the person who
  needed a delivery person was precisely the person who could not make one. The
  storekeeper half is wider than the rider case needs, and is worth stating
  plainly: **a storekeeper can move stock, so this lets a manager create an
  account that changes inventory.** It is defensible — a manager already approves
  orders and posts stocktake variances, both of which move more value than a
  warehouse account does — and it is the user's explicit decision. What keeps it
  safe is that the permitted set is exactly those two, expressed once in
  `assertAdministrable`: never MANAGER, ADMIN or SUPER_ADMIN, which are the roles
  that could go on to create further accounts. Their own role is included in
  that refusal and would otherwise have passed, because MANAGER is not
  _privileged_. The `USER_CREATED` audit row names the actor and their role.
- **`PickOrCreate` hides the create affordance rather than disabling it.** An
  affordance that answers 403 is worse than none: it tells a person the product
  can do something for them that it will not.
- **One level of dialog only.** `Dialog` hard-codes `z-[100]`/`z-[200]` with no
  depth counter, so a dialog opened from inside a dialog stacks by DOM order and
  paints two overlays. A `PickOrCreate` on a page is fine; one inside an
  `ask.confirm` is not. Recorded rather than solved.
- **An unusable `?medicineId=` returns an empty page, not every offer.** Dropping
  the filter would answer a question about one medicine with every offer in the
  tenant — the most misleading of the three possible replies, and worse than the
  cast error that handing it to Mongoose raises.
- **Price lists carrying a medicine are filtered in the browser.** `listPriceLists`
  already returns every list's `lines` inline, so no endpoint is needed. The
  bound is written down in the code rather than left silent: a tenant with more
  than fifty price lists would see only the first fifty there.
- **Blank means absent, for every optional field with a shape rule.** The
  server's optional fields are optional _or well-formed_ — a barcode is at least
  six characters, a picture is an address — and a control nobody has typed into
  holds `''`, which is neither. The inner rule is unwrapped from the shared
  schema rather than restated.
- **No warehouse picker, and the reason is a model gap not a UI one.** The
  stocktake and goods-receipt forms take a `warehouseLocation`, which the server
  matches as a _string_ against `MedicineBatch.warehouseLocation`. It is not a
  reference to the `Warehouse` model. A picker there would send an id matched
  against nothing, producing a stocktake that silently covers zero batches —
  worse than the free-text field it replaced, because it would look correct.
- **A picker's creation form hands back the whole record, not its id.** A
  picker that has just cleared its search term has nothing left to look the name
  up in, and fetching it again to render a word the form already held is a
  request for nothing.
- **`AddressSchema` carries an optional `_id`.** Delivery addresses are patched
  as a whole array, so adding one means sending the existing ones back. Without
  the id in the schema they were stripped, Mongoose minted new ones, and a
  picker holding the old id pointed at nothing.
- **The price list field on `ShopForm` links out rather than opening a dialog.**
  A repeating line editor is more than a dialog should hold, and the field is
  optional so leaving costs less than it does on a round with stops already
  chosen. What had to change was the silence: it read one page of twenty-five
  with nothing on screen saying there were more.

## Phase 28 — the blank page, and the front door

- **The boot fallback lives in `index.html`, in plain CSS, untranslated.**
  Everything else the application shows — the stylesheet, the design tokens,
  both language catalogues — arrives through the module graph rooted at
  `main.tsx`. A fallback that imports any of it is not a fallback for the case
  where that graph fails, which is the only case it exists for. The duplication
  of a few colours is the price.
- **It sits outside `#root`, not inside it.** `expectPageRendered` fails a page
  whose `#root` has no text in it, and that assertion is what catches the blank
  page in the first place. A fallback inside `#root` would have given that gate
  its own words to read and switched it off silently.
- **It is dismissed by the last statement of `main.tsx`.** Not by a CSS rule and
  not by a timer: if any module above that line throws, the line is never
  reached and the message stays on screen. The removal has to be the thing that
  proves the application started.
- **Twenty seconds before it says the load is slow**, and the wording is a delay
  rather than a failure. A cold Vite dev server on Windows can take longer than
  a warehouse connection does, so a false positive is expected occasionally and
  must not accuse the network of something it did not do.
- **`FrontDoor` is not in the navigation manifest.** The manifest describes
  screens a role may open; `/` is neither a screen nor role-dependent. It also
  lives in `app/` rather than `pages/`, because the design-system gate requires
  everything in `pages/` to carry a `PageHeader` and take its words from the
  catalogue — correct for a screen, meaningless for a redirect that renders
  nothing.
- **The file is `FrontDoor.tsx`, not `Landing.tsx`.** `app/landing.ts` sits
  beside it, and Windows resolves `./Landing` to `./landing` — an import that
  works on CI and hands back `undefined` on a developer's machine.

## Phase 29 — the home screen

- **A home-screen figure reuses the destination's query key and URL.** Not a
  new count endpoint: the same request the screen it links to already makes. The
  number and the list then cannot disagree, the click is served from cache, and
  the invalidation written for that screen keeps this one current. It also means
  a signal can never read something its role may not read.
- **The navigation manifest decides who sees each figure.** The same source
  `AppShell`, the route guards and mobile read. The home screen is the one place
  nobody chose to open, so a card that answers 403 there is worse than no card.
- **Only queues, and a zero is shown but muted.** A figure earns a place only if
  its unfiltered length is itself a backlog — which is why there is no "Orders"
  or "Medicines" card. Zero stays on screen because "nothing is stuck" is an
  answer and a card that disappears when empty moves the ones beside it.
- **A badge is for the exception.** "Available to order" was on every card in
  the catalogue, so it distinguished nothing and was read as decoration. It now
  appears only when a medicine is delisted.

## Phase 30 — half-written files

- **The dev server reads workspace source through a plugin rather than letting
  Vite read it.** `packages/**/*.ts` is served straight to the browser by the
  aliases, so a read that lands mid-write becomes a cached empty module and a
  blank page. The plugin retries an empty read and throws on a genuinely empty
  file, because Vite caches a successful transform and does not cache an error
  — the difference between a server that poisons itself until restarted and one
  that says what is wrong.
- **`awaitWriteFinish` is set on the dev server's watcher.** It narrows the same
  window at the source. Both are kept: the watcher option stops the server
  acting on a truncate, the plugin stops anything else opening the same hole.
- **Neither applies to the production build**, which reads files git has
  finished writing.

## Phase 31 — the redesign

- **The redesign is delivered through the tokens and the primitives, not
  through the pages.** Fifty-three screens already read their colour, shape and
  depth from one place, so changing `Card`, `Button` and the token file changes
  all of them. Not one page component was touched for appearance.
- **Three radii, and they mean something.** `rounded-lg` was on every surface —
  cards, dialogs, buttons, inputs, badges — which is the shape equivalent of one
  type size. `panel` is a surface you read, `control` is something you press.
- **Elevation is two layers in light and nearly none in dark.** A contact shadow
  plus a diffuse one is what makes a card look placed on the page; on a dark
  ground a black blur on near-black reads as nothing, so depth there comes from
  the surface steps and the border instead.
- **Colour is assigned by stage of work, not by taste.** A queue keeps its hue
  from the home tile to the sidebar group: waiting on a person is blue, being
  picked is teal, packed is amber, gone is plum. The tones are the ones the
  badge palette already used, so the contrast test already held them.
- **A tile paints its icon chip in the tone at full strength.** The subtle tints
  are built to carry small text inside a badge, a few percent off white — a
  card, an icon and a number all painted in them read as one pale smear. The
  four new `on-brand` over tone pairs are asserted like every other rendered
  pair.
- **A zero tile drops its tint as well as its weight**, so a row reads as three
  quiet and one live rather than four equally urgent squares.
- **The home charts come from one request the analytics screen already makes**,
  under the key it already uses, and the whole section disappears if it fails.
  The figures above it come from different requests and are unaffected.
- **A chart's figures table is never optional, only collapsible.** The SVG is
  `aria-hidden`, so a chart without its table does not exist for anybody using a
  screen reader.

## Phase 32 — the demo data

- **Every state transition still goes through the HTTP API.** The seed submits,
  approves, picks, packs, assigns and hands over as the role the server
  requires. It writes no status anywhere, so if a workflow gains a rule the
  seed fails rather than producing a database no sequence of clicks could
  create.
- **The one exception is the clock**, and it is narrow: after an invoice is
  issued, its `invoiceDate` and `dueDate` are rewritten so fourteen invoices
  dated today become five weeks of trade with an ageing profile. The packing
  endpoint has no "pretend this was last month" parameter and should not have
  one. Payments need no such help — `collectedAt` is part of the request.
- **One shop owner per shop.** `ASSUMPTIONS.md` already said a shop owner
  belongs to one ordering shop, and the submit endpoint means it: an address
  belonging to their second shop is refused with `ADDRESS_REQUIRED`. The six
  new shops therefore carry six new owner accounts.
- **Idempotency is keyed on the seed's own records, not on emptiness.** The
  end-to-end database is not dropped between runs and `pickers.spec.ts` creates
  a supplier every time it runs, so "are there any suppliers" was true after
  the first browser run and the seed skipped its own four for good.
- **Deliveries stop short of completion.** Completing one demands the proofs
  `DELIVERY_REQUIRED_PROOFS` asks for — an OTP sent to the shop owner and read
  back. A seed that forged one would be creating exactly the unaccountable
  record the audit rules exist to prevent.
- **The home screen's charts ask for a rolling thirty days; every other report
  defaults to month-to-date.** The two differ deliberately. A report screen
  prints the period it is showing and offers a picker, so month-to-date is a
  defensible default there. The home charts show neither, and month-to-date
  answers "how is trade going" worst on the day it is asked most: on the first
  of a month it is one day, and one point is not a trend. Thirty days is long
  enough to show a direction and short enough that a day is still a readable
  point at that chart's size.
- **Receivables ageing is as-of, not windowed**, and stays that way. What a shop
  owes today does not depend on which period a sales chart happens to be
  showing, so changing the chart's window must not change the debt.
- **A hint and a help tip are different things, and the rule deciding which is
  which is:** if leaving a field out causes an _error_ it belongs in the
  always-visible hint; if it causes a _wrong-but-valid value_ it belongs in the
  `HelpTip` beside the label. Nobody should have to open a popover to learn a
  required format, so `fieldHints.test.ts` gates the hint and not the tip.
- **The page guide answers "how are the figures worked out" only where there
  are figures.** Thirty of the seventy-three screens compute nothing, and a
  paragraph announcing that there is no arithmetic is worse than the silence it
  replaces.
- **The guide is rendered by `AppShell` from the route, not by each page.** A
  screen with no guidance written for it fails a test rather than shipping bare,
  which is not true of a block each page has to remember to paste.
- **The Vite dev server must be told to watch `packages/`.** Its watcher covers
  the project root, which is `apps/web`; the shared packages are a sibling of
  it, so without `watchWorkspaceSources` a change to any of them is invisible
  until the server restarts — and nothing on screen says so.

## Phase 35 — work queues

- **A queue endpoint's default is its history, and a home tile counts its
  backlog.** Those are different sets and the difference is now written down:
  `APPROVAL_AWAITING` / `APPROVAL_DECIDED` and `PICKING_OUTSTANDING` /
  `PICKING_DONE`. Both halves, rather than only the one being counted, so a
  status added later and classified as neither fails a test instead of silently
  falling out of a number.
- **A blocked pick list counts as outstanding.** It is not progressing, but a
  queue that hides its stuck items is how they stay stuck.
- **Both queue screens open on outstanding work, not on everything.** The
  decided and packed rows stay one tab away and `useSavedFilter` remembers
  anyone who prefers that view — but the number on the home screen and the list
  it links to must agree on the first render, which is where somebody actually
  reads them.

## Phase 36 - three mobile applications

- **The product ships as three applications: Shop, Manage and Rider.** This
  supersedes _"A single mobile app will serve all roles via Expo Router
  role-based navigation"_ at the top of this file. The role-based navigation is
  unchanged and still does the work inside each one; what changed is that there
  are now three things to install, with three names, three icons and three store
  listings, because an icon and a store listing cannot be written for everybody
  at once.
- **Every role belongs to exactly one application**, and a test enforces it. A
  role in none has an account that opens nothing; a role in two makes "which one
  do I install?" unanswerable at the moment somebody is deciding.
- **A storekeeper and a sales rep are staff, not their own applications.** Both
  are salaried, both are handed a phone by the same person who hands one to a
  manager. Three was the ask; five would be two more store listings nobody wants
  and two more icons on the same warehouse handset.
- **A rider is separate even though a rider is also staff.** A round is the whole
  job for eight hours, one-handed, outdoors, often on a shared handset. Being
  unable to reach an approvals queue from it is a property of that application,
  not a limitation of it.
- **Each application asks the operating system only for what its own screens
  use.** The Shop application declares no camera and no location. This is not a
  security boundary - the server decides what anybody may read or write - it is
  that there was no honest sentence to put in a location prompt shown to a
  pharmacy owner.
- **Refusing an account that belongs elsewhere is a wrong-download message, not a
  permission error**, and it names the application to install. The check runs
  before anything reaches `SecureStore`, and the session is revoked rather than
  left to expire.
- **The three applications are one EAS project with three bundle identifiers**,
  not three projects. Credentials are keyed by identifier, so one project holds
  all three sets and there is one `eas init` rather than three accounts' worth of
  bookkeeping.
- **`app.config.ts` repeats the three variant names rather than importing
  `@medsupply/navigation`.** Expo evaluates that file before any workspace
  package is built - on a clean EAS worker there is no `dist/` - so the import
  would fail at configuration time. `appVariant.test.ts` is the other half of
  that trade.
- **iOS binaries cannot be produced on this Windows workstation.** They need
  macOS with Xcode or an EAS cloud build, plus an Apple Developer account.
  Android can be built either way.
- **Metro reads the shared packages' TypeScript source, enforced by
  `resolveRequest`.** `extraNodeModules` alone points Metro at a package
  _directory_, and Metro then follows its `package.json` `main` to
  `dist/index.js` - a build produced by whichever unrelated npm script ran most
  recently.

## Phase 37 — MedSupply Shop, the customer application

Measured before anything was written: **a `SHOP_OWNER` may call 55 endpoints and
the application called 22 of them.** Everything below follows from deciding what
to do about the other 33.

### The money

- **No screen works out for itself what a customer will pay.** The basket
  multiplied `defaultSellingPriceMinor` by the quantity — the _list_ price,
  before the shop's discount, their price list, free goods and delivery — while
  submission repriced from `resolvePriceFrom`. The customer was shown one total
  and charged another. `POST /orders/quote` is now the only source of any figure
  with money in it, and `customerMoney.test.ts` makes the arithmetic a build
  failure rather than a habit.
- **The basket stores medicine ids and quantities, never a `Medicine`.** A
  persisted basket that held whole catalogue objects would restore a price that
  was true a week ago, which is the same defect wearing a different hat. The
  migration deliberately discards a basket saved in the old shape.
- **A pro-rated return estimate is allowed and labelled as an estimate.** It is
  arithmetic on `lineTotalMinor` — what the shop was actually charged, computed
  by the server — and not on any catalogue price. What is credited is decided by
  a manager, line by line, and the screen says so.

### The shop's own record

- **A customer maintains their delivery addresses and nothing else about
  themselves.** `POST`/`PATCH`/`DELETE /shops/my/addresses` exist rather than
  opening `PATCH /shops/{id}` to owners, because that endpoint also carries the
  credit limit, payment terms, discount, price list and status. The path is the
  scope.
- **Exactly one address is the default, and the server holds that invariant.**
  `isDefault` is a boolean per element expressing a fact about the array;
  nothing enforced it, so a shop could hold two or none. Removing the default
  promotes its neighbour. A shop with **no** addresses has no default, which is
  a real state — it is what a newly registered pharmacy looks like.
- **Deleting an address is allowed even when it is the last one.** Orders
  already placed carry `deliveryAddressSnapshot`, so nothing in flight can be
  misdirected, and a shop left with none is told plainly at checkout.
- **Twenty addresses per shop.** The array lives inside a document read by the
  order screen, checkout, the customer list and every invoice snapshot; an
  unbounded list is a document that grows until something that reads it is slow.

### Self-registration

Raised as inappropriate for a wholesale product — credit terms, licence checks
and price lists are the distributor's decisions — and built because that was the
answer. The design is what makes it defensible:

- **The shop is created `ACTIVE`.** `orderController` refuses a submission from
  a shop that is not, so any other status produces a customer who can browse and
  never buy — which reads as broken rather than as pending.
- **Credit limit 0, payment terms 0, no discount, no price list**, written from
  constants rather than read from the request. `RegisterShopSchema` does not
  name those fields, so a customer cannot set their own commercial terms even by
  sending them.
- **The safety comes from where the credit check is**, not from the rate limit.
  `approvalService` checks credit at _approval_, so every order this shop places
  lands in a manager's queue and a credit order is refused there until an
  administrator overrides it with a written reason. Registration creates work
  for a manager, not financial exposure.
- **A drug licence number is required**, although `CreateShopSchema` leaves it
  optional. Staff creating a shop have spoken to the customer; nobody has spoken
  to this one, and the licence is the single field checkable against a register.
- **One address, used as both billing and delivery.** A pharmacy registering
  from a phone has one shop at one address, and asking twice on a small screen
  is how a form gets abandoned.
- **Registering does not sign anybody in.** Sign-in is where lockout,
  `forcePasswordChange` and the wrong-application refusal live; a second way in
  that skips all three is a second thing to keep correct.
- **`createdBy` is left unset and the audit names the person themselves.**
  Filling in an administrator would make the record claim a decision nobody
  took.
- **Staff must be able to find these shops before an order does.** The customer
  list gains "waiting for terms", and it is a burn-down: setting a credit limit
  or payment terms takes the shop off it.

### Screens, and which of them are shared

- **The Shop application has its own delivery screen.** `(tabs)/deliveries.tsx`
  is the rider's working board — a rider's active statuses and an offline action
  queue — and a shop owner tapping "Deliveries" was landing on it. "Where is my
  order" is a different screen with different content and no buttons.
- **`delivery-track` and `invoice-detail` are mobile screens and not entries in
  `@medsupply/navigation`.** The shared manifest answers "what exists and who
  may see it" across both clients, and web answers both questions differently
  and correctly: the delivery is rendered inside `order-detail`, and an invoice
  is offered as a PDF from the account. Adding shared ids for mobile's own
  arrangement of the same information would make the manifest describe screens
  web deliberately does not have. `callers.test.ts` covers what those ids would
  have bought — that the endpoints have a caller at all.
- **`addresses` _is_ a shared entry**, because it is a destination both clients
  were missing and both now have.
- **No category filter on the catalogue.** `category` is free text on `Medicine`
  with no enum and no endpoint listing the ones in use, so a filter could offer
  only the categories present in the page already loaded — quietly hiding every
  category that sorts later. It needs `GET /inventory/medicines/categories`, and
  a filter that lies is worse than one that is missing.
- **The mobile language switch lives on the account screen.** Mobile had none at
  all: the catalogue picked a language from the handset and the tenant and
  offered no way to disagree. Each language names itself in its own script, from
  `LANGUAGE_LABEL` rather than the catalogue, because that is the one label that
  must not change when the language does.

### Known, and not fixed here

- **`OrderEntry`'s "add an address" button is staff-facing and writes through
  `PATCH /shops/{id}`, which admits administrators only.** A manager or a sales
  rep pressing it gets a 403. The new `/shops/my/addresses` routes are
  `SHOP_OWNER`-only by design and do not help; the fix is a staff-side route or
  a widening of the existing one, and it belongs with the order-entry screen
  rather than with the customer application.
