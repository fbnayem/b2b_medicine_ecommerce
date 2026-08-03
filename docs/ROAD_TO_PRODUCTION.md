# Road to Production — what this branch changes

**Branch:** `road-to-production/phases-0-7`
**Commits:** 18 · **244 files** · +18,888 / −2,004
**Tests:** 254 → **452**

This branch takes MedSupply B2B from "functionally complete" to something a
real, DGDA-inspected pharmaceutical distributor could operate. It is one
document per reviewer question: _what was wrong, what changed, and how do we
know._

---

## Why this exists

MedSupply B2B had 254 passing tests, a green pipeline, a clean production build
and a container deployment that had been run end to end. It also had, at the
same time:

- **MongoDB running with no authentication** in the production compose file.
- A finance report issuing **~17,500 database round trips** per request.
- An order-cancellation flow that **could never cancel an order**.
- **Shop owners unable to sign into the web app at all** — an entire role locked
  out, because the login screen sent them to a route that did not exist.
- The specified frontend stack — Tailwind, TanStack Query, React Hook Form, Zod
  — **never installed**, while three pages including the login screen were
  written entirely in Tailwind classes and therefore rendered as unstyled
  browser-default HTML.
- An invoice PDF that **silently dropped every line past about the 28th**.

None of the 254 tests caught any of it.

The through-line: **nothing exercised the system the way a user or an operator
does.** The tests verified units and API responses. They never booted the app,
never loaded a page in a browser, never ran `pnpm dev`, and never touched 53% of
the route surface. The web app had never even been strict-typechecked.

Everything in this branch is either a defect found by _running_ the system, or a
guard built so the next defect of that class fails the build instead of reaching
production.

---

## How to read this branch

The commits are ordered and each is self-contained. Reviewing them in order is
the intended path; the message on each explains the reasoning, not just the
change.

| #   | Commit    | What it does                                                              | Size         |
| --- | --------- | ------------------------------------------------------------------------- | ------------ |
| 1   | `1f83c69` | Add the GitHub Actions pipeline                                           | 1 file, +118 |
| 2   | `da90000` | Make the documented local development workflow actually work              | 5, +108      |
| 3   | `246e5b1` | Fix user creation refusing every role but the creator's own               | 3, +50       |
| 4   | `75e63f9` | Make the repository's own gates real                                      | 8, +115      |
| 5   | `fb3e7bc` | Make a fresh clone able to start                                          | 3, +13       |
| 6   | `84e8efd` | Route every log line through the redacting logger                         | 8, +171      |
| 7   | `31d3009` | Require authentication to reach the production database                   | 5, +209      |
| 8   | `bfabe2d` | Format money and dates in one place, for both clients                     | 52, +555     |
| 9   | `6d86274` | Let shop owners sign in, and let every session survive a reload           | 11, +355     |
| 10  | `44f4424` | Derive what an invoice owes from the ledger, once                         | 10, +1,034   |
| 11  | `12986d7` | Record what phase 1 changed and what comes next                           | 2, +113      |
| 12  | `f289837` | Make the repository's gates cover the packages and the routes             | 28, +1,510   |
| 13  | `b03f143` | Drive both applications in a browser, as a person does                    | 14, +834     |
| 14  | `bfe8654` | Give the product one visual language and a way to move around it          | 68, +4,270   |
| 15  | `1bf73e4` | Make the workflows that dead-ended actually finish                        | 47, +2,446   |
| 16  | `42ef7da` | Say things in words the people using this can read, in their own language | 22, +1,211   |
| 17  | `78ad8f0` | Answer the two questions a regulator asks                                 | 19, +2,403   |
| 18  | `9f39a29` | Make the documents a customer receives correct                            | 39, +3,793   |

---

## Phase 0 — Secure the ground (commits 1–5)

Committed eight pending fixes plus `apps/api/scripts/dev.mjs`, **without which no
clone could start the API**. Added `.gitattributes` and renormalised line
endings. Added the missing mobile `typecheck` script and changed CI from
`pnpm --filter X typecheck` — which **exits 0 when the script is absent** — to
`run`.

Added `testWiring.test.ts`, which fails the build when a `*.test.ts` file is not
wired into any script. Proved by planting an unregistered test and watching it
go red.

**Verified** by cloning the repository fresh and running `pnpm install && pnpm dev`
for both apps.

## Phase 1 — Production blockers and money correctness (commits 6–11)

The things that cause an incident on day one, or show the wrong number to
someone reconciling against paper.

- **MongoDB authentication** (`docker-compose.prod.yml`): root credentials from
  required env, a mounted keyfile for replica-set internal auth, `--auth`, and a
  least-privilege application user. Redis was already password-protected in the
  same file, so this read as an oversight rather than a decision.
- **Nine `console.*` calls** bypassing the redacting logger — which exists
  specifically to strip `otp|token|password|secret`. A failed BullMQ job embeds
  `job.data`, which for a delivery notification carries the **OTP**. All nine
  replaced; a test now asserts `console.` appears nowhere under `apps/api/src`
  except `env.ts`.
- **One authoritative settlement primitive.** Credit notes were invisible to the
  invoice balance, so a customer who returned goods still showed that invoice
  fully due — and was refused their next order — while the ageing report showed
  them settled. Fixed by having **one** implementation of "what is owed", driven
  from `LedgerTransaction`.
- **The finance N+1s.** `getOutstandingReport` did an unbounded `Promise.all`
  over every active shop, each with a sequential per-invoice balance loop.
  Rewritten on the ledger primitive; verified by asserting a **bounded operation
  count**, not wall-clock, because operation count is what regressed and is
  deterministic where timing is flaky.
- **Session rehydration on web**, so a reload no longer signs the user out
  mid-order — and so the browser harness could exist at all.
- **`landingRouteFor(role)`**, fixing the shop-owner lockout.
- **`@medsupply/utilities`**: one money formatter and one date formatter, both
  pinning `Asia/Dhaka`, replacing ten money formatters and 41 date call sites.
  `formatMinor` never touches `Intl` and never divides in float.

> **Correction recorded during this phase.** The plan proposed driving settlement
> from `customerBalanceDeltaMinor`. That is wrong: it is a _shop-level_ figure
> and is incorrect per invoice in both directions. The implementation uses
> **accounts-receivable movement** instead.

## Phase 2 — The verification harness (commits 12–13)

The phase that changes the trajectory. Everything before it was found by hand;
everything after it should be found by the build.

- **The web app had never been strict-typechecked.** `apps/web/tsconfig.app.json`
  had neither `extends` nor `strict`. Both `AGENTS.md` and `PHASE_STATUS.md`
  claimed otherwise.
- **CI hand-listed commands**, so `packages/*` were typechecked, linted and
  tested by **nothing**.
- **A route-coverage reconciliation test** walking the Express router table and
  asserting three sets agree: every mounted route is in the OpenAPI document,
  every documented path is a real route, and every route is either tested or
  explicitly waived. It found **five documented endpoints that do not exist** — a
  client written against the spec would have 404'd.
- **Playwright**, running the smoke suite against both the preview build _and_
  the dev server, because the blank-page defect existed only in dev.

The browser suite found three defects on its **first run**: a wrong password
told the user _"No refresh token"_; the login fields had no programmatic label;
two greys shipped at 2.47:1 and 3.62:1 against WCAG AA.

> **Correction.** The plan claimed `securityRules.test.ts:209` compared an
> array's length to its own length and could not fail. It compares the _built
> document's_ operation count against the source array — planting a duplicate
> turns it red. The delivery half was worse than described: the transition policy
> table was imported by **no service or controller at all**.

## Phase 3 — Design foundation and app shell (commit 14)

141 hex values and three simultaneous brand greens became one
`@medsupply/design-tokens` package feeding both Tailwind and the mobile
StyleSheets, with a bidirectional parity test. Tailwind v4 CSS-first. Component
primitives with Radix for anything carrying a hard accessibility requirement.
One route manifest replacing a role matrix that was encoded three times.
`App.tsx` went from 208 lines to 68. `React.lazy` split one 546 kB chunk into a
472 kB entry plus 47 route chunks. Mobile gained the per-role tab navigation
`AGENTS.md` had specified since the beginning.

> The parity test caught **two of my own errors** before anyone else could: a
> chart series at 2.22:1 on white, and the fact that one chart palette cannot
> serve both light and dark surfaces.

## Phase 4 — Close the dead ends (commit 15)

Order cancellation now performs the transition `ORDER_STATE_MACHINE.md` had
promised since the original build, releasing the credit reservation and stock
allocation in the same transaction. Self-service password change, with
`forcePasswordChange` actually enforced. Credit override gained the role check
`PHASE_STATUS.md` had always claimed it had. All 22 `window.prompt`/`confirm`/
`alert` calls retired — including an **administrative password reset typed into a
`window.prompt`**, with no `type="password"` and no validation.

> My first `forcePasswordChange` guard **passed every request**, because
> mount-level middleware runs before `requireAuth` sets `req.user`. Its own test
> caught it.

## Phase 5 — Language, errors and accessibility (commit 16)

`@medsupply/i18n` with English and Bangla, the Bangla catalogue typed against
English so a missing key is a **compile error**. Western digits in both locales —
deliberately, because these amounts are reconciled against printed invoices,
bank slips and bKash/Nagad messages, and both money parsers accept only `[0-9]`.
`@medsupply/api-client` filled, unifying the two divergent clients: mobile had
**no refresh guard and no request timeout**, both live bugs, both fixed by one
shared function.

## Phase 6 — Regulatory traceability (commit 17)

`Supplier`, `PurchaseOrder` and `GoodsReceipt`, so stock arriving against an
order carries its provenance and the ordered-versus-received variance is
recorded rather than silently accepted. `invoices.items.batchId` was **required,
populated and indexed by nothing**, so any recall query was a full collection
scan. The acceptance journey passes: receive against a PO, sell to two shops,
recall the batch, and the trace names both shops and the supplier. Plus the
controlled-substance register — `MedicineClassification` had been stored since
the catalogue phase and **read by nothing** — and a retention script that
archives the audit log with a verified digest before pruning anything.

## Phase 7 — Documents and the operational floor (commit 18)

Opened by an audit run from a customer's chair rather than an engineer's.
Nothing it found crashes; what it found is that the artefacts the business hands
to a customer were the weakest thing in the product.

- **The invoice PDF truncated in silence.** Measured against the real
  implementation compiled from git history: **200 lines in → 49 rendered runs
  out, 151 lost.** No page break, no warning, no error.
- **It could not print `৳`.** Every character outside `\x20-\x7e` became `?`.
- Replaced with a real layout: measured and wrapped text, pagination with a
  repeated table header and `Page n of m`, an embedded Noto Sans Bengali subset,
  and a proper column table for invoice lines.
- **The server had never adopted `@medsupply/utilities`**, so the documents the
  business issues were the last place rendering ungrouped money and dating
  themselves by the **UTC** calendar day — which in Dhaka is the previous one
  before 6 am. `formattingDiscipline.test.ts` fails the build if either pattern
  returns.
- **`backup.ts` and `restoreDrill.ts`.** `DEPLOYMENT.md` had asked for
  "monitored backup restoration" since the hardening phase with no script behind
  the sentence.
- **`GET /metrics`** carrying `medsupply_ledger_unbalanced_transactions` — the
  one gauge this deployment should never ignore.

---

## Corrections — where the plan or the audit was wrong

Recorded because a plan that is never wrong is a plan nobody checked.

| Claim                                                     | Reality                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settlement should derive from `customerBalanceDeltaMinor` | Wrong — it is shop-level and incorrect per invoice in both directions. Uses accounts-receivable movement.                                                                                                                                                  |
| `securityRules.test.ts:209` cannot fail                   | Wrong — it compares the built document against the source array. Planting a duplicate turns it red.                                                                                                                                                        |
| The axe scan will fail on first run                       | It passed. Axe measures a different thing than the finding described: it sees contrast, names, roles and landmarks, and cannot see a missing focus trap or an absent live region. Held at strict zero as a regression gate; the rest was done by hand.     |
| The mobile tab group needs a new directory                | The screens were already siblings — sixteen file moves and an import rewrite.                                                                                                                                                                              |
| CSV exports have no byte-order mark                       | **Wrong.** `toCsv` already emits `U+FEFF` and `csvMinor` already uses integer arithmetic. The finding came from reading the `Content-Type` header instead of the CSV builder.                                                                              |
| Assert PDF text extraction equals the input               | Would have **failed against correct output**. Bengali reorders when set — `ট্যাবলেট` lays out as `ট্যাবেলট` because the E-kar is stored after its consonant and drawn before it. The test asserts character coverage through the `ToUnicode` CMap instead. |

Three defects introduced by this work were caught by tests written in the same
phase rather than by a user: a chart series at 2.22:1 on white, two sidebar
entries labelled "Stock" for the same role, and a `forcePasswordChange` guard
that passed every request.

---

## Verification

| Suite                | At the branch point | After Phase 1 | Now                         |
| -------------------- | ------------------- | ------------- | --------------------------- |
| API unit             | —                   | 85            | **105**                     |
| API integration      | —                   | 76            | **102** (+4 reconciliation) |
| Web                  | —                   | 66            | **124**                     |
| Mobile               | —                   | 53            | **60**                      |
| Browser (Playwright) | 0                   | 0             | **57**                      |
| **Total**            | **254**             | 280           | **452**                     |

The per-suite split at the branch point is not recorded; 254 is the figure the
repository reported before Phase 0.

All nine package typechecks and all three app typechecks pass. Route coverage:
**82 of 162** routes exercised by an integration test, **72 of 162** present in
the OpenAPI document, with every remaining gap named individually in
`routeCoverage.waivers.ts` — a list that can only shrink, because a stale waiver
fails the build.

Each guard was demonstrated to fail against the defect it covers before being
trusted. Specific proofs on record: the shop-owner lockout, an untested route,
an undocumented route, an illegal delivery transition, an implicit `any`, a
duplicate OpenAPI operation, an unwired package script, an unregistered test
file, a 200-line document truncated to 49, and a backup archive with one flipped
byte.

---

## Not done — stated plainly

- **Purchasing and recall have API endpoints but no screens.** Services, routes
  and tests are complete; they appear in **none** of the 49 navigation items, so
  they are reachable by `curl` only.
- **Mobile navigation has never run on a device or emulator.** Sixteen screens
  moved into a tab group; file-based routing is asserted by tests only.
- **Bangla covers the shell, navigation, statuses, errors and authentication —
  not page bodies.** Zero of 53 web pages call the translation function.
- No `Recall` record with its own lifecycle.
- No visual-regression baselines.
- `ERROR_REPORTING_DSN` is validated and documented but no adapter is wired.
- The in-process job queue reports `failed: 0` because it keeps no dead-letter
  state; only the BullMQ driver reports a real figure.
- Selecting Bangla text out of a PDF yields visual rather than logical order.
- **No SMS actually sends.** The provider interface is correct and complete, but
  unconfigured it logs — which means delivery OTPs currently reach the server
  log. This blocks go-live independently of everything above.

An audit run at the end of this branch found further gaps that are **planned but
not built** — no order-on-behalf path for phone orders, no MRP, no price lists or
trade schemes, a free-text `genericName` that makes "show me alternatives"
unanswerable, and a dead text index. `C:\Users\User\.claude\plans\` carries the
plan for Phases 8–11; `docs/PHASE_STATUS.md` carries the same list per phase.

---

## Before merging

Seven of these commits touch `.github/workflows/ci.yml`, so pushing needs the
`workflow` OAuth scope:

```bash
gh auth refresh -h github.com -s workflow
git push -u origin road-to-production/phases-0-7
```

After merging, regenerate the API spec — `docs/openapi.json` is a committed
build artefact with no freshness check, and it had already gone stale once
(59 operations, missing the entire purchasing surface added in Phase 6):

```bash
pnpm --filter @medsupply/api openapi
```
