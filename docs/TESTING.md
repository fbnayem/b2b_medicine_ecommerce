# Testing Strategy

Tests must pass before a phase is marked complete.

## Commands

- API unit/service tests: `pnpm --filter @medsupply/api test`
- API transaction/integration tests: `pnpm --filter @medsupply/api test:integration`
- Web component tests: `pnpm --filter @medsupply/web test`
- Mobile flow tests: `pnpm --filter @medsupply/mobile test`
- Browser end-to-end: `pnpm e2e` (smoke only: `pnpm e2e:smoke`)
- Type checks: `pnpm typecheck`
- Production builds: `pnpm build`
- Repository lint: `pnpm lint`

## The end-to-end harness

`pnpm e2e` brings up MongoDB and Redis, runs `apps/api/scripts/seed.ts`, boots the
API from **built output** and the web app from **both** `vite preview` and the
Vite **dev server**, then drives Chrome.

Both web targets are deliberate. The blank-page defect existed only in dev; a
suite that ran against the build alone would have missed it, and a suite that
ran against dev alone would not be testing what deploys.

```bash
docker compose up -d mongodb redis
pnpm e2e                                  # everything
pnpm exec playwright test --project=smoke-preview   # built bundle
pnpm exec playwright test --project=smoke-dev       # dev server
pnpm exec playwright test --project=journey         # tier 1 workflows
```

### Tiers

| Tier                     | Files                   | Contract                                                                                                                    |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1 — domain workflows     | `journey.spec.ts`       | **Must survive the redesign untouched.** Navigates by URL and asserts on text a person reads, never on a class name.        |
| 2 — page-level state     | `smoke.spec.ts`         | Signs in as each role and asserts the page mounted. Stable across restyling.                                                |
| 3 — navigation and shell | `navigation.spec.ts`    | The sidebar, search, account menu, breadcrumbs and dark mode. Rewritten when the shell landed, as budgeted.                 |
| 4 — every screen         | `screens.spec.ts`       | Opens **every** `NAV_ITEMS` destination as a role permitted to open it: no error card, no refused request, no broken image. |
| — accessibility          | `accessibility.spec.ts` | Axe at strict zero across fifteen screens.                                                                                  |

### Why tier 4 exists

Four screens were reported broken by hand; the real number was fourteen, and
every gate in this repository was green throughout. Each was measuring something
adjacent to the problem:

- `smoke.spec.ts` asserts the page mounted — and a page showing "Something went
  wrong" has mounted.
- `expectPageRendered` asserts there are words on the screen. An error card is
  words on the screen.
- `collectConsoleErrors` **filters out `Failed to load resource`**, which is
  exactly what a 404 API call and a broken image produce. That filter is right
  for what it was written for, and it is why a 404-ing screen was invisible.
- `accessibility.spec.ts` scans nine screens. None of the fourteen.

So tier 4 asserts the two things a person notices and nothing else did: no
`error-state`, and no response in the 4xx/5xx range for a request the page made.
It walks `NAV_ITEMS` rather than a list somebody maintains, so a screen added
next month is covered on the day it is added.

**It waits before it asserts, and that is load-bearing.** The first version went
straight to `toHaveCount(0)` and _passed with a 404 planted_, because an
assertion that something is absent is satisfied instantly while the request that
would produce it is still in flight. Proved by pointing `TripList` at
`/delivery-rounds` and watching the sweep go red — and on its first honest run it
found a real one: `usePasswordPolicy` had been calling `GET /settings/security`,
an address the server has never served, and swallowing the 404 — so the
administrative password field always used the floor of eight rather than the
configured minimum.

### The other two gates added with it

| Gate                                         | Catches                                                                                                       | Proved by                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `apps/web/src/testing/orphanClasses.test.ts` | A class name no stylesheet declares and Tailwind cannot generate — across `pages/`, `components/` and `app/`. | Restoring `className="bell-panel"`.                |
| `apps/web/src/testing/apiPaths.test.ts`      | A path the web app requests that `docs/openapi.json` does not serve.                                          | Renaming `/trips` to `/delivery-rounds` in a page. |

`orphanClasses` is the one that matters most, because it is the gate the
existing `uiDiscipline.test.ts` should have been: that file globs `../pages/*.tsx`
only, so when `inventory.css` was deleted after the pages were converted,
`components/` was never audited and **thirty-seven class names went on being
written for a stylesheet that no longer existed**. Four components rendered
unstyled across seven screens and three print layouts printed the application
chrome around the document. A class that resolves to nothing is not a CSS error;
it is silence.

### The test-id contract

Frozen here **before** the primitives that emit these ids exist, so the redesign
is written against a contract rather than the specs being rewritten around it.
`testIdAttribute` is `data-test`, and the attribute is retained in production
builds.

| Id                                    | Emitted by   | Meaning                                                                           |
| ------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| `app-shell`                           | `AppShell`   | The authenticated chrome mounted.                                                 |
| `app-sidebar`                         | `AppShell`   | Role-filtered navigation.                                                         |
| `app-search`                          | `AppShell`   | Global navigation search.                                                         |
| `app-account-menu`                    | `AppShell`   | Account menu, which owns sign-out.                                                |
| `page-<routeId>`                      | `PageHeader` | One per page, **emitted from the route manifest** so it cannot drift.             |
| `toast` / `dialog` / `dialog-confirm` | primitives   | Exactly one implementation each.                                                  |
| `breadcrumb`                          | `AppShell`   | The trail. **By id, not by accessible name** — the label is translated.           |
| `empty-state` / `error-state`         | primitives   | Distinguishes "nothing here" from "this broke".                                   |
| `row-<reference>`                     | list rows    | The **server-generated domain reference** (`ORD-2026-000001`), never an ObjectId. |

Banned in specs: `inventory.css` class names (they are being deleted),
`nth-child`, and `getByText` for anything translatable (phase 5 adds Bangla).

### Confirming destructive actions

Every confirmation goes through `confirmAction()` in `e2e/fixtures.ts`, and this
is a trap rather than a convenience. Playwright **auto-dismisses native
dialogs**, so a spec written against the 22 `window.confirm` sites still in the
codebase would pass while silently _cancelling_ the action it claims to test —
and would start _performing_ that action the day those become real dialogs.
One helper makes that swap a one-file change instead of a silent change of
meaning in twenty-two specs.

### What the harness was proven to catch

A harness that has not been shown to fail on the bug it was built for is not yet
evidence of anything. Each of these was reintroduced on purpose and the suite
went red:

| Defect reintroduced                                                | Caught by                                |
| ------------------------------------------------------------------ | ---------------------------------------- |
| `SHOP_OWNER` landing on `/shop`, a route that does not exist       | `smoke.spec.ts` — Shop owner signs in    |
| A route added with no integration test                             | `routeCoverage.test.ts`                  |
| A route added and left out of the OpenAPI document                 | `routeCoverage.test.ts`                  |
| `COMPLETE` reachable from `ASSIGNED` in the delivery state machine | `deliveryRules.test.ts`                  |
| An implicit `any` in the web app                                   | `pnpm --filter @medsupply/web typecheck` |
| A duplicate OpenAPI operation                                      | `securityRules.test.ts`                  |
| A package with a script CI does not run                            | `pipelineWiring.test.ts`                 |
| A test file registered with no script                              | `testWiring.test.ts`                     |

### What it found on its first run

Three defects, none of which any of the 280 existing tests could see:

1. **A wrong password told the user "No refresh token."** A 401 from
   `POST /auth/login` was treated as an expired access token, so the refresh
   interceptor ran, failed, and its message replaced "Invalid credentials" —
   while signing the user out of a session they had never established.
2. **The login form's fields had no programmatic label.** `<label>` sat beside
   `<input>` with nothing joining them, so the first field of the application
   was announced as "edit text, blank".
3. **Two muted greys failed WCAG AA** at 2.47:1 and 3.62:1 on white — the
   activity timeline's metadata and every disabled link button.

### Coverage reconciliation

`routeCoverage.test.ts` reconciles four descriptions of the API that should
agree: the routes served, the routes documented, **who each one admits**, and
the routes an integration test reaches. Route hits are **recorded live** by a
middleware under `NODE_ENV=test`, so a test that merely mentions a path in a
string does not count as covering it.

Both gaps are written out endpoint by endpoint in `routeCoverage.waivers.ts`
rather than summarised as a percentage — the endpoint that mattered was
`POST /users`, whose role bug survived twelve phases because nothing called it,
and a percentage would have read "88%" and named nothing. A waiver that goes
stale fails the build, so the lists can only shrink.

**As of 05 August 2026: 187 routes, 0 undocumented, 183 covered by an
integration test — and the four that are not are the four the recorder cannot
see.** Both lists are finished.

What they leave behind is a gate rather than a number. A new route that is
undocumented, or that no test calls, now fails the build the moment it is added.
That is what these lists were always for; a percentage could never have provided
it.

(The route count in this line previously read 165, and the header comments in
`routeCoverage.waivers.ts` read 150. Both were stale — the same drift that left
`docs/openapi.json` describing 72 operations against a source declaring 110.
Counted from `routeTable()` rather than from memory this time.)

Tranches were ordered by what a real user's journey touches rather than by what
was easy, so the riskiest endpoints went first rather than the cheapest.

| Tranche        | Documented | Tested | Suite                               | The rule that would have been wrong quietly                            |
| -------------- | ---------- | ------ | ----------------------------------- | ---------------------------------------------------------------------- |
| Finance        | done       | 18     | `financeIntegration.test.ts`        | Reading a reconciliation must not repair what it measures              |
| Administration | done       | 10     | `administrationIntegration.test.ts` | Signing out everywhere includes the device that asked                  |
| Warehouse      | done       | 10     | `inventoryIntegration.test.ts`      | Damage and quarantine both leave `available`; only one leaves `onHand` |
| Inbox          | done       | 6      | `inboxIntegration.test.ts`          | `read-all` clears what you had seen, not what arrived after            |
| Order journey  | done       | 13     | `orderJourneyIntegration.test.ts`   | A saved draft is stock-neutral until it is submitted                   |
| The last mile  | done       | 14     | `lastMileIntegration.test.ts`       | A rider's board is their own round, not the whole city                 |

The four routes still on the untested list are `/health`, `/health/ready`,
`/health/version` and `/metrics`. They are mounted ahead of the coverage
recorder on purpose — so a degraded process can still answer a probe and a
scraper can still be served while the rate limiter is refusing everything else —
and that position is why the recorder never sees them. All four are exercised in
`hardeningIntegration.test.ts`.

**Documentation reached zero.** The last 77 went in one pass, and could only be
written honestly because the roles assertion checks each `roles` list against the
mounted router as it is added. Keeping the list empty is now the gate's job: a
new route with no `OPERATIONS` entry fails the build rather than joining a
waiver list.

Writing them out surfaced one thing worth acting on. **Four write endpoints
validate their request body by hand rather than through a Zod schema** —
`PATCH /inventory/batches/{id}/block`, `PATCH /shops/{id}/status`,
`POST /shops/{id}/assign-owner` and `POST /shops/{id}/assign-manager` — so they
are the only four operations in the published document with no request shape.
Each is marked where it is declared.

#### The defect this gate was built for, finally caught

`POST /api/v1/users` shipped with a role bug — every account it created silently
took the creator's own role — and it survived twelve phases because no test ever
called it. That endpoint is the reason the waiver lists exist. It had still never
had a test.

`administrationIntegration.test.ts` now opens with one, and its assertion is
phrased to go red against exactly that defect: the created account carries the
role in the **request**, not the role of whoever sent it. Verified by restoring
the original bug (`role: req.user!.role` in `createUser`) and confirming that one
test fails and the other eight do not.

Documentation goes first per tranche because it is the step that makes the next
one honest: writing the summary, the tag and the roles forces somebody to state
what an endpoint is for and who may call it, and the roles are then checked
against the mounted router rather than taken on trust.

#### The roles assertion

Paths agreeing proves the document names real endpoints and says nothing about
who may call them — the column a reader of the specification most depends on.
The roles a `requireRole` guard enforces are published on the guard itself and
reflected off the mounted routers, including guards applied router-wide with
`router.use`, then compared against the `roles` list in `OPERATIONS`.

Adding it found **seventeen** endpoints whose documented permissions were wrong,
one of which was not a documentation error at all: `GET /inventory/medicines`
excluded `SALES`, so both order-entry screens — the web one and the mobile one —
opened with a search box that answered 403 for the only role they were built
for. The other sixteen were corrected in the document, because the router is
what runs.

One thing it deliberately does **not** claim: a route with no role guard may be
documented as `ALL_ROLES` or as public, since the difference is router-level
authentication that this reflection does not read; it only fails when the
document names a _narrower_ set than the server enforces, which is a promise of
a refusal that will not happen.

#### The specification is gated as a file, not only as an object

`docs/openapi.json` is a generated artefact committed on purpose — a
specification change is a contract change and reviewing it as a diff is the
point, which only works if the committed file is the file the code produces. It
was not: **72 operations committed against 110 declared.** Every assertion about
the specification had been made against `buildOpenApiDocument()`, the live
object, which is never stale by construction.

Two separate gates, because they fail for different reasons and the difference
is the diagnosis. One compares the file byte for byte and tells you to run
`pnpm --filter @medsupply/api openapi`. The other builds the document twice and
compares — which is how the real cause surfaced: `z.toJSONSchema` evaluates a
Zod default to produce its JSON Schema counterpart, so two request bodies
defaulting a timestamp to `new Date()` were publishing the moment of the build
as a contract default and making every regeneration produce a diff that meant
nothing. Both proved by planting.

### Navigation reconciliation

`navigationRules.test.ts` is the fifth reconciliation, and the first that looks
at a client: **a screen the navigation offers must be a screen the API will
serve.** `SCREEN_READS` names, per screen, the request it cannot function
without; the roles offered that screen are compared against the roles
`requireRole` admits on that route.

It is deliberately "cannot function without" and not "ever calls" — a screen
that hides an administrator's panel from everybody else is working correctly, so
`security` names the session list a person came to see rather than
`GET /admin/runtime`. Screens with no opening read at all (create forms, the
cart) are listed in `SCREENS_WITHOUT_READS` with the reason, and the test fails
if a screen appears in both lists, in neither, or names an id the navigation no
longer has.

`MOBILE_TABS` is checked separately: a tab bar is a stronger promise than a menu,
a role gets exactly five, and one that leads nowhere is a fifth of the
application gone.

This defect class had already been found by hand three times — a rider who could
not open the delivery board, a rep whose customer picker returned 403, and four
more from sampling twelve of sixty entries. The gate found five conflicts, and
they resolved in both directions: two menus narrowed because the API was right
about what the role should see, and one route widened (with territory scoping)
because the menu was.

The API integration command uses `mongodb-memory-server` as a one-node replica set by default. If `MONGODB_TEST_URI` is supplied, it uses that dedicated external replica-set database instead. The suite drops only the selected integration database before and after execution.

## Current coverage through Phase 8

- Inventory validation, expired receipt, FEFO eligibility/order/shortfall, negative stock, and committed-stock adjustment rules.
- Cart integer arithmetic, immutable price snapshots, shop submission gates, draft immutability, and cancellation eligibility.
- Integer packed-invoice calculations, discount caps, configured tax, deterministic A4/thermal PDF structure.
- Concurrent FEFO reservation, idempotent order submission, Shop Owner isolation, one-winner approval, and failed-approval rollback.
- Concurrent picking start, permission denial, blocked/expired batch rejection, pause/resume, discrepancy notification/resolution, packed limits, unused stock release, unique invoice/package creation, invoice immutability, PDF endpoints, ready queue, and invoice record isolation.
- Web fulfilment queue loading/data/filter/error/retry states.
- Mobile barcode matching and versioned picking/packing payloads, including shortfall reasons.
- Delivery transition-policy metadata, atomic creation, assignment/reassignment, exact handover and acknowledgement gates.
- Assigned-person isolation, pickup/start/arrival actions, expiring OTP verification, proof storage, terminal Order coordination and duplicate completion replay.
- Failed reasons, return custody, Storekeeper receipt and safe post-return reassignment.
- Web delivery loading/filter/error/retry component states.
- Mobile stable idempotency keys, duplicate queue suppression and server-confirmed versus retained offline retry behavior.
- Full, partial and multiple Payment allocation; explicit advance handling; overpayment/unsafe-number rejection; exact integer tax/proration; balanced journals and inverse reversal.
- Atomic credit reservations under two concurrent Order approvals, credit-limit rejection, reasoned Manager override, and Admin-only audited migration backfill with idempotent replay.
- Manual and delivery Payment creation/posting, duplicate request/transaction prevention, attachment storage, cash handover, receipt PDF, reversal permission, Invoice due restoration and immutable Payment/Ledger enforcement.
- Ledger-derived outstanding/overdue and date-filtered statement opening/activity/closing, plus cross-shop Payment/receipt isolation.
- Web payment/collection/account/statement/report loading, action and money parsing; mobile money, collection validation, role navigation and online-only finance flow helpers.

Production web and Android Expo exports are build-level checks, not substitutes for the service, integration, component, and flow tests above.

## Phase 9 coverage

- Template completeness: every catalogued event renders a non-empty title and body from an empty context, with no `undefined` interpolation and no IN_APP in optional defaults.
- Money rendering from integer minor units, including the sub-unit, grouped, negative and non-integer rejection cases.
- Asia/Dhaka quiet hours: UTC-to-local conversion, windows that wrap past midnight, same-day windows and the disabled case.
- Channel resolution: in-app is never suppressed; an event override beats the account default; quiet hours mute push/SMS/WhatsApp but keep email; CRITICAL events bypass quiet hours; template defaults apply when no preference is saved.
- Dedupe and idempotency key derivation across recipients, events, occurrences and channels.
- Queue behaviour: exponential backoff, the attempt limit, and job-id deduplication in the in-process driver.
- Replica-set integration: one in-app record plus one delivery row per channel; replayed occurrences create nothing new; a muted event keeps only the in-app row; inbox isolation, unread counts and cross-user mark-read returning zero; saved preferences changing the channels of a later notification; push token migration between users and dispatch to active devices only; a malformed push token being rejected before it reaches the provider; activity timeline visibility for two shop owners and an internal role; append-only activity dedupe; the sweeper recovering an orphaned PENDING delivery; and the admin test-send being closed to Managers.
- Web components: bell badge and dropdown, a realtime push incrementing the badge, retry on load failure, signed-out rendering, notification list mark-read, category filtering, preference override saving, muted-event control disabling, and timeline populated/empty states.
- Mobile flows: Android channel creation before the permission prompt, no re-prompt when already granted, declined permission, emulator detection, provider failure surfaced rather than thrown, sign-out unregistering exactly the session's token without blocking on failure, push link-to-route mapping including the unknown-link fallback, iOS platform handling, preference resolution and toggling, and realtime origin derivation.

## Phase 10 coverage

- Settings resolution: built-in defaults with nothing configured; environment values overriding per field; an untouched field in an overridden group keeping its default; unusable values (a non-numeric tax rate, an out-of-range near-expiry window, an unknown delivery proof, a whitespace-only business name) falling back instead of propagating.
- Group source reporting: an override is reported only when an environment variable is actually set, and a whitespace-only value is not treated as a configuration decision.
- Group schemas rejecting a tax rate above 100%, a fractional basis point, a zero or oversized near-expiry window, a zero-minute OTP lifetime, a too-short password minimum and an under-length business name.
- Localisation: an unknown IANA zone rejected, currency code normalised to upper case, and Bangla accepted so enabling it later needs no schema migration.
- Administrative guard rails as pure decisions: an Admin refused against a privileged target and against granting a privileged role, self role change and self deactivation refused, ordinary edits allowed.
- Replica-set settings integration: effective values with provenance and versions; a saved group becoming effective and reported as persisted; a stale version rejected while the first save stands; invalid settings never reaching the domain; saved settings changing delivery proof requirements and OTP lifetime without a restart; a reset restoring the fallback and keeping the discarded values in the audit; settings administration closed to Managers while branding stays open and policy-free.
- Replica-set administration: an Admin blocked from administering a Super Admin and from granting a privileged role while an ordinary promotion succeeds; the last active Super Admin protected from demotion and deactivation; a role change revoking sessions and writing a role-change audit record; a password reset forcing a change, signing out sessions and never recording the password; a temporary password refused against the configured minimum; sign-in outcomes audited with lockout following the configured policy and no password in the log; the audit log filterable by administrators and closed to Managers; the user directory searchable, escaping regular-expression metacharacters and never returning a password hash.
- Web components: settings rendered with provenance and saved with the correct version; a concurrent change explained and reloaded; reset offered only for a group with a saved override; permission denial surfaced instead of an empty form; a role change issued through the API; own-account controls disabled; a server refusal surfaced; a Manager read-only view; audit records listed and expanded on demand; audit permission denial explained.
- Mobile helpers: every value type rendered as an operator reads it, an unset optional field distinguished from an empty collection, quiet hours rendered as a window rather than raw JSON, unknown fields still rendered rather than disappearing, and each provenance label.

## Phase 11 coverage

- `returnRules.test.ts`: 17 unit tests covering the transition table's completeness, the role and state gates, the derived approve/partial/reject outcome, how open and closed returns claim invoice quantity, the disposition guards including the expired-batch restock refusal, and every money path — proportional line discounts, order-discount sharing, tax proration, the delivery charge deliberately not being refunded, and the cumulative credit ceiling.
- `returnsIntegration.test.ts`: 14 replica-set integration tests covering the full lifecycle from request to credit note, a partial return crediting only what arrived, an expired batch being written off rather than restocked, the invoice quantity ceiling across several returns, a cancellation releasing its claim, cross-shop isolation for both reads and actions, role separation between approving and receiving, idempotent replay of both a receipt and a credit-note issue, stale-version rejection, audit coverage, the report figures, the CSV byte order mark and formula-injection defence, and a Shop Owner's report being narrowed to their own shop.
- 6 web component tests covering the role-specific return list and detail views, the storekeeper disposition form, the stale-conflict reload, and the analytics dashboard including the accessible data table behind each chart.
- 12 mobile helper tests covering the per-role action policy for every status and the local disposition guard that catches an over-receipt or an expired-batch restock before the round trip.

## Phase 12 coverage

- `securityRules.test.ts`: 19 unit tests. The sanitiser's key rules; a body losing its operators while keeping every legitimate field; a prototype-pollution attempt failing to reach `Object.prototype`; dates, buffers and scalars surviving untouched; the query parser proving `?status[$ne]=` cannot become an operator object and that repeated keys collapse to an array; a search term escaped so it matches literally and capped in length. Rate-limit windows counting, resetting and keeping tiers and callers separate. Log redaction removing every credential-shaped field while keeping the rest, with bounded depth, breadth and string length. Access tokens naming their session, tokens of one type failing verification as the other, two rotations of one session producing different tokens, a stored HMAC matching only its own token and never containing it, and a pre-existing bcrypt hash still verifying. The OpenAPI document describing every declared operation with its permissions, carrying the request schema the server enforces, and leaving the health probes unauthenticated.
- `hardeningIntegration.test.ts`: 23 replica-set integration tests against a real HTTP server. No password hash in the sign-in response or the user directory, asserted across the whole payload rather than named fields. The refresh cookie being HTTP-only, `SameSite=Strict` and scoped to the auth routes. Replaying a rotated refresh token revoking every session for that user, writing an audit record and immediately invalidating an unrelated live access token. Revoking a session stopping its access token on the next request. One user's session identifier returning "not found" to another. An unknown account and a wrong password being indistinguishable. An operator in the query string failing to widen a filter and one in a body failing validation instead of reaching bcrypt. A wildcard search matching literally. A list endpoint capping its page size. Security headers present and the server unadvertised. A correlation identifier generated, honoured when well formed and replaced when not. An unknown route, an oversized body and malformed JSON all answering in the standard envelope. A caller over budget receiving 429 with `Retry-After`. The OpenAPI document and its self-contained reference page. The report and audit queries proving with `explain()` that an index serves them rather than a collection scan, and aggregations carrying a server-side time limit. Liveness, readiness and version reporting honestly, the runtime status being administrator-only and containing no secret, and a suspended account being unable to refresh its way past the decision.
- 7 web component tests: each device named in words its owner can recognise, every sign-in listed with the current device marked, a confirmation before ending one, "sign out everywhere" offered only when more than one session is live, the deployment panel shown to an administrator with no secret in it, the session list still usable when that panel cannot be read, and a failure surfaced with a retry rather than an empty screen.
- 7 mobile helper tests: device descriptions for the mobile client and each desktop browser, an honest "unknown" rather than a guess, whether a session can still be ended, list ordering that puts live sessions and the current device first without mutating its input, and the wording that distinguishes a safety revocation from an ordinary sign-out.

One of these was written because the code was wrong. The correlation-identifier test failed first against the middleware refusals: a 401 raised inside `requireAuth` never reaches the error handler, so it carried no identifier and the caller had nothing to quote. Those refusals now attach it themselves.

## Running the integration suites against a real MongoDB

The suites default to `mongodb-memory-server`, which starts a genuine one-node replica set and needs nothing installed. To run them against the Dockerised server instead, set `MONGODB_TEST_URI`:

```bash
docker compose up -d mongodb
cd apps/api
for suite in integration notificationIntegration settingsIntegration returnsIntegration hardeningIntegration; do
  MONGODB_TEST_URI="mongodb://127.0.0.1:27017/it_$suite?replicaSet=rs0" \
    node --require ./dist/services/testEnv.js --test dist/services/$suite.test.js
done
```

One database per suite is required, not optional. Every suite drops its database in its `before` hook, and Node's test runner runs files concurrently, so pointing them all at one database makes them drop it out from under each other. With the in-memory server the question does not arise because each file gets its own instance.

Verified on a real MongoDB 6.0 replica set: 71 passed, 0 failed.
