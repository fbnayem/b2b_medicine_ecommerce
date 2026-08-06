# Changelog

## Phase 30 — the blank page had a cause, and it was a half-written file

Phase 28 made a failed load say something instead of painting white. This is
what it said, the second time it happened:

> The requested module '/@fs/D:/b2b_medicine/packages/i18n/en.ts' does not
> provide an export named 'en'

The dev server was answering that request with **159 bytes**: a sourcemap whose
`sourcesContent` is `[""]`. It had read `en.ts` while the file was zero bytes,
transformed nothing into nothing, cached the result, and served it from then on.
The file on disk was correct the whole time. The build was clean, every test was
green, and the application would not start.

Any tool that truncates before it writes opens that window — Prettier on commit,
a formatter on save, a script doing `open(path, 'w')`. It is a race, so it bites
occasionally rather than every time, and once it has bitten the only cure is
restarting the server: the file never changes again, so nothing ever invalidates
the empty transform. That is why "restart it" worked twice and fixed nothing.

Two changes, one narrowing the window and one closing it.

`server.watch.awaitWriteFinish` holds a change event until the file has stopped
changing, so the dev server does not act on the truncate.

`viteEmptySource.ts` reads workspace source itself. An empty read is retried for
half a second; a file that is genuinely empty **throws**, naming it. That
distinction is the whole fix: Vite caches a successful transform and does not
cache an error, so returning `""` once poisons the server until it restarts,
while throwing is survivable and says what happened. Proved both ways against a
live dev server — without the guard, an empty `en.ts` is served as 200 and 159
bytes; with it, 500 and the file's name, and the next request after the file is
written recovers on its own.

## Phase 29 — a home screen that knows something

Asked whether I could learn some design skills. The component craft in this
application is not the weak part — the token system, the focus rings, the empty
states and the dark theme are all in place. The weak part is **information
design**, and the home screen was the proof.

### Twenty cards, not one fact

`/dashboard` was a card per destination, describing what each screen is for. On
a manager's account that is twenty cards naming twenty places the sidebar names
too, three centimetres to the left. Opening it told you nothing you did not know
before you opened it.

It now opens with what is waiting: orders needing a decision, orders to pick,
packed orders waiting for a rider, deliveries on the road. A shop owner sees
what they owe and what is on its way to them. The directory stays, below.

Two rules keep those numbers honest, both in `lib/homeSignals.ts`. **A figure
reuses the query key and the URL of the screen it links to** — not a new
endpoint and not a cheaper count — so the number and the list cannot disagree,
the click is served from cache, and every invalidation already written for that
screen keeps this one current. **The navigation manifest decides who sees each
one**, the same source the route guards and mobile read, because a card that
403s on the first screen of somebody's day is worse than no card.

Only queues qualify. There is no "Orders" or "Medicines" figure, because their
totals are inventory of the system rather than work outstanding, and a number
nobody can act on teaches people to stop reading the ones that matter. A zero is
shown but muted: "nothing is stuck" is an answer, and a card that vanishes when
empty moves the three beside it and reads as a fault.

Writing the test for it corrected me. I asserted a shop owner sees no queue at
all; the manifest said they hold `deliveries`, scoped by the server to their own
shop — which makes "out for delivery now" the one queue that is genuinely
theirs, and worth more to a pharmacy than anything else on the screen.

### Two smaller things, on the catalogue

**"Available to order" sat on every card**, so it distinguished nothing and read
as decoration — two centimetres from "In stock", which is a different fact
people then had to work out the difference between. The badge now appears only
when a medicine is delisted. The exception is the news; the rule is not.

The product name's underline ran through the descenders of "Amoxin 500mg" at
that weight. Offset, not removed — it is the affordance.

## Phase 28 — the white blank page, and the front door behind it

Reported as "the system is showing a white blank page". It was, and the cause was
a dev server holding a stale transform of `packages/i18n/en.ts`: the module
evaluated, did not provide the export the catalogue is read through, and the
whole application stopped at that line. `#root` was never touched, so the browser
painted white and put the reason in a console nobody has open. A restart cleared
it. Two other things found on the way did not clear.

### A blank page is now impossible

Everything this application shows arrives through the module graph rooted at
`main.tsx` — the stylesheet and both language catalogues included. So the one
moment you most need it to say something is the moment it has nothing to say it
with. `index.html` now carries its own boot screen in plain CSS, and a classic
script that turns a failed load into a sentence, a copy of what the browser
reported, and a Try again button.

Three details are deliberate. It is **outside `#root`**, because
`expectPageRendered` fails a page whose `#root` has no text in it and putting the
fallback in there would have handed that gate its own words to read. It is
**dismissed by the last statement of `main.tsx`** rather than by a stylesheet or
a timer, so the removal is the thing that proves the application started. And it
is **not translated**, because the catalogue is part of the graph it exists to
cover for — which is exactly what failed this time.

This is the second time the same shape of defect has been reported. The first was
the shared packages resolving to their CommonJS build, where every page died on
`does not provide an export named 'UserRole'`.

### The address of the application was a 404

There was no route for `/`. All fifty-one paths in the manifest are sub-paths, so
the origin itself — what a browser autocompletes to, what a bookmark of the site
is, what a deployment serves at its root — fell through to the catch-all and said
the page did not exist.

It survived because every one of the 116 browser assertions types the path it
wants: `signIn` goes to `/login`, the screens sweep walks the manifest. Nobody
had ever knocked on the front door. `/` now sends a signed-in person to their own
home screen and everybody else to the sign-in form.

### "You are still signed in" was said to people who were not

The not-found screen ended its explanation with that sentence unconditionally,
directly above a button that took the reader to the sign-in form. Both halves now
depend on which is true.

## Phase 27 — a catalogue you can actually run

Four things were asked for. Three turned out to be holes rather than polish.

### You could create a medicine and never afterwards change one

`PATCH /api/v1/inventory/medicines/:id` has been mounted, documented and tested
since the catalogue was built, and **nothing had ever called it**. Three more
endpoints were in the same state: correcting a counted quantity, blocking a
batch, and reading one medicine's stock history. A typo in a stock code, an MRP
nobody recorded, a supplier's new trade price, a line that should be withdrawn —
every one of those was a job for somebody with database access.

The medicine page is now stacked sections — about, price, offers, stock, history
— each with an id and a heading you can link to. What each person sees comes
from four role sets the server enforces separately, not from one guess about
seniority: a storekeeper reads stock and no money, a sales rep reads money and no
stock, a manager reads all of it, a shop owner reads what it is and how many.
The predicate this replaces was `role !== SHOP_OWNER`, which answers `true` for
the rep whom `GET /inventory/batches` refuses.

A price change is one field in the pricing card as well as the full edit form,
because reacting to a supplier's new price should not mean re-satisfying
nineteen controls. Delisting is what "delete" means here — a medicine is named by
every order that ever contained it — and the confirmation says so.

### Nobody understood the fields

The medicine form had nineteen controls, zero hints and zero placeholders. "Sold
as" and "Pack size" with nothing anywhere saying what either meant, and the money
format appearing only after somebody got it wrong.

Every field now carries an example, the rule it needs before typing, and an "i"
you can hover for how it works and what it changes. It is a **Popover, not a
Tooltip** — a Radix tooltip does not open on tap, and storekeepers are on phones.

Writing the first test that pressed Save found that **the form could not be
submitted at all**: the shared schema's optional fields are optional _or_
well-formed, and a control nobody has typed into holds an empty string, which is
neither.

### A change in one place did not reach the others

The catalogue was cached under five key shapes, two of which fetched the same URL
into separate entries. **Twenty-three mutations left the screen you came from
showing the old answer** — approve an order, press Back, it is still in the
queue. Seven realtime events were emitted to the right rooms and thrown away.
And `['delivery-personnel']` was read as a raw array by one screen and as a paged
collection by another under one key with five-minute retention: visit both and
the page died on `.find is not a function`, on the exact picker this phase is
about.

There is one key factory now, hierarchical so a prefix reaches a whole family.
The browser test for it is the one that matters: change a price on a medicine,
press Back, and the catalogue list shows the new figure.

**The cart was a money defect, not a caching one.** It kept whole medicine
objects in browser storage with no expiry and multiplied the stored price, while
submission reprices server-side — so a week-old basket showed one total and
charged another.

### You could not add a person at all

Not "the rider picker lacks a button": **nothing in this product could create a
user.** `POST /api/v1/users` works and is tested; there was no page, no route, no
form. Riders and storekeepers existed because the seed script made them.

There is a real page now, and the same form inside a dialog beside every rider
picker. The argument for the dialog is not convenience — no form here persists a
draft or warns before discarding one, so leaving to create a rider cost the whole
ordered stop list on a half-planned round. The browser spec asserts exactly that:
what was typed is still typed afterwards.

**A manager may now create a delivery person or a storekeeper.** Trip planning is
a manager's job, so making the person who drives it has to be too. The
storekeeper half is wider than the rider case needs and is written down as such
in `ASSUMPTIONS.md`, along with the limit that makes it safe.

### Every picker searches, and every picker can create

Suppliers stopped at fifty, price lists at twenty-five, medicines and shops at a
hundred — each a plain `<select>` over one unpaged page with nothing on screen
saying there was more. Past those counts a record simply could not be chosen
from any form that picks one.

All of them search the server now, and all of them can make the record that is
missing without leaving: medicine on four forms, supplier on the purchase order,
customer on order entry and record-a-payment, delivery address on order entry,
rider on both delivery screens.

`GET /purchasing/suppliers` had no `search` parameter at all — it gained one.

**A shop's delivery addresses could not be added by any screen.** They came from
the seed script, and a customer with no address cannot order at all, so a shop
registered through the product was unable to buy anything. Adding one patches the
whole array, which is the shape the endpoint takes — and `AddressSchema` gained
an optional `_id`, because without it the existing addresses came back stripped
of their identity and Mongoose minted new ones.

### Gates

Two new ones, each proved by planting the defect it claims to catch: every query
key comes from the factory and every mutation invalidates through it, and every
`e2e/*.spec.ts` is selected by a Playwright project — Playwright reports zero
tests for a file no project matches and prints a green run.

One gate had gone quietly blind. Moving to the key factory broke the API path
reconciliation's extraction pattern, and it fell from checking **121 request
sites to 63** with a floor of 60. Floor raised to 110.

`TEST_IDS.toast` had been in the frozen browser-test contract since phase 3 and
nothing ever emitted it. The first spec to use it timed out on an action that had
succeeded.

## Phase 26 — a form that is not finished is not a malfunction

One screenshot: the round-planning form with a rider chosen, a day chosen, notes
typed, and a red **"Something went wrong — Choose a rider, a day, and at least
one stop."** Nothing had gone wrong. The round had no stops on it yet, and the
form said so in the words, the colour and the tone it uses for an unreachable
database.

### Validation stopped wearing the failure card

Four hand-rolled forms did this — planning a round, raising a purchase order,
requesting a return, adding a shop. They now use `FormNotice`: warning-toned
rather than danger-toned, with each requirement listed separately instead of
concatenated into one sentence, and each able to carry the reader to the control
it is about. "Choose a rider, a day, and at least one stop" does not tell
somebody who has already chosen two of the three which one is missing.

The list is derived from form state rather than captured at submit, so it shrinks
as the form is filled in. Focus follows a submit counter, not the list, so
correcting one problem does not yank the cursor away from the field being typed
in. `role="alert"` **and** focus, following the GOV.UK error summary.

The rest of the round form was fixed at the same time. Its availability list
rendered "Nothing is waiting to go on a round" for **three different facts** —
loading, failed, and genuinely empty — and the failed case is the worst, because
the reader has no reason to doubt it. It reads through `Resource` now. The list
is filtered by the chosen rider and never said so, so a screen showing nothing
while another rider had six stops was telling the truth about the query and a lie
about the business. And when no delivery is assigned to anybody there is no round
to be planned at all: the screen says that at the top, with a link to where the
work actually starts, rather than after somebody has picked a vehicle and typed
notes.

### Every error card in the browser was English

`ErrorState` defaulted its title to the literal `'Something went wrong'`, its
button to `'Try again'` and its support line to `'Quote this reference if you
contact support'`. `LoadingState` said `'Loading'`. `Resource` and `DataTable`
said `'Nothing to show yet'`.

All six sentences have existed in Bangla in `packages/i18n` since the localisation
phase, and `apps/mobile/src/components/Feedback.tsx` has always read them — the
same component, in the same product, translated on a phone and not in a browser.
Nothing caught it: `catalogueKeys.test.ts` checks that every key a component
_asks for_ exists, which says nothing about a component that never asks. No
missing key, no type error, no lint warning — just a language toggle with no
effect on the one surface a confused user stops to read.

`apps/web/src/testing/uiStrings.test.ts` is the gate, proved by restoring
`title = 'Something went wrong'` and watching it name both the string and the
file. `e2e/journey.spec.ts` freezes the screenshot's own scenario: submitting the
round form with no stops must raise `form-notice` and must not raise
`error-state`, proved by planting the old `ErrorState` and watching it go red.

**Tests:** web 235 (28 files), browser 100, API 169 unit / 192 integration / 5
reconciliation, mobile 93. Typecheck, lint and build clean.

## Phase 25 — what the screenshots actually were

Four screens were reported broken. The real number was fourteen, the cause was
not what it looked like, and every automated gate in this repository was green
throughout.

### Thirteen of them were one stale process

The API answering `:5000` had been started thirty-four hours earlier with
`start` rather than `dev`, so it loaded its modules once and never re-read them.
`tsc --watch` kept `dist/` current the whole time; nothing reloaded it. Two later
`pnpm dev` stacks had lost the port to `EADDRINUSE` and **stayed alive anyway**,
because `node --watch` does not exit when its script fails — so the terminal
looked healthy while a day-and-a-half-old binary answered every request.

Six route groups had been added in the meantime: trips, pricing, stocktakes,
warehouses, `/orders/quote` and `/media`. All of them returned 404, and the
client renders a 404 as "That could not be found. It may have been removed." So
a distributor was told their delivery rounds had been deleted, and their
catalogue photographs drew the browser's broken-image glyph. The proof was the
server's own contract: it published **65 paths** where the repository has 167.

Three changes, so this cannot happen quietly again. `dev.mjs` probes the port
before spawning anything and refuses to start when it is taken, naming it.
`server.ts` has an `'error'` listener on `listen` and exits with one sentence
instead of a stack trace that scrolls past in a parallel turbo run. And
`notFoundHandler` no longer answers `NOT_FOUND` for an address that is not
served — that is `NO_SUCH_ENDPOINT`, worded as what it is: this build of the
client is asking for something this build of the server does not have.

The port probe is worth one more line. The first version bound `0.0.0.0` and
reported the port free while the API was answering on it, because Windows treats
the IPv4 and IPv6 wildcards as distinct addresses. It now binds exactly as the
server binds — no host — which is the difference between a check and a comfort.

### The notification panel was a stylesheet that had been deleted

`inventory.css` — 1,104 lines — went when the **pages** were migrated onto the
design system. `uiDiscipline.test.ts` globs `../pages/*.tsx`, so `components/`
was never audited, and **thirty-seven class names went on being written for a
file that no longer existed**.

A class that resolves to nothing is not a CSS error. It is silence. So the
notification panel had no position, no background, no z-index and no padding —
it rendered transparently over the page, and Tailwind's Preflight, which zeroes
`h2` and `p` margins and strips `ul` padding, closed the last gaps. That is
where "…submittedShafin Pharmacy submitted an order request.ORDER · 04 Aug 2026"
came from: three inline spans with nothing between them.

Three more components were in the same state and nobody had reported them: the
charts on both analytics screens drew no bars at all, the four credit figures on
the ledger and the shop account were bare label/value pairs, and the history on
the order, delivery and return detail screens was an undifferentiated run of
paragraphs. The same deletion left `invoice-print`, `package-label` and
`receipt-print` orphaned with **no `@media print` block anywhere in the
application**, so a storekeeper printing a package label got the sidebar around
it.

All four are rebuilt on the primitives, the print rules are real, and the panel
is now a portalled Radix popover like the account menu beside it — which also
closes the focus-trap gap `Dialog.tsx` has documented since phase 4.

### A queue of orders could not be scanned

Ten of the twenty-two order statuses rendered in the same blue: submitted, under
review, preparing, packing, packed, invoiced, ready, assigned, handed over,
picked up. Colour that says nothing costs the reader the same as no colour and
takes the space of something useful, so the pill had to be read, one row at a
time.

The lifecycle now reads as phases. `progress` (teal) is work happening inside
the building; `transit` (plum) is work that has left it. Both hues were already
in the chart palette; both clear 4.5:1 against their own background in both
themes, and the parity test now checks each tone against the subtle background
it is actually rendered on — a pairing it had never asserted.

Light mode also had two greys where it needed four: `canvas`, `surface-sunken`
and `surface-hover` were all the same value, so a hovered table row was exactly
the colour of the page behind it.

### The sidebar, and thirty-seven identical rows

`NavItem.icon` has been in `@medsupply/navigation` since the shell was built —
seventeen semantic names, required on all seventy-one entries, "resolved by each
client to its own icon set". Mobile did. The web never read the field, so a
super admin got thirty-seven rows of identical text, all seven groups expanded,
about 1,900px of sidebar that scrolled on every laptop.

Icons now render, groups collapse and remember it, the group holding the current
page is always open regardless, and there is a rail for people who know where
things are. The icons are `aria-hidden` deliberately: six specs match sidebar
links on `getByRole('link', { name, exact: true })`, and a word contributed to
that name would break all of them.

### Nine lists were showing page one and saying nothing

Only six of the thirty list screens rendered pagination. The rest asked for a
collection, received the server's default page — twenty rows for orders — and
displayed exactly that with no indication anything followed. That is worse than
an error: the reader has no reason to doubt it, so last week's order is simply
not there and the screen looks entirely healthy. `usePagedCollection` wires the
`total`, `page` and `limit` the server has always sent, and returns to page one
when a filter changes.

### Three gates, each proved against the defect it claims to catch

- **`orphanClasses.test.ts`** — a class name no stylesheet declares and Tailwind
  cannot generate, across `pages/`, `components/` and `app/`. Proved by putting
  `className="bell-panel"` back.
- **`screens.spec.ts`** — every `NAV_ITEMS` destination, opened as a role
  permitted to open it, asserting no error card, no refused request and no
  broken image. Proved by pointing `TripList` at an address the server does not
  serve. Its first honest run found a real one: `usePasswordPolicy` had been
  calling `GET /settings/security`, which has never existed, and swallowing the
  404 — so the administrative password field always used the floor of eight
  instead of the configured minimum.
- **`apiPaths.test.ts`** — every path the web app requests reconciled against
  `docs/openapi.json`. It passes today; it is prevention, and it exists because
  of how this failure presents: not as a crash, but as a screen telling somebody
  their records were deleted.

The second of those needed correcting before it was worth anything. The first
version asserted `toHaveCount(0)` immediately and **passed with the defect
planted**, because an assertion that something is absent is satisfied instantly
while the request that would produce it is still in flight.

## Phase 24 — the pictures, the specification, and the menu

Three things this project believed were true and were not, each found by
building the gate rather than by reading the code again.

### The catalogue import recorded pictures nobody could fetch

The Arogga import wrote a `productImageUrl` on all fifteen products. The bytes
stayed in the supplier bundle — gitignored, outside the deployment — and the API
served no files at all, so every one of those paths pointed at nothing.

`MEDIA_ROOT` is now a configured directory the importer copies into and the API
serves at `/media`, unauthenticated: both clients render these through an
ordinary image loader, and neither a browser's nor React Native's can attach a
bearer token. What is not relaxed is _what_ may be served — a raster-extension
allow-list checked on the decoded path, so an HTML file dropped into the media
directory cannot become a page executing on the API's origin. Proved by putting
one there next to a picture that is served.

Two traps in that, both silent. `securityHeaders()` sets `no-store` on every
response before any route sees it and `send` will not replace a Cache-Control
that is already present, so `express.static`'s `maxAge` is accepted and ignored;
and setting the header any earlier caches a **404** for a year. Both are
asserted.

### The importer could not have run at full scale

`descriptions.csv` was read whole into one string. That file is ~4.1 million
rows at the documented scale, and `readFileSync` on 812 MB does not run slowly —
it throws `Cannot create a string longer than 0x1fffffe8 characters`. The reader
is now fed chunks and hands each row straight to a callback, with the per-product
text stripped and capped as it arrives rather than after the file is read.

Measured against a synthesised full-scale bundle — 57,015 products, 4.1M
description rows, 812 MB — the whole import completes in **62 seconds inside a
1 GB heap**. One row of the real sample also ends `...</p>\n55:Tcad,<h` inside
its quoted field: the exporter truncated it mid-write, and `/<[^>]+>/` cannot
strip a tag with no `>` to close it.

### `docs/openapi.json` described 72 operations; the source declared 110

Thirty-seven endpoints — including every one added across the last four phases —
existed in the API and nowhere in the document anybody integrating against it
would read. Nothing noticed because every assertion about the specification was
made against `buildOpenApiDocument()`, the live object, which is never stale.

Gating it turned up why it had gone stale twice: **the document was not
reproducible.** `z.toJSONSchema` evaluates a Zod default to produce a JSON Schema
one, which is right for `.default(30)` and wrong for `.default(() => new Date())`
— two request bodies were publishing the moment of the build as a contract
default, so every regeneration produced a diff that meant nothing. Both gates are
proved by planting: drift, and non-determinism.

### A fifth reconciliation: the menu against the router

Three separate hand discoveries of one defect class — a rider who could not open
the delivery board that is their entire job, a rep whose order-entry picker
returned 403, and four more found by sampling twelve of sixty navigation entries
— is the argument for a gate. `navigationRules.test.ts` reconciles what each
screen offers against what `requireRole` admits, screen by screen and mobile tab
by mobile tab. It found five conflicts, and they did not all resolve the same
way:

- **`STOREKEEPER` → Orders and Order detail.** The API was right. A storekeeper
  works from a pick list; the order behind it carries the customer's prices,
  credit terms and discounts. The menu was narrowed.
- **`SALES` → Returns.** The API was right, and for a reason worth stating: a rep
  has no step in the return workflow and cannot even raise one on a customer's
  behalf. Offering the menu item was the worst of both. Taking returns on behalf,
  the way orders already work, is a feature to decide on — not a role to widen
  quietly.
- **`SALES` → Shop detail.** The menu was right. `GET /shops` was opened to reps
  last week, so a rep could see their customers and not tap one. `GET /shops/{id}`
  now admits them, scoped by `territoryPermits` exactly as the list is — a list
  that is scoped behind a detail that is not is scoping that only looks like
  scoping.

Undocumented waivers 78 → 77; the header counts in that file were themselves
stale by 37 and now state 187 routes, 112 covered.

## Phase 23 — the journeys people actually take

The features existed; the screens did not, or existed somewhere nobody stands.

- **Order entry**, and a patch that stopped deleting fields it was not asked
  about. `SALES` and order-on-behalf had been on the server since phase 8 with no
  client able to use them.
- **A rep can see their own customers.** `GET /shops` was management-only, so the
  role added specifically to take orders for somebody else could not list a
  single shop. The list is territory-scoped by the same rule the submission
  enforces, so a picker cannot offer a choice the server will reject.
- **A rep can take an order on the phone they carry** — the mobile order-entry
  screen, deliberately not a port of the keyboard-driven web one, with the
  customer asked for first and remembered, and offline refused out loud rather
  than queued unpriced.
- **Picking by scan**, and a queue that remembers where you were working.
- **Roles reconciled between the specification and the router.** Seventeen
  endpoints disagreed. Sixteen were the document; the seventeenth was
  `GET /inventory/medicines` excluding `SALES`, which broke both order-entry
  screens at the first thing a rep does.
- **The shop owner's own journey documented** — twelve endpoints a customer uses
  end to end, none of which appeared in the published specification.
- **A catalogue that can describe something other than a tablet.** Generic name,
  strength and dosage form are conditional on `classification` rather than
  required on every row, so a distributor can stock a box of nappies without
  inventing clinical data for it.

## Phases 8–13 — the commercial model and the operations around it

- **Phase 8: MRP, price lists, and somebody who can take a phone order.** The
  volume that actually arrives in this trade comes by phone; every order route
  was `SHOP_OWNER`-only and there was no sales role.
- **Bonus schemes.** "10+1" is the standard promotional instrument here and the
  model could not express it at all.
- **The commercial model, reachable by somebody other than curl.** Three of the
  gaps were not "no screen yet" but genuinely unreachable code — `mrpMinor` was
  on the model, in the shared types and read by `marginBasisPoints`, and absent
  from the validation schema, so it could never be set.
- **Phase 10: purchasing, recall and the controlled register made reachable.**
  All built in phase 6, all integration-tested, and in none of the 51 navigation
  items — including the two screens that exist because the operation is
  DGDA-inspected.
- **Phase 11: warehouses, blind stocktakes, and delivery rounds** — a count is
  one event over many batches approved and posted once, not a series of
  single-batch adjustments; and the day's work was the thing missing from
  delivery, which is why riders planned rounds on paper.
- **The rider's round on the phone, in sequence.**
- **Phase 13: an issued document says what it said.** `currencyCode` and
  `currencySymbol` were administrable, and every document rendered through them —
  so changing either restated every invoice ever issued, including ones a
  customer is holding on paper.

## Design system and localisation — one visual language, then a gate

Phases 3 to 5 built UI primitives, a token package and a translation catalogue,
and then almost nothing used them: no page used the table primitive, none called
`toast()`, none called the translation function, and 34 mobile files carried raw
hex including both brand greens the token package exists to collapse. Every web
page and every mobile screen moved onto the system, and skipping it now fails the
build.

The localisation settings were in the same state — `currencyCode` and
`dateFormat` persisted, validated, returned by `/settings/branding`, rendered in
the settings screen, and read by no formatter at all. Choosing `YYYY-MM-DD`
changed nothing anywhere.

## Road to production, phase 7 — documents and the operational floor

The audit that opened this phase was run from a customer's chair rather than an
engineer's, and it moved the risk: nothing here crashes. What it found is that
the artefacts the business hands to a customer were the weakest thing in the
product, and that an operator had no way to learn something had gone wrong.

### The invoice could not be handed to a customer

- **It truncated in silence.** The PDF builder sliced to `(842 - 50) / 16 = 49`
  lines and dropped the rest — no second page, no warning, no error. Measured
  against the real implementation compiled from git history: **200 lines in,
  49 rendered runs out, 151 lost.** An order of more than about 28 items
  produced an invoice the customer signed that did not list what was delivered.
- **It could not print `৳`.** Every character outside ` -~` became `?`,
  so the currency symbol of the country this system operates in — and every
  Bangla name — was unprintable on every document the business issues.
- It had no columns; an invoice line was slash-separated prose.

`pdfService.ts` is now a real layout: measured and wrapped text, pagination with
a repeated table header and `Page n of m`, and an embedded Noto Sans Bengali
subset. That font was chosen against the file rather than its name — the hinted
static builds of the same family carry **no Latin at all**, so `Napa 500` would
have rendered as four empty boxes.

Bengali reorders when it is set: `ট্যাবলেট` lays out as `ট্যাবেলট` because the
E-kar is stored after its consonant and drawn before it. That is the renderer
working. It does mean text selected out of the PDF comes back in visual order,
which is recorded in the file rather than half-fixed.

### The server had never adopted the shared formatters

`@medsupply/utilities` was built in phase 1 and adopted by both clients. The
server was forgotten, so the documents the business actually issues were the
last place in the system rendering `1250000.00 BDT` with no thousands separator
and dating itself by the **UTC** calendar day — which in Dhaka is the previous
one for everything before 6 am. Eight money sites and eleven date sites moved
onto the shared functions, and `formattingDiscipline.test.ts` now fails the
build if either pattern returns.

The same UTC bug had three more homes on the client: two date defaults that
pre-filled _yesterday_ for anyone working before 6 am — when warehouse shifts
start — and a hand-rolled `+6h` offset three lines from a utility that does it
properly. `toDateTimeInputValue` replaced the last of those.

### Backups that have actually been restored

`DEPLOYMENT.md` had asked for "monitored backup restoration" since the hardening
phase, and there was no script behind the sentence. There are two now, and the
drill is the one that matters: it verifies the archive digest **before**
restoring anything, restores into a scratch database, reconciles document counts
against the live one, and asserts every ledger transaction still balances.

The first drill run passed having restored **zero documents** — naming a
database in a `mongorestore --uri` makes it ignore `--nsFrom`/`--nsTo` and
report success anyway. That is why the drill reconciles against the source
rather than merely looking for damage. Corrupting one byte of the archive now
exits 1 with nothing restored.

### Something to look at when the ledger goes wrong

`GET /metrics` serves Prometheus exposition beside the health probes, ahead of
the rate limiter, guarded by a bearer token and refused outright in production
when none is configured. It carries request, latency, error and queue figures,
and one gauge specific to this system:
`medsupply_ledger_unbalanced_transactions`. Every ledger transaction is written
with equal debits and credits; a non-zero value means something wrote to the
collection outside the service. `-1` means the check could not run, which is
deliberately distinct from zero — an alert must not read "the books balance"
when nothing was examined.

Route labels are template paths with identifiers stripped, so a busy deployment
cannot create one time series per order.

### Corrections

The audit's CSV byte-order-mark finding was **wrong**. `toCsv` already emits a
`U+FEFF` BOM and `csvMinor` already uses integer arithmetic; the finding came
from reading the `Content-Type` header instead of the CSV builder.

### Result

452 tests, up from 434.

## Road to production, phases 2-6

Five phases, delivered in one run. The through-line is unchanged from phase 1:
almost everything corrected here was found by running the system, and the things
that were not were found by a guard written during these phases.

### Phase 2 — The verification harness

- The web application had **never been strict-typechecked**. `tsconfig.app.json`
  carried neither `extends` nor `strict`, so the root config's strictness had
  never reached it, while `AGENTS.md` required it and `PHASE_STATUS.md` claimed
  it passed. The existing code already satisfied it — the finding was the absent
  gate, not wrong code.
- CI hand-lists a command per workspace, and for twelve phases nobody added
  `packages/*`, so five packages were checked by nothing. `pipelineWiring.test.ts`
  now reconciles the workflow against the workspace and found all seven gaps
  immediately.
- Route coverage is reconciled against a route table **reflected off the live
  routers**. It found five documented endpoints that do not exist, so a client
  written against the specification would have received 404s. Of 150 routes, the
  gaps are written out endpoint by endpoint — a percentage would have read "88%"
  and named nothing, and the endpoint that mattered was `POST /users`, whose role
  bug survived twelve phases because nothing called it.
- V5 was a **wrong finding** and is recorded as such: `securityRules.test.ts`
  compares the built document's operation count against the source array, so a
  duplicate declaration fails it. The delivery half was worse than described —
  the transition policy table was imported by no service or controller at all,
  so it was documentation the code could contradict silently.
- Registering the coverage middleware revealed that `app.use([])` throws in
  Express 5, which would have stopped the server booting anywhere except under
  test. Found by running the seed.
- The browser suite found three defects on its first run: a wrong password told
  the user **"No refresh token"**; the login form's fields had **no programmatic
  label**; and two greys shipped at 2.47:1 and 3.62:1 against WCAG AA.

### Phase 3 — Design foundation and app shell

- The specified frontend stack had never been installed, while three pages
  including the sign-in screen were written entirely in Tailwind classes that
  resolved to nothing. `index.css` was the Vite starter template, purple accent
  and `#root { width: 1126px }` included, shipped for twelve phases.
- `@medsupply/design-tokens` replaces roughly 141 hex values and **three brand
  greens in simultaneous use**. Its parity test caught two of my own errors: a
  chart series at 2.22:1 on white, and the fact that one chart palette cannot
  serve both surfaces.
- `@medsupply/navigation` holds the permission matrix that was written out three
  times. `App.tsx` went from 208 lines to 68.
- Routes are lazy: one 546 kB chunk became a 472 kB entry plus 47 route chunks.
  `RoleGate` sits outside the lazy boundary, so an unauthorised role never
  fetches the chunk.
- Mobile gained the per-role tab bar `AGENTS.md` has specified since phase 1 and
  the `metro.config.js` it never had — without one the shared packages resolved
  to a `dist` that only npm lifecycle hooks ever build.

### Phase 4 — Closing the dead ends

- **Order cancellation performs the transition `ORDER_STATE_MACHINE.md` has
  promised since phase 4 of the original build.** Nothing anywhere set that
  status; the endpoint stamped a timestamp, announced that the order had been
  cancelled, and dead-ended — so the shop owner saw a confirmation and the
  warehouse picked the order anyway. Cancelling releases the credit reservation
  and the stock allocation in the same transaction.
- Passwords could not be changed at all. `forcePasswordChange` was set, returned
  and rendered as advisory text, and **checked nowhere**, so an administrator's
  temporary password was permanent. The first version of the guard was
  mount-level middleware that **passed every request**, because it ran before
  `requireAuth` set `req.user`; its own test caught that.
- Credit override: two documents disagreed and the code checked nobody's role.
  Settled as an administrator decision.
- All 22 native browser dialogs are gone, including an administrative password
  reset typed in clear text into a `window.prompt`.

### Phase 5 — Language, errors and accessibility

- English and Bangla, with the Bangla catalogue typed against the English one so
  a missing key is a compile error. Numbers stay in Western digits in both,
  because money here is reconciled against printed invoices and both parsers
  accept only `[0-9]`.
- Mobile had **no guard against retrying `/auth/refresh`** and **no request
  timeout**. Both fixed by the shared policy in `@medsupply/api-client`.
- Server error codes reached users verbatim. There is now a catalogue in both
  languages, and `failureReference` surfaces the correlation identifier the
  backend has emitted on every failure since phase 12 and which reached no user.
- All 51 routes shared the title `web`. Titles are per-route, focus moves to
  `<main>` on navigation, and chart series carry dash patterns.

### Phase 6 — Regulatory traceability

- Suppliers, purchase orders and goods receipts. `receiveStock` created
  inventory from nothing, so the system could say where a batch went and never
  where it came from — the half an inspector asks for first. Ordered-versus-
  received variance is recorded rather than silently accepted, and expired stock
  is refused on arrival rather than booked in for FEFO to be trusted to skip.
- `recallService` answers, for any batch, every shop that received it with a
  telephone number, and the supplier, purchase order and receipt it came from.
  Every fact it needs already existed and **nothing had ever asked for them**.
  `invoices.items.batchId` was indexed by nothing, so a recall would have
  scanned every invoice ever issued.
- A prescription-medicine movement return reads `MedicineClassification`, stored
  since the catalogue phase and read by nothing. It compares its own arithmetic
  against the shelf rather than only adding up its own movements.
- Retention archives the audit log to a file with a SHA-256 digest, **reads it
  back and verifies the digest before deleting anything**, and never prunes
  without one.

Batch provenance is nullable on purpose: making it required would have turned
stock physically sitting on the shelf into a validation error. `recallService`
says plainly when a batch predates purchasing, because "we do not know" and
"this arrived before we recorded suppliers" are different answers to an
inspector.

280 tests became 434: 94 API unit, 101 API integration, 122 web, 60 mobile and 57 in a browser.

## Road to production, phase 1 - Production blockers and money correctness

Everything here was found by running the system or auditing it against real
load, not by the 254 tests, the typechecker or the container build, all of
which were green throughout.

- The production database ran with no authentication at all: no `--auth`, no
  credentials, no keyfile. Anything on the Docker network could read and write
  the entire ledger, including every `passwordHash`. It now starts with a root
  account for administration and a separate application account holding
  `readWrite` and `dbAdmin` on one database and nothing else. The replica-set
  keyfile is written inside the container, because a bind-mounted keyfile
  cannot be given `0400 mongodb:mongodb` from a Windows or macOS host and
  mongod exits before logging anything that names the cause.
- Enabling authentication exposed a readiness probe that could not detect its
  absence. A missing credential does not fail at connect - the driver handshake
  needs none - so `readyState` reached 1 and `admin().ping()`, which MongoDB
  answers to anyone, still succeeded. `/health/ready` returned 200 while every
  query failed. It now probes with `listCollections`, which needs the same
  authorisation the application needs, and reports connected-but-unauthorised
  as its own state.
- Credit notes were invisible to the invoice balance. `getInvoiceBalance`
  summed posted payments alone while `receivablesAgeing` also subtracted credit
  notes, so a customer who returned goods was refused their next order by the
  credit check while the ageing report showed them settled. Settlement is now
  derived once, from accounts-receivable movement in the append-only ledger.
  Payment reversals and invoices settled from advance balance are correct as a
  consequence; neither was before.
- The outstanding report issued roughly 17,500 database operations for 500
  shops, and the overdue report ran the whole thing again purely to filter it.
  Both now share one implementation issuing six aggregations regardless of shop
  count, with the overdue filter inside the pipeline and pagination that keeps
  totals global. The manager dashboard no longer launches eight fanned-out
  report functions at once and caches its assembled result for a minute.
- Shop owners could not sign in to the web application: the sign-in handler
  sent them to a path no route declared, so the catch-all returned them to the
  login form with no error shown. An entire role was locked out.
- Nothing redeemed the refresh cookie at start-up, so every reload, new tab or
  browser restart signed the user out mid-order while a live session sat unused
  in the cookie. There was also no sign-out control anywhere in the chrome.
- Ten money formatters became one. Eighteen call sites rendered amounts with no
  thousands separator; others dropped the paisa. Forty-one date call sites never
  passed a time zone and used the device's - invisible on a machine already in
  Dhaka, wrong everywhere else and in CI. `en-BD`, used at most of those sites,
  is not a locale at all and silently resolves to plain `en`.
- Eight `console.*` calls bypassed the redacting logger. The worst was not an
  error path: an unconfigured notification channel printed the whole message
  body, so a deployment that had not yet configured SMS printed every delivery
  OTP in plaintext on the ordinary success path.
- New guards, each demonstrated to fail when the defect it covers is
  reintroduced: `console.*` is permitted only in the logger and in start-up
  validation; every sign-in destination must be a route that exists; the
  receivables reports must stay within a database-operation ceiling; a credit
  note must unblock the customer's next order.

## Phase 12 - Final Security Hardening, Performance and Release Readiness

- Fixed four vulnerabilities carried by earlier phases, each now covered by a test that fails if the fix is reverted: the sign-in response returned the account's bcrypt hash; shop and directory search terms were interpolated into `$regex` unescaped; query parameters were assigned straight into database filters, so `?status[$ne]=` was an injection; and replaying an already-rotated refresh token was answered with an error while the live session kept working.
- Added the security middleware layer: Helmet headers with a self-contained content security policy, a query parser that cannot produce operator objects, recursive body and parameter sanitisation against operator and prototype keys, per-request correlation identifiers, hop-counted proxy trust and tiered request body limits.
- Added tiered rate limiting - sign-in, writes, reports and a global backstop - keyed by user when authenticated, backed by Redis when configured and an identical in-process store otherwise, with standard `RateLimit-*` and `Retry-After` headers.
- Hardened sessions and tokens: access tokens name their session and revocation is enforced on every request and every realtime handshake, refresh tokens are stored as an HMAC with bcrypt still accepted for existing sessions, the refresh cookie is scoped to the auth routes, sessions expire on a TTL index, and sign-in pays the same cost whatever the outcome.
- Added self-service session management for every role: list your own sign-ins, end one, or end them all, on both web and mobile.
- Added structured JSON logging with credential redaction and bounded depth, and an error handler that keeps actionable messages while refusing to leak exception text in production.
- Added an OpenAPI 3.1 document generated from the Zod schemas the server validates with, plus a self-contained API reference served by the API itself.
- Added the indexes the Phase 11 report aggregations needed, a `maxTimeMS` guard on those aggregations, lean list reads, connection pool tuning and response compression, with an integration test that asserts with `explain()` that an index rather than a collection scan serves each report query.
- Added release readiness: split liveness and readiness probes, a version endpoint, an administrator-only runtime status, ordered graceful shutdown with a hard timer, multi-stage non-root Dockerfiles for the API and web, an nginx reference configuration, a production compose file, a GitHub Actions pipeline on Node 20 LTS, and an index verification script that fails a release when an index is missing.
- Moved the web application's API origin out of the source and into a build argument that defaults to a same-origin path.
- Fixed two defects found by running the containers rather than only validating their configuration: the production image did not contain the operational scripts the documented release sequence depends on, and the bootstrap script created the first Super Admin with a password hard-coded in this repository, printed it, and did not force a change.
- Verified the whole deployment on Docker: both images build, the production stack runs with the Redis rate-limit store, the Redis Socket.IO adapter and the BullMQ queue live, and the full integration suite passes against a real MongoDB 6.0 replica set.
- Repaired the operational scripts: every migration ran through a TypeScript loader incompatible with this repository's compiler and could not start. They are now compiled and run with plain `node`, which also surfaced and fixed two latent type errors in the Phase 9 migration.

## Phase 11 - Returns, Reporting and Analytics

- Added the complete customer-return lifecycle: request against an issued invoice, review with per-line approved quantities, collection, warehouse receipt with per-unit disposition, and an immutable credit note posted to the customer ledger.
- Enforced the invoice ceiling across returns, so open requests hold their claim on a line and rejected or cancelled ones release it.
- Added disposition-controlled restocking through the previously unused `returned` stock bucket and five new stock movement types; an expired batch can be received but never restocked.
- Added refund arithmetic that mirrors the invoice in integer minor units — line discount, then a proportional share of the order discount, then tax — with the delivery charge deliberately not refunded.
- Added credit notes with snapshotted identity, a printable PDF and a balanced RETURN_CREDIT ledger posting keyed on the return, so a retried issue cannot double-credit.
- Added order transitions to RETURN_REQUESTED and RETURNED, restoring the interrupted status when a return is rejected or cancelled.
- Added six return notification events, timeline coverage and a `return:updated` realtime event.
- Added sales, sales-by-dimension, order funnel with cycle times, inventory valuation with expiry and dead stock, delivery performance, returns analytics, receivables ageing and a composed analytics overview.
- Added CSV export on every report with a byte order mark and formula-injection neutralisation, downloaded through the authenticated client.
- Added web returns and analytics screens with dependency-free SVG charts each paired with an accessible data table, and mobile returns and analytics workflows.
- Added return-rule, replica-set integration, web component and mobile coverage.

## Phase 10 - System Settings, Configuration and Administration

- Added seven persisted, versioned and audited settings groups covering business identity, finance and credit, inventory, delivery proof, notification defaults, localisation and security policy.
- Added persisted-then-environment-then-default resolution applied per field, with each group reporting where its effective values came from.
- Migrated every business configuration read off environment variables, from invoice tax and identity to credit blocking, OTP lifetime, near-expiry thresholds and the sign-in lockout policy.
- Added per-group optimistic concurrency, group reset to fallback, a policy-free branding endpoint and a `settings:updated` realtime event.
- Added administrative user management with role, status, temporary password reset and session revocation, guarded so an Admin cannot reach privileged accounts, nobody can demote themselves and the last active Super Admin is protected.
- Added sign-in auditing and a read-only, filterable audit log viewer.
- Added web settings, user administration and audit screens, and a read-only mobile settings view for administrators.
- Added a rerunnable migration that seeds only the groups the environment actually configures.

## Phase 9 - Notifications, Real-Time Updates and Activity Timeline

- Replaced ad-hoc notification writes across ordering, approval, fulfilment, delivery, payment and OTP with one templated dispatcher covering a closed catalogue of 26 events.
- Added per-user channel preferences, per-event overrides, muted events and Asia/Dhaka quiet hours; in-app delivery stays mandatory and every suppression is recorded with a reason.
- Added replaceable email, SMS, WhatsApp and Expo push channel adapters, per-channel delivery records, retries with exponential backoff and a sweeper that recovers lost dispatches.
- Added a BullMQ queue that degrades to an identical in-process driver when Redis is absent, plus daily overdue-invoice and near-expiry-stock digests.
- Added a Socket.IO server with token-authenticated handshakes and user, role and shop rooms, and an optional Redis adapter for multi-instance fan-out.
- Added the append-only activity timeline with per-record visibility, order and shop cross-links, and a migration that projects historical audit records into it.
- Added web notification bell, inbox, preferences, activity feed and embedded timelines; delivery views now refresh on realtime signals with polling retained as a fallback.
- Added mobile notification inbox, preferences, Expo push registration with permission handling, deep-link routing, realtime updates and embedded timelines.
- Added notification rule, queue, replica-set integration, web component and mobile flow coverage.

## Phase 8 - Payments, Customer Due and Ledger

- Added pending/posted/failed/reversed Payments, delivery collection verification, proof attachments, cash handover, receipts and exact idempotency/duplicate protection.
- Added immutable balanced Ledger transactions, live Invoice allocation, customer advances, reversals, adjustments, statements, overdue/outstanding/collection reports and reconciliation.
- Invoice packing now posts its charge; credit approvals atomically reserve per-Shop exposure and packing consumes the reservation.
- Added complete internal/Shop Owner web finance workflows and role-based Shop Owner/Manager/Delivery Person mobile finance workflows.
- Added rerunnable legacy-finance scanning/canonicalisation, authenticated request-bound credit-reservation backfill, and expanded financial, integration, web and mobile test coverage.

## Phase 7 - Delivery Assignment and Delivery Application

- Created transactional Delivery records with packages/invoices and human `DEL` references.
- Added assignment/reassignment, workload, custody handover/acknowledgement, pickup, route, arrival, configurable proof, completion, failure and return state actions.
- Added expiring hashed receiver OTP and replaceable local OTP/proof-storage adapters.
- Added web delivery board/details/assignment/handover/failed queue/POD viewer and Shop Owner tracking.
- Added Expo role-based delivery operations with call/map, camera, drawn signature, foreground GPS consent, payment collection capture and offline idempotent retry.
- Added state-policy, API integration, web component and mobile offline-flow tests.

## Phase 6 - Storekeeper Picking, Packing and Invoice Generation

- Added approved, picking, paused, packing, discrepancy, packed, and ready queues.
- Added transactional picking progress, pause/resume, batch confirmation, manager-visible discrepancy blocking and resolution.
- Added packing limits, expired/blocked validation, shortfall reasons, unused-stock release, audit records and notifications.
- Added immutable packed-quantity Invoice and Package entities with configurable supplier/tax/footer snapshots.
- Added A4 and 80 mm thermal print/PDF layouts plus package labels.
- Added responsive web workflows and Expo Storekeeper queue, camera barcode scanning, manual fallback, packing, discrepancy, and ready screens.
- Added unit, replica-set integration, web component, and mobile flow coverage.

## Phase 5 — Manager Review and Approval

- Added manager approval queues and web/mobile review workflows.
- Added transactional full/partial approval, FEFO reservation, picking-list creation, credit/licence gates and optimistic concurrency.
- Added approval notifications, audit history and Docker-backed rollback/concurrency tests.

## Phase 3–4 verification

- Enabled and verified the local MongoDB replica set.
- Added live inventory concurrency and order API integration tests.
- Verified idempotent order replay and cross-shop access denial.

## Phase 4 — Shop Ordering and Cart

- Added stock-neutral carts and server drafts across web and mobile.
- Added order snapshots, estimates, saved-address checkout and idempotent submission.
- Added isolated order history/details, timelines, repeat order and cancellation requests.
- Added in-app order notifications and audit events.

## Phase 3 — Catalogue and Inventory

- Added medicine catalogue, batches, stock states, movements, FEFO allocation, inventory interfaces and operational tests.
