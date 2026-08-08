# Testing Strategy

Tests must pass before a phase is marked complete.

## Phase 43 coverage — the endpoints nobody could reach

Four tests appended to `catalogueContentIntegration.test.ts` for the search
wiring, an assertion pair added to `financeIntegration.test.ts` for the deleted
route, and a new web file `Repairs.test.tsx` (nine tests) for the screens.

| Gate                              | What it holds                                                                                                | Planted to prove it                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search fallback fires             | A term naming no product falls back to the monograph, and the result says `matchedIn: 'productInformation'`. | Fallback disabled → red with "nothing is called 'typhoid', so the only honest answer comes from the monograph".                                                                                       |
| Search fallback does **not** fire | A term that names a product never pays the 451–1,568 ms monograph search.                                    | Asserted on `matchedIn`, which is the only observable difference.                                                                                                                                     |
| An empty search stays empty       | A term nothing knows about does not blame the monograph for an empty screen.                                 |                                                                                                                                                                                                       |
| Browsing is not searching         | A list with no search term carries no `matchedIn` at all.                                                    |                                                                                                                                                                                                       |
| The duplicate is gone             | `GET /payments/my-collections` 404s rather than answering.                                                   | It first returned a **500** — `Payment.findOne({_id: 'my-collections'})` throws an unhandled `CastError` — which is how the pre-existing defect was found. A second assertion covers any mistyped id. |
| Money conversion                  | `250.50` posts **25,050** paisa.                                                                             | `Math.round(taka * 100)` → `Math.round(taka)` → red with "expected 251 to be 25050". A hundredfold error on the one screen that exists to correct a ledger.                                           |
| Repair offered only when needed   | A clean account shows no "Correct it" button.                                                                | Pressing it would post nothing and read as though it had.                                                                                                                                             |
| Role scoping, three ways          | A rep sees no ledger panel; a manager may check but never correct or adjust; a manager sees no test send.    | Each mirrors a `requireRole` on the router, so the button whose only outcome is a 403 never exists.                                                                                                   |
| Test send recipient               | The request carries the signed-in user's id and no other.                                                    | The endpoint accepts any recipient; the screen must never offer that.                                                                                                                                 |
| Suppression vs failure            | A preference holding a message back renders differently from a gateway refusing it.                          | Rendering both as "failed" sends somebody hunting a bug that is one person's switched-off email.                                                                                                      |

### Three gates that caught this work before it passed

Not written this phase — they were already there, and all three fired:

- **`apiPaths.test.ts`** — `/shops/${id}/assign-${kind}` is not an address the
  specification check can resolve. Both paths are now written out.
- **`fieldHints.test.ts`** — four new fields had a label and no hint.
- **`queryKeyDiscipline.test.ts`** — three of the new writes left every screen
  showing what was true beforehand, including a credit reservation, where the
  stale figure is the one somebody approves the next order against.

## Phase 42 coverage — the whole supplier record

Three new integration files — `catalogueContentIntegration.test.ts`,
`relationShapeIntegration.test.ts` and `catalogueActivationIntegration.test.ts` —
plus two unit gates added to `catalogueRules.test.ts`.

| Gate                 | What it holds                                                                                                                          | Planted to prove it                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage order          | The stock `$lookup` runs **after** `$skip`/`$limit`, never before.                                                                     | Lookup moved back above the paging stages → red, with a message naming the cost ("runs once per matched medicine instead of once per row returned"). The first attempt passed misleadingly against stale compiled output, which is the reason a gate nobody has watched fail is not a gate. |
| Paging arithmetic    | Page 3 of 20 skips 40, page 1 skips nothing.                                                                                           | Asserted directly; an off-by-one here silently drops a row between pages.                                                                                                                                                                                                                   |
| Language fallback    | A product with no Bangla returns English rather than nothing.                                                                          | Fires for 2,342 real products — 26,896 carry English, only 24,554 Bangla — so this is a live path, not a courtesy.                                                                                                                                                                          |
| Group ordering       | Sections come back BRIEF → OVERVIEW → QUICK_TIP → SAFETY → BODY → FEATURE, not in storage order.                                       |                                                                                                                                                                                                                                                                                             |
| Safety fields        | `type` and `tag` survive as fields, not as prose.                                                                                      |                                                                                                                                                                                                                                                                                             |
| Body length          | Bodies are **not** truncated.                                                                                                          | The 2,000-character cap that cut the middle out of monographs is what this exists to prevent returning.                                                                                                                                                                                     |
| Relation shape       | Items come back already in rank order, all four kinds round-trip, `PROMOTED` stays its own group so it can be labelled as advertising. |                                                                                                                                                                                                                                                                                             |
| Relation idempotency | Re-importing one product replaces its lists rather than doubling them.                                                                 | This is what the retired unique `(fromId, toId, kind)` index used to provide; delete-then-insert provides it now.                                                                                                                                                                           |
| Activation           | A product the supplier lists as out of stock is still visible to a shop owner, while `listedElsewhere` records what the supplier said. | The 24,188-product defect; the test is its proof.                                                                                                                                                                                                                                           |
| Zero price           | A product priced at ৳0 stays inactive.                                                                                                 | 219 of them; unpurchasable.                                                                                                                                                                                                                                                                 |

### The gate that is not a test

The importer's **row reconciliation** is the evidence for "no information was
lost". It accounts for every row of every source table as imported, folded,
archived or refused, asserts each total against the source count, and sets a
non-zero exit code if any line fails to balance or if a record could not be
parsed. It is run as part of every import rather than kept for release.

Two of the four data-loss defects this phase fixed were found by that counter
and by the importer's "reshaped to fit" report — not by anybody reading the
data. The other two were found by adversarial review of the same work.

## Phase 41 coverage — the real catalogue and its alternatives

`alternativesIntegration.test.ts`, eleven tests. Every gate proved by planting
the defect it claims to catch.

| Gate                         | What it holds                                                           | Planted to prove it                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absent-ingredient guard      | A product with no active ingredient has **no** same-ingredient group.   | Guard removed → exactly one test red. Without it every non-drug becomes an alternative for every other non-drug, which renders as a working feature. |
| Collation                    | `paracetamol` and `Paracetamol` are one drug.                           | `.collation()` dropped → two tests red, including the one that exists solely for a hand-typed lower-case ingredient.                                 |
| Delisted products            | Nothing withdrawn is ever offered, in any group.                        | `isActive: true` removed from the relation join → the withdrawn-product test and the ranking test both red.                                          |
| Supplier ranking             | Rank 1 shows before rank 2.                                             | Covered by the same plant; `$sort` removal alone also turns it red.                                                                                  |
| Strength ordering            | 665 mg never outranks 500 mg when the subject is 500 mg.                | Asserted directly against a fixture carrying both.                                                                                                   |
| Cost privacy                 | A shop owner is never shown `costPriceMinor`, on any card in any group. | Asserted across every item of every group rather than on one.                                                                                        |
| Role                         | A rider gets 403 — they carry what is on the note and do not sell.      |                                                                                                                                                      |
| `callers.test.ts`            | The mobile screen must keep calling the endpoint.                       | Path broken → failure names the capability: "find another brand of the same medicine when the one they asked for has no stock".                      |
| `resetCatalogue.ts` coverage | Every collection in the database is in the clear list or the keep list. | A collection planted into MongoDB → the run refuses and names it. It then caught `medicinerelations` for real.                                       |

### Verified against the live catalogue, not only fixtures

After the import, `alternativesFor` was run against **Napa 125 Suppository** in
the real 55,998-product catalogue: three other manufacturers' Paracetamol 125 mg
suppositories first, then other strengths, then basket affinity — 21 ms across
1.35 million relation rows. Fixtures prove the rules; this proves the indexes.

### Two traps, both of them the machine rather than the code

Both appeared immediately after the import copied 4.2 GB of photography and left
MongoDB holding a 56,000-product catalogue, and both look exactly like a
regression until you check.

**The web suite failed 8 files** with `Cannot find package '@radix-ui/...'` and
`UNKNOWN: unknown error, lstat`. The packages were on disk the whole time — it
is Windows filesystem contention between vitest's parallel workers.
`pnpm vitest run --no-file-parallelism` returns all 43 files and 334 tests.

**`typescript-go` panics inside its own `checkerPool`**, which kills the
Playwright `webServer` before any test runs — and the error it surfaces says
_"The end-to-end suite needs MongoDB and Redis running"_, which is a lie: both
were up. The compiler is Go, so its worker pool answers to `GOMAXPROCS`:

    GOMAXPROCS=2 pnpm exec playwright test

That is the difference between a suite that cannot start and one that runs
clean. If the machine is also short of memory the symptom changes shape again —
V8 reports `Committing semi space failed` at a 38 MB heap, which is not the
process running out of memory but the host.

Neither is worth changing a build script over; both are worth recognising in
under a minute instead of bisecting a phase's worth of work.

### Completing the catalogue — three more gates, each planted

`catalogueShapeIntegration.test.ts` (7) and three more in
`alternativesIntegration.test.ts`.

| Gate              | What it holds                                                                                                  | Planted to prove it                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Gallery           | A product keeps every photograph, and `productImageUrl` equals the first of them rather than drifting from it. | Asserted directly against a three-image fixture.                                                               |
| Branch counts     | A parent's figure is everything underneath it, not only what is filed directly at it.                          | Roll-up replaced with a leaf-only count → two tests red, including the shop-owner one.                         |
| Delisted branches | A shop owner is never offered a branch whose only product is withdrawn; a manager still sees it.               | `isActive` filter dropped from the grouping → the shop-owner test red, the manager test correctly still green. |
| Branch filter     | `?branch=` matches at any depth; `?category=` still means one leaf.                                            | Asserted at two levels of the same trail.                                                                      |
| Shelf fallback    | Offered **only** when nothing better exists.                                                                   | Made unconditional → "the shelf is a last resort" red, the fallback test correctly still green.                |

## Phase 40 coverage — MedSupply Rider

Every gate below was proved by planting the defect it claims to catch, and two
of them caught a live one before any planting was needed.

| Gate                                               | What it holds                                                                                                                                                                                                                 | Planted to prove it                                                                                                                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigation/permissions.test.ts`                   | No role is offered a destination whose data the server will not give it. Reads each screen's `GET`s — its own and those inside the functions it imports — and checks them against `docs/openapi.json`.                        | Caught the live `collections` mismap, naming the destination, the three roles and the endpoint. Then `activity` — permitted to everybody — was pointed at the rider's screen: six roles named, `DELIVERY_PERSON` correctly absent. |
| `navigation/routes.test.ts`                        | No role sees one screen twice under two names, across both menus.                                                                                                                                                             | Found nine live duplicates when the mismap was fixed.                                                                                                                                                                              |
| `api/callers.test.ts`                              | Sixteen rider capabilities now named, each with the sentence saying who is blocked without it.                                                                                                                                | `arrived` pointed at a path that does not exist; the failure read "say they are at the door, which is what turns the proof screen on".                                                                                             |
| `offline/completion.test.ts`                       | A queued completion sends exactly once under the key minted at the door; carries the time the rider finished; holds file paths rather than bytes; keeps the files while the server has not answered; refuses an OTP delivery. | The idempotency key was dropped from the flush — the double-send test went red.                                                                                                                                                    |
| API integration                                    | `deliveredAt` is refused from the future and refused beyond twelve hours; the proof and the payment carry it; the audit action says the completion arrived queued.                                                            | The future bound was removed from the schema — the back-dating test went red.                                                                                                                                                      |
| `home/round.test.ts` + `RiderHome.render.test.tsx` | The next stop is the first _unfinished_ one in the planned sequence; a zero is never rendered.                                                                                                                                | `roundFacts` made to keep zeroes (two red, both suites); `nextStop` made to return the first stop rather than the first unfinished one (four red).                                                                                 |
| `appVariant.test.ts`                               | Each variant strikes out the permissions its libraries would add anyway, and the blocked list cannot contradict the declared plugins.                                                                                         | The live defect: MedSupply Shop's generated manifest declared `CAMERA` and both location permissions.                                                                                                                              |

### A trap worth knowing about

The obvious mock for `useFocusEffect` — `(effect) => effect()` — runs the load
during the **render** phase, so its state updates land outside `act` and React
tears the tree down mid-commit. The error it produces is _"Element type is
invalid… check the render method of RiderHome"_, which points at a component that
is entirely fine and sends you bisecting a working file. The mock defers to
`useEffect`, which is what the real hook does.

### Verified once, not in CI

`expo prebuild` for all three variants, comparing the generated
`AndroidManifest.xml`. Far too slow for a suite, so `appVariant.test.ts` holds the
config-level rule and this is the periodic check that the config still produces
the manifest it claims to. It is what found the permission defect.

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
pnpm exec playwright test --project=manage          # tier 5, writes to the database
```

**A spec no project selects never runs.** Playwright does not warn about it — it
reports zero tests for that file and prints a green run, so the suite is quietly
one file smaller than everybody believes. `apps/web/src/testing/browserSpecs.test.ts`
reconciles every `e2e/*.spec.ts` against the `testMatch` patterns in
`playwright.config.ts` and is proved by planting an orphan.

### Tiers

| Tier                     | Files                                                    | Contract                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — domain workflows     | `journey.spec.ts`                                        | **Must survive the redesign untouched.** Navigates by URL and asserts on text a person reads, never on a class name.                                                                        |
| 2 — page-level state     | `smoke.spec.ts`                                          | Signs in as each role and asserts the page mounted; also the front door (`/`) and the boot fallback, which is why it runs against both web targets. Stable across restyling.                |
| 3 — navigation and shell | `navigation.spec.ts`                                     | The sidebar, search, account menu, breadcrumbs and dark mode. Rewritten when the shell landed, as budgeted.                                                                                 |
| 4 — every screen         | `screens.spec.ts`                                        | Opens **every** `NAV_ITEMS` destination as a role permitted to open it: no error card, no refused request, no broken image.                                                                 |
| — accessibility          | `accessibility.spec.ts`                                  | Axe at strict zero across seventeen screens.                                                                                                                                                |
| 5 — changing things      | `catalogue.spec.ts`, `people.spec.ts`, `pickers.spec.ts` | Writes to the seeded database, so it runs one test after another and each undoes what it did. This is the tier that proves an endpoint has a caller at all rather than that a page renders. |

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

### The boot fallback, and why it is outside `#root`

`index.html` carries a fallback that speaks when the module graph fails to load
at all — the blank white page, twice reported. It is deliberately **outside
`#root`**, and that is a testing constraint rather than a layout one:
`expectPageRendered` fails a page whose `#root` has no text in it, so a fallback
placed inside it would supply the very words that gate reads and switch it off
without anything going red.

Two assertions hold the arrangement up, and they only mean something together:

- blocking every script request must produce a readable failure, not a white
  screen;
- a normal load must leave **no** `#app-boot` on the page, or the first
  assertion would pass against a fallback that sits on top of a working
  application forever.

Both run against the dev server and the built bundle, because the two blank-page
defects this project has had appeared in one target and not the other.

**It waits before it asserts, and that is load-bearing.** The first version went
straight to `toHaveCount(0)` and _passed with a 404 planted_, because an
assertion that something is absent is satisfied instantly while the request that
would produce it is still in flight. Proved by pointing `TripList` at
`/delivery-rounds` and watching the sweep go red — and on its first honest run it
found a real one: `usePasswordPolicy` had been calling `GET /settings/security`,
an address the server has never served, and swallowing the 404 — so the
administrative password field always used the floor of eight rather than the
configured minimum.

### The other gates added alongside it

| Gate                                         | Catches                                                                                                       | Proved by                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `apps/web/src/testing/orphanClasses.test.ts` | A class name no stylesheet declares and Tailwind cannot generate — across `pages/`, `components/` and `app/`. | Restoring `className="bell-panel"`.                |
| `apps/web/src/testing/apiPaths.test.ts`      | A path the web app requests that `docs/openapi.json` does not serve.                                          | Renaming `/trips` to `/delivery-rounds` in a page. |
| `apps/web/src/testing/uiStrings.test.ts`     | An English sentence written as a literal in `components/ui`, where the reader's language should decide it.    | Restoring `title = 'Something went wrong'`.        |

`uiStrings` was added in phase 26 for a defect nothing else could see. `ErrorState`
defaulted its title to the literal `'Something went wrong'`, its button to `'Try
again'` and its support line to `'Quote this reference if you contact support'`;
`LoadingState` said `'Loading'`; `Resource` and `DataTable` said `'Nothing to show
yet'`. Every one of those sentences had a Bangla translation sitting unused in
`packages/i18n`, and `apps/mobile/src/components/Feedback.tsx` was already reading
it — so the same component was translated on a phone and not in a browser.
`catalogueKeys.test.ts` checks that every key a component _asks for_ exists, which
says nothing about a component that never asks: there was no missing key, no type
error and no lint warning, only a language toggle that had no effect on the one
surface a confused user stops to read.

The rule is narrow deliberately — `components/ui` only, and only prose of two or
more words where a reader would see it. A broader "no English anywhere" sweep
would drown in `data-test` values, ARIA tokens and class names, and a gate that
mostly cries wolf is a gate somebody deletes.

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

| Defect reintroduced                                                | Caught by                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| `SHOP_OWNER` landing on `/shop`, a route that does not exist       | `smoke.spec.ts` — Shop owner signs in                 |
| A route added with no integration test                             | `routeCoverage.test.ts`                               |
| A route added and left out of the OpenAPI document                 | `routeCoverage.test.ts`                               |
| `COMPLETE` reachable from `ASSIGNED` in the delivery state machine | `deliveryRules.test.ts`                               |
| An implicit `any` in the web app                                   | `pnpm --filter @medsupply/web typecheck`              |
| A duplicate OpenAPI operation                                      | `securityRules.test.ts`                               |
| A package with a script CI does not run                            | `pipelineWiring.test.ts`                              |
| A test file registered with no script                              | `testWiring.test.ts`                                  |
| The boot guard script deleted from `index.html`                    | `smoke.spec.ts` — an application that cannot load     |
| The boot screen left in place after React mounts                   | `smoke.spec.ts` — the boot screen gets out of the way |
| The `/` route removed again                                        | `smoke.spec.ts` — the bare address of the application |

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

### The suites run one file at a time

`--test-concurrency=1` is in the `test` and `test:integration` scripts, and it is load-bearing. `mongodb-memory-server` starts a real `mongod` and a real replica set per file; run eighteen of those at once and the operating system starts refusing them — `mongod` dies with `fassert() failure` and about eighteen tests fail with `WaitForPrimaryTimeoutError`. The failure looks like a bug in whatever happened to be running at the time, which is what makes it worth pinning here: it is a resource limit, not the code.

## Phase 35 coverage

- `workQueues.test.ts`: 10 web tests. The two halves of each queue — awaiting/decided, outstanding/done — must be **disjoint** and must together cover every status its endpoint can return, so a status added later and classified as neither fails here rather than falling silently out of a number on the home screen. Each tile's URL must equal the request its destination screen makes by default, which is the property that was false: both were unfiltered, and only the tile's _label_ claimed otherwise. Every tile must either carry a filter or name an endpoint that filters server-side, and `/fulfilment/ready` is on that list explicitly so a fifth tile added against an unfiltered endpoint has to justify itself.

## Phase 36 coverage

- `appVariant.test.ts`: 20 mobile tests over `app.config.ts` and `eas.json`, two files nothing else opened and whose failures otherwise surface at the end of a cloud build or after a store review. The three applications must be installable side by side - no shared name, URL scheme or bundle identifier, and the same identifier on both platforms. Identifiers must be valid reverse-DNS and schemes must match the Expo config schema's pattern. A misspelt `APP_VARIANT` must throw rather than silently build the wrong application. Each application must declare the native capabilities its own screens use **and nothing more**, checked against the screens' own imports so that a screen newly reaching for a camera fails the suite. A permission prompt must name the application asking. Every `eas.json` profile must set the variant its name claims, only `production-*` may distribute to a store, and no production build may point at `localhost`. The run-time half asserts that the rider build admits delivery riders, turns everybody else away, and names the application they should install instead - in words that do not mention permission, because the account is fine and the download was wrong.
- `navigationRules.test.ts` gains 4: every role belongs to exactly one application, no application is built for nobody, every tab an application carries can be opened by one of its own roles, and each application carries exactly the tabs its roles are given.

Both were proved by planting the defect: `STOREKEEPER` placed in two applications reported `STOREKEEPER -> staff, rider`; a camera added to the shop application and `production-rider` pointed at the shop each named the exact line.

## Phase 37 coverage — MedSupply Shop

Every gate below was proved by planting the defect it claims to catch, and the
plant is named beside it.

### The two rules that are about the product rather than the code

- `customerMoney.test.ts`: 5 mobile tests over every file in `app/` and `src/`.
  **No screen may do arithmetic on a catalogue price**, and any screen showing
  one must label it as the catalogue's. Both waiver lists are empty. The rule
  reads the source with comments and string literals stripped, because three
  files' doc comments _explain_ the defect — including the fix's own
  `quote.ts` — and a rule that cannot be described in a comment is a rule
  nobody keeps. The stripper has its own self-proof: an early version never
  returned to template mode after `${…}`, so every file after the first
  template read as empty and the rule **passed**.
  _Planted by putting `defaultSellingPriceMinor * quantity` back in the basket._
- `callers.test.ts`: 5 mobile tests. **Every endpoint this application exists to
  reach has something that reaches it**, by method as well as path. This is the
  check that would have caught the measurement this phase started from: a shop
  owner may call 55 endpoints and the client called 22. A server-side coverage
  percentage cannot see it — `routeCoverage.test.ts` reads 100% documented and
  98% tested while a third of a customer's endpoints have no caller on the
  device they use. Each entry carries the sentence that says what a shop loses,
  so a failure reads "a pharmacy can no longer send anything back" rather than a
  file and a line.
  _Planted by pointing the return request at a different path: reported the
  capability, not the file. Written without the method it did **not** fail,
  because `GET /returns` — the list — satisfied the entry for `POST /returns`;
  that near-miss is now its own self-proof._

### The rest

- `shopAddressRules.test.ts`: 8 API tests. Exactly one delivery address is the
  default, expressed as the cases that used to break it — nothing marked, two
  marked, a stale index, an empty list, and the deletion that has to promote a
  neighbour. `hasSoleDefault` is asserted on after every write in the
  integration file, so it carries its own self-proof too.
  _Planted by dropping the "or the first one" fallback: two tests red._
- `shopAddressIntegration.test.ts`: 16 replica-set tests. Adding, correcting,
  promoting and removing; the first address being the default whatever the form
  said; unticking the only default being answered rather than obeyed; an empty
  patch refused rather than written and audited; one owner unable to touch
  another shop's addresses; a manager having no route here at all; an owner with
  no shop told so rather than met with a 500; the twenty-address ceiling; the
  audit trail carrying the previous address; and the reconciliation that makes
  the rest worth running — `GET /shops/my`, which checkout reads, returning
  exactly what these writes stored.
  _Planted by honouring `isDefault: false` literally: "a shop cannot leave itself
  with no default by unticking the only one" went red._
- `registrationIntegration.test.ts`: 15 replica-set tests. The first is the one
  the whole feature rests on — a credit order from a freshly self-registered
  shop is **refused at approval**, and an administrator can let it through only
  with a written reason. Then: the same shop buying prepaid the same day; the
  four commercial terms all at nothing and unsettable from the request; the
  owner being a `SHOP_OWNER` with no forced password change; registration not
  signing anybody in; both records appearing or neither; duplicate email and
  duplicate phone each naming _which_; the licence number being required; a
  non-Bangladesh number refused; the audit naming no member of staff; and the
  "waiting for terms" queue containing the right shops and shrinking when a
  manager sets terms.
  _Planted by giving the new shop a 50,000 credit limit to "get them started":
  five tests red, beginning with the one the argument depends on._
- `registration.test.ts`: 12 mobile tests, of which the last four feed
  **`RegisterShopSchema` itself** the drafts the form calls acceptable — in both
  directions. A client stricter than the server invents a rule nobody wrote down;
  a client looser than it sends a finished ten-field form and gets back a list of
  paths.
- `addresses.test.ts`, `password.test.ts`, `request.test.ts`: 44 mobile tests for
  the rules each screen applies before it asks the server anything. Each ends
  with the same assertion — **every catalogue key the rule can return is a key
  the catalogue holds** — because these reach the screen as `t(problem.key)`,
  a variable, which `catalogueKeys.test.ts` is documented as unable to see.
- `openOrders.test.ts`, `actions.test.ts`, `quote.test.ts`, `cart.test.ts`: the
  judgements the home screen and the basket make, including the basket signature
  that decides when the server is asked to price again — a signature ignoring
  quantity would price a basket once and never again, and one including line
  order would spend a request per keystroke.
- `language.test.ts` gains **spells Bangla with characters that exist**. A
  Bangla string shipped in this phase's first draft containing U+09C9, an
  unassigned codepoint in the Bengali block: `রওনা` became `র৉না`, an empty box
  mid-word. Nothing in the repository could see it — it is a valid string, a
  valid file and a valid render.
  _Planted, and it named `hints.riderInstructions`._

## Phase 38 coverage — the documents, and the endpoints nothing reached

- `documents/names.test.ts`: 11 mobile tests over the two string decisions a
  downloaded file rests on. The one worth reading is **a document reference is
  not a file name** — the reference comes from the server and is joined onto a
  directory path, so `../../../etc/passwd` must not become a write outside the
  cache directory.
  _Planted by removing the sanitiser: five tests red, including the length cap._
- `documents/files.test.ts`: the fetch, the write and the share sheet, with
  `expo-file-system`, `expo-sharing` and the API client all mocked. Asserts the
  three failure paths separately — a failed fetch writes nothing, a failed write
  opens no share sheet, and **an unavailable share sheet still reports the file
  as written**, because telling somebody the save failed when it did not is
  worse than either. Also pins the two request shapes that are easy to get
  silently wrong: the invoice asks for A4 rather than the 80 mm till roll, and
  the credit note asks for `format=pdf` — without which the endpoint answers
  JSON and the `.pdf` written is a valid, saved, useless file.
- `api/callers.test.ts` grows from 16 entries to **22**, adding the four
  documents, the notification archive and the draft discard.
  _Planted twice. Pointing the invoice PDF at `/fulfilment/invoices/{}` instead
  named the capability — "keep or send the invoice document itself" — rather
  than the file. Changing the archive from `post` to `get` failed too, which is
  the same near-miss the method check was added for in Phase 37._
- `testing/apiPaths.test.ts` gains **never puts an API address where a browser
  will fetch it without a token**. `requireAuth` accepts a bearer header and
  nothing else, so an `<a href="/api/v1/…">` renders a 401 as though the
  document did not exist. Comments are stripped before the search, because three
  files now explain this rule by quoting the markup it forbids.
  _Planted by putting the old credit-note anchor back: the gate named the file._
- `shopAddressIntegration.test.ts` grows by six, all on the new staff route. The
  one the route exists for is **adding an address changes nothing else about the
  customer** — it posts a credit limit, payment terms, a status and a discount
  alongside the address and asserts all four are untouched, which is the whole
  argument against having widened `PATCH /shops/{id}` instead. Two more cover
  territory: a rep may write to a customer in their area and not to one outside
  it.
  _Planted by restoring the route to administrators only: the manager test red._
- `appVariant.test.ts` gains **gives every application its own icon, and every
  icon is a real image**. Reads the PNG headers through `import.meta.glob` with
  `?inline` — `?raw` cannot serve this, since a PNG decoded as text has already
  lost the bytes the header is made of — and fails on a missing file, a shared
  file, or one that is not 1024 square.
  _Planted by pointing all three back at one `icon.png`: named the sharing._

### The audit that produced the number

The endpoint sweep behind this phase is not a committed test. It is a scratch
script, and the reason it is not committed is instructive: written with the
strict matcher `callers.test.ts` uses, it reported 84 unreachable endpoints, of
which about sixty were artefacts of paths built from variables. The committed
gate stays strict and explicit — a list of capabilities somebody wrote down —
precisely because the general version is either too loose to gate with or too
strict to believe. See `ASSUMPTIONS.md`.

## Phase 39 coverage — MedSupply Manage

- `navigation/routes.test.ts`: the phase's central gate. **Every destination the
  shared manifest permits a role is either reachable on this client or named in
  `NO_MOBILE_SCREEN`.** It is the defect `callers.test.ts` catches at the
  endpoint layer, one level up: a screen can exist on the server and on web, be
  permitted to a role, and have no way in on the phone — silently, because an
  unwritten screen has nothing to fail. Also checks every route names a file
  that exists, that both maps use ids the manifest actually has, and that the
  waiver list only shrinks.
  _Planted twice. Deleting `MOBILE_ROUTE['collections']` named the destination
  and the three roles that lose it. Restoring the `TAB_ROUTE_FILE` filter on the
  menu gave `expected 13 to be greater than 13` — the original figure, exactly._
- `home/waiting.test.ts`: what the staff home shows and in what order. The order
  is a judgement — people who are blocked before money nobody can collect today
  — so it lives where it can be argued with. **No noughts**: a screen listing "0
  orders to approve" teaches somebody to stop reading it, and the next number
  they skip is a real one.
  _Planted by showing zeroes: red._
- `offline/queueCore.test.ts`: the queue two applications now share. The
  idempotency key is the whole safety property — a flush that timed out _after_
  the server committed confirms a delivery twice, or posts fourteen counted
  units as twenty-eight. Also asserts one refusal does not hold up the thirteen
  behind it, and that a rider's actions and a storekeeper's count sheets do not
  count each other.
  _Planted by fixing the key: two tests red._
- `warehouse/stocktakes.test.ts`: **zero is a real answer**, and the blind count
  stays blind. A rack counted as empty is counted; a progress bar that
  disagreed would send somebody back to count it again.
  _Planted by revealing `systemQuantity` while counting: two tests red._
- `warehouse/purchasing.test.ts`: the goods-in door. Two rules are why the
  screen exists, and both are about weeks later — an expired batch received into
  saleable stock is picked for a pharmacy, and a short delivery accepted without
  a reason stops being a conversation with a supplier and becomes what looks
  like a counting error.
  _Planted by accepting an expired batch: red._
- `pricing/api.test.ts`: `withLine` keeps every other line exactly as it was.
  `PATCH /pricing/price-lists/{id}` replaces the **whole** set, so a helper that
  returned only the edited line would replace a two-hundred-line list with one
  and drop every customer on it back to default pricing. Also pins the taka →
  poisha conversion: `12.005 * 100` is 1200.4999999999998 in IEEE 754.
  _Planted by returning only the edited line: two tests red._
- `financeIntegration.test.ts` grows by four: a rep reads the summary for a
  customer in their own territory, is refused one outside it, and is refused the
  ledger, the invoices and the statement for both — while a manager still reads
  all of them.
  _Planted by adding `SALES` to the ledger route: red._
- `api/callers.test.ts` grows from 22 entries to **35**, adding the warehouse,
  counter and goods-in capabilities. Four of the new ones had no caller on any
  client: `GET /inventory/batches/{id}`, `GET /reports/orders`,
  `GET /reports/stock-movements` and `GET /activity`.
  _Planted by pointing the order funnel at `/reports/overview`: the failure named
  the capability, "see how many submitted orders actually become deliveries"._

### The tier-5 contract, enforced by a cap

`pickers.spec.ts` adds a delivery address while taking an order, and had never
removed it — against a database seeded once. Twenty accumulated and the
twenty-address cap refused the twenty-first, which is the first time a test that
had been quietly violating its own tier contract for phases actually said so.
It now signs in again through the API and deletes what it created; the failure
message is _the address this test added was left behind_.

### A note on the two modules that name their own requests

`reports/api.ts` and `documents/files.ts` each write `apiClient.get('/literal')`
per capability rather than handing a path to a shared fetcher. That is not
style. `callers.test.ts` reads the HTTP method sitting immediately before a path
literal, so a shared fetcher would quietly exempt every one of those endpoints
from the only gate that notices when a capability loses its caller. Both were
written the tidy way first and both were corrected when the gate went red.
