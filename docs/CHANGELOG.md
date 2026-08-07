# Changelog

## Phase 40 — MedSupply Rider, and four things a prebuild found

Asked for: plan the third application, then complete it. Offline completion in
full including cash, the rider home led by the round, and a local Android build
attempted rather than deferred.

### The measurement, and why it is not the one from Phase 39

A `DELIVERY_PERSON` may reach **12** destinations in the shared manifest and all
twelve already had a `MOBILE_ROUTE` and a screen file. Parity was done before
this phase started. Everything below was found underneath it.

### A manager was offered a screen the server refuses them

The shared id `collections` is labelled **"Rider collections"** and is permitted
to `SUPER_ADMIN`, `ADMIN` and `MANAGER` — the desk where the cash a rider hands
in is posted or refused. Phase 39 pointed it at `/(protected)/collections`, which
is the screen a **rider** carries: its only request is
`GET /finance/my/collections`, permitted to `DELIVERY_PERSON` and nobody else.

Every manager in MedSupply Manage had a menu entry that answered 403, and
`collection-review.tsx` — the right screen — sat in the repository with nothing
pointing at it.

Three gates existed and none could see it. `routes.test.ts` asks whether the
destination has a file; it had one. `callers.test.ts` asks whether an endpoint
has a caller; it had one. Between "the screen exists" and "the endpoint is
called" nobody was asking **whether the person being offered the screen may make
the request it opens with**.

`navigation/permissions.test.ts` asks it, for every destination and every role,
against `docs/openapi.json`. Nine duplicate menu entries fell out of the fix:
two menus feed one home screen, and until Phase 39 removed the tab filter they
could not collide. `getFinanceNavigation` now carries only what the manifest has
no id for — a shop owner's invoices, and the rider's own collections.

### Not one thing a rider does was named by the gate that watches for it

`delivery-detail.tsx` wrote ``apiClient.post(`/deliveries/${id}/${step}`)`` and
passed the step in as a string; `return-detail.tsx` did the same. The caller gate
reads the method before a path _literal_, so sixteen endpoints — the whole of a
rider's day — were exempt from it. Deleting the button that tells the office a
rider has reached the shop failed nothing anywhere in the repository.

Third time this shape has been corrected; `documents/files.ts` and
`reports/api.ts` were untangled in Phase 39 and the rider's two busiest screens
were left alone. Sixteen entries added, including `POST /returns/{id}/collect` —
the only way a rider takes back goods a shop is sending, on a screen that already
filtered a rider's list down to exactly that queue and then offered no way to act
on it.

### A delivery can be finished where there is no signal

The queue held every cheap status tap and refused `complete` — the one that ends
the stop, carries the photograph and the signature, and may carry cash. A rider
at a shop door with no bars was told to keep the screen open and try again.

|                     |                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| When it happened    | `deliveredAt` on the completion, bounded to two minutes ahead and twelve hours behind. The payment's `collectedAt` matches it, so cash taken at two in the afternoon is not dated to four. |
| What the audit says | `DELIVERY_CONFIRMED_OFFLINE`, carrying both times. `GET /admin/audit/actions` is built from distinct actions, so it is a filter with no further plumbing.                                  |
| Where the bytes go  | `Paths.document`, not the cache the operating system may reclaim. The queue holds paths; `AsyncStorage` holds a few hundred bytes rather than megabytes.                                   |
| What cannot be held | A delivery whose proof requires an OTP. The code lives on the server, so the screen says so at the door while somebody can still act on it.                                                |

GPS is not network — satellites need no cell tower — so location proof is as
honest offline as on.

### A rider's home was a signpost

A notifications button and a list of links, defended on the grounds that five
tabs already carry a rider's day. The tabs carry the _lists_. The next stop is
now a card with **Call** and **Navigate** on it, and underneath: unsent work
first because the office cannot see it at all, then the cash they are answerable
for, then stops left, then goods still in the van. A zero is never shown.

### MedSupply Shop asked for a camera and a location it has never used

Nobody had ever run `expo prebuild`. Doing it once found this.

Phase 36 made the permission prompts conditional and asserted the shop variant
declares neither plugin. The generated manifest declared `CAMERA`,
`ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` anyway: all three
applications are built from one `package.json`, so both libraries are autolinked
into every one of them and Android's manifest merger folds each library's own
`<uses-permission>` into the app's. Omitting a config plugin removes the _prompt_
and nothing else.

`docs/STORE_LISTINGS.md` declares that MedSupply Shop collects no location. That
would have been either a rejected submission or a false declaration.
`android.blockedPermissions` now strikes them out, derived from the same reason
strings so it cannot drift.

### What a customer's ledger says

`entry.type.replaceAll('_', ' ').toLowerCase()` — so a shopkeeper querying their
account read "invoice charge" and "payment reversal", database values in English
whatever the language was set to, on the screen somebody opens when they think
they have been charged wrongly. Seven `ledgerTransactionType` keys in both
languages, written as what happened: "Goods invoiced", "Payment reversed",
"Credit for goods returned".

## Phase 39 — MedSupply Manage, the staff application

Asked for: plan the second application, then complete it. Full parity chosen.

### The measurement

**A manager may reach 35 destinations in the shared navigation manifest. The
phone offered 13.** A storekeeper 8 of 16, a sales rep 5 of 10.

The mechanism was one line. The home menu was built from
`navItemsFor(role).filter((item) => TAB_ROUTE_FILE[item.id])`, and that map
names the seventeen files which are a **tab for somebody** — so the menu could
only ever offer a destination that happened to be a tab, and everything reached
by pushing was invisible. There was no screen file for any of them either.

One map doing two jobs, and the second — deciding what the whole application
offers — is not one it can do. `MOBILE_ROUTE` now decides where anything is, and
may map several shared ids onto one screen with a parameter: seven analytics
destinations become one screen with a chip row, without the manifest having to
describe a layout web does not have.

`NO_MOBILE_SCREEN` is the honest half — forty destinations named as missing,
with a ceiling that only comes down. **It ends this phase at two**, and both say
why in the file.

### What a warehouse can now do from the floor

|                                     |                                                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Count stock**                     | The most phone-shaped job in the building, and it was web-only: a sheet printed, walked, pencilled and typed up afterwards. Two transcriptions and a chance to lose an hour. |
| **Book a delivery in**              | At the goods-in door, with the batch number and the expiry read off the carton rather than written on paper for later.                                                       |
| **Trace a batch**                   | A recall is somebody standing in front of shelves with a manufacturer's notice. It ends in telephone calls, and now the device that traces the batch makes them.             |
| **Produce the controlled register** | What an inspector asks for, in the stockroom rather than back at a desk.                                                                                                     |
| **See where a batch's units are**   | `GET /inventory/batches/{id}` had no caller on any client. "400 on hand" is not "400 you may sell", and the gap is where stock gets promised twice.                          |

Counting goes to a **queue**, not the network. A warehouse aisle between steel
racking is worse for signal than the lane a rider is in and the cost of losing
the work is higher, so the rider's queue is now shared: one action per line,
each with its own idempotency key, so a refusal loses one count and not a rack.

The sheet stays blind while it is open, and **zero is a real answer** — "there
are none on that shelf" is exactly the finding a count exists to make.

### The two decisions somebody was waiting on

A customer asks to cancel and the request sat on the order screen as a warning
nobody with a phone could answer. A storekeeper reports a picking discrepancy,
the list stops, and restarting it needed somebody to reach a desk. Both
endpoints existed. Neither had a caller here.

### A representative at a counter

The three figures that decide whether to take an order — owed, overdue, credit
left — were management-only, so the answer to "can I take this" was a telephone
call to the office. `GET /finance/shops/{id}/summary` now admits `SALES`, scoped
by the same territory rule the customer list and detail apply, and the check is
in the **controller** rather than only on the route: a rep who may read _a_
summary must not thereby read _every_ summary by pasting an identifier.

The ledger, the invoices and the statement stay closed to them. Widening the
ledger route fails three tests.

### The corrections this phase owes

The Phase 38 endpoint sweep was wrong twice. Its path regex excluded parentheses,
so any template containing a call was truncated and reported unreachable; and
segment counts were compared strictly, so `/fulfilment/picking/${id}/${path}`
never matched a five-segment entry.

Between them those invented four gaps. **The published claim that a picking
discrepancy could be decided from no screen was false** — web has done it since
the fulfilment phase. The corrected figure is thirteen, checked by hand rather
than by the matcher that got it wrong twice, and `PHASE_STATUS.md` now says so.

### What stayed on the desktop, and why

Creating a customer is fourteen fields including their credit limit, and a phone
is the wrong place to set one while somebody is standing in front of you.
Planning a round is a drag on a monitor — though **calling one off**, the action
that matters when a van breaks down, is here.

Two more are shaped rather than skipped. The price-list editor finds one line
and changes one price: two hundred rows on a six-inch screen is a list nobody
can audit before pressing save, on the document that decides what forty
customers are charged. The reports are a few headline figures and one list each,
and the screen says the breakdown is on the web application.

### The one the end-to-end suite found

The browser test that adds a delivery address failed on the last run, and was
right to. Tier 5 promises each test undoes what it did; this one had appended an
address on every run since it was written, against a database seeded once.
Twenty had accumulated, and the cap refused the twenty-first.

The cap did not cause it — it made it visible. The test now removes what it
adds, and **staff gained a delete**: Phase 38 gave them an add and nothing
else, so a manager who mistyped an address could add another and never remove
the first.

### Found, recorded, not fixed

**The web ledger prints a raw enum** — `type.replaceAll('_', ' ').toLowerCase()`,
a database word shown to a person, which is the defect the status pills removed
everywhere else. The mobile ledger shows the server's own description.

### Numbers

Mobile 298 logic tests and 33 render, from 235 and 33. API 182 unit and 238
integration + 5 coverage, from 182 and 231. Web 334. 129 end-to-end with
accessibility at strict zero. Typecheck clean across 14 packages, lint zero
errors.

## Phase 38 — The documents, and the endpoints nothing reached

Asked for: complete the full task — the endpoint gaps left over from Phase 37,
the defect found and left with the staff screen, the icons and the store
listings, and the coverage measurement for the other two applications.

### The measurement, corrected

Phase 37 finished at 45 of 58 endpoints a `SHOP_OWNER` may call. Re-running the
sweep across **both** clients with the same matcher reported 84 endpoints
reached by nothing at all — and that figure was wrong. The matcher requires the
HTTP method beside the path literal, and most call sites build the path from a
variable: `` `/approvals/${id}/${action}` ``. Sixty of the eighty-four were
artefacts.

A segment-aware pass gives **22**, four of them infrastructure and one a false
negative. The seventeen that remain are staff and administrator endpoints, and
they are written down in `PHASE_STATUS.md` rather than quietly dropped.

The correction is the point. A gate that over-reports is not conservative; it is
a gate nobody reads, and the first thing anybody does with sixty false alarms is
stop believing the four real ones.

### Four things a pharmacy could see and could not have

Each of these was rendered on a screen and unobtainable:

|                           |                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The invoice**           | Read line by line since Phase 37, with no way to keep it, print it, or send it to whoever pays the bills                                                |
| **The credit note**       | Its reference printed on the return. The document proving the money came back was reachable only from a desktop — and, see below, not from there either |
| **The proof of delivery** | "Signed for by" was a name typed into a field. The photograph and the signature behind it had **no caller on either client**                            |
| **The payment slip**      | Rendered as the word "Attachment", with nothing behind it                                                                                               |

All four answer with bytes rather than JSON, which is why no screen had ever
used them: there is nothing to render. A phone has no blob URL and no new tab,
so the file is fetched through the ordinary client — interceptor and all — and
written into the cache directory for the share sheet. The proof photograph is
shown in place instead, because the question is _who signed for this_.

The file name is sanitised, because it is a server-supplied reference joined
onto a directory path.

### The credit note did not work on the desktop either

`requireAuth` reads a bearer header and nothing else — no cookie, no query
parameter. The return screen linked at `/api/v1/returns/credit-notes/…` with an
anchor, so **every click opened a tab containing
`{"error":{"code":"UNAUTHORIZED","message":"No token provided"}}`**, on the one
document that proves a customer was credited.

Nothing failed. The anchor rendered, the tab opened, and the error was on the
far side of a click no test performs. Two other screens had each written their
own fetch-and-open helper; there is now one, and `apiPaths.test.ts` fails on any
API address built into a page.

### The 403 that Phase 37 found and left

Order entry's "add an address" wrote through `PATCH /shops/{id}` — administrators
only — so every manager and every sales representative filling that form in got
a 403. The browser test covering the button signed in as an administrator. **The
button worked for exactly the one role that never uses it, and the test proved
it.**

It is now `POST /shops/{id}/addresses`, which adds one address and touches
nothing else. Deliberately not a widening of the patch: that endpoint also
carries the credit limit, the payment terms, the discount, the price list and
the status. A rep who may set a credit limit is a different product. The new
route applies the same territory rule the customer list and the customer detail
apply, and the e2e test now signs in as a manager.

Sending the whole array back also went away with it — a concurrent change by
anybody else was previously overwritten, and a request that lost one element
removed an address while looking like it added one.

### Emptying a basket

There was no way to. Lines came out one at a time, and the saved draft was
removed by nothing, so a pharmacy that saved an order and then changed its mind
left a draft in the distributor's system for a basket that no longer exists —
which the next person to open that customer reads as a pending order.

### Three icons that were one icon

All three applications shipped the Expo template's mark, told apart by a
background colour. That is not enough: an operator can have two installed, they
choose at 48 pixels on a home screen in daylight, and choosing wrong means
taking an order in the rider's application. Each now has a **different
silhouette** — a carton, a clipboard, a pin — which survives greyscale, colour
blindness and Android's monochrome themed-icon treatment. A background colour
survives none of those.

Generated by `scripts/icons.mjs`, sixteen files, committed. Two rounds of
correction that only appeared on inspection: the pin's triangle drawn flush to
its circle grew wings, and a slot across the clipboard's clip left a sliver that
read as a rendering fault.

`docs/STORE_LISTINGS.md` carries all three listings in full. Two items in it are
decisions rather than copy, and both are flagged for a human: the data-deletion
route, and keeping Manage and Rider off public tracks.

### Numbers

API 182 unit and 231 integration + 5 coverage, from 182 and 225. Mobile 235
logic tests and 33 render, from 211 and 33. Web 334, from 333. Typecheck clean
across 14 packages, lint zero errors.

## Phase 37 — MedSupply Shop, the customer application

Asked for: a plan for the Shop app, and then all of it.

### The measurement this phase started from

**A `SHOP_OWNER` may call 55 endpoints. The application called 22 of them.**

Reordering, cancelling, raising a return, reading an invoice, tracking a
delivery, changing a password, managing a delivery address and pricing a basket
correctly were all finished server work with no way to use it. Every test passed
the whole time, because a screen that does not exist has nothing to fail.

### The one that was charging the wrong amount

The basket multiplied `medicine.defaultSellingPriceMinor` by the quantity. That
is the **list** price — before the shop's own discount, before whichever price
list they are assigned, before any free-goods offer and before the delivery
charge. `POST /orders/submit` reprices from `resolvePriceFrom` on the way in, so
**the customer was shown one total and charged another**, and the endpoint that
answers exactly that question, `POST /orders/quote`, had existed since the
order-entry phase with no caller on this client. The web cart was moved onto it
a phase ago; mobile was not.

The arithmetic was correct. The inputs were wrong, so a test asserting the
multiplication would have agreed with the defect. `customerMoney.test.ts` is the
rule instead: no screen may do arithmetic on a catalogue price, and any screen
showing one must say that is what it is.

The basket also lived in memory only, so a phone call during a twenty-line order
lost all of it. It now persists — as ids and quantities, never as `Medicine`
objects, because a restored basket holding whole catalogue records would bring
back a price that was true last week.

### What a shop can now do that it could not

|                          |                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Order it again**       | `POST /orders/{id}/duplicate` — the last delivered order, one tap, into the basket                                                                                                 |
| **Ask to cancel**        | `POST /orders/{id}/cancellation-request`, with the reason the endpoint requires                                                                                                    |
| **Where is it**          | `GET /deliveries/order/{orderId}` on a customer's screen. Tapping "Deliveries" used to open the **rider's working board** — a rider's active statuses over an offline action queue |
| **Read an invoice**      | line by line, with the batch numbers and expiry dates a pharmacist checks against the boxes                                                                                        |
| **Send something back**  | `POST /returns` had **no caller on this client at all**. A pharmacy standing over a damaged carton had to find a computer                                                          |
| **Say where to deliver** | `deliveryAddresses` had one writer, `PATCH /shops/{id}`, which is administrators only                                                                                              |
| **Change a password**    | on the device most likely to be lost, handed on, or read over a shoulder                                                                                                           |
| **Open an account**      | without telephoning anybody                                                                                                                                                        |

### A home screen that answers the questions somebody opens the app to ask

It was a list of buttons with hard-coded English on it, built from raw
`Pressable` and `StyleSheet` rather than the primitives — and it announced the
reader's own role back to them, which is a thing a staff tool does and a shop
does not care about. Three questions instead, in the order they are asked: what
do I owe, what is coming, and can I have that again.

The catalogue stopped at 100 medicines with nothing saying so; it now pages, and
says when the list has genuinely ended.

### Where deliveries go

`isDefault` is a boolean on each element of an array expressing a fact about the
array as a whole: exactly one address is the default. **Nothing enforced it.**
The seed set one, the admin form patched the array wholesale, and a shop could
hold two defaults or none — at which point checkout took
`deliveryAddresses[0]`, document order, which has nothing to do with which one
the shop marked. A pharmacy whose default is their second branch was offered the
first one on every single order.

Three new routes under `/shops/my/addresses`, deliberately **not**
`PATCH /shops/{id}` opened up: that endpoint also carries the credit limit,
payment terms, discount, price list and status, and none of those are a
customer's to set. Every write goes through `soleDefaultIndex`; deleting the
default promotes its neighbour; and where medicines are delivered is audited
with the previous address on the record.

### Self-registration

I raised this as inappropriate — credit terms, licence checks and price lists
are the distributor's decisions, not a stranger's — and was told to build it. It
is built. What makes it defensible is not the rate limit:

- **`orderController` refuses a submission unless the shop is `ACTIVE`**, so a
  self-registered shop must be created ACTIVE or it can browse and never buy.
- **Credit is checked at approval, not at submission.** Every order still lands
  in a manager's queue, and with a credit limit of zero a credit order is
  refused there unless an administrator overrides it in writing.

So it creates work for a manager, not exposure. A shop opens with credit limit
0, payment terms 0, no discount and no price list — written from constants, not
read from the request, and `RegisterShopSchema` does not name them, so a
customer cannot set their own terms even by sending them. The drug licence
number is **required** here although the staff shop form leaves it optional:
staff have spoken to the customer, and nobody has spoken to this one.

The half that makes it safe to operate is on the staff side: the customer list
gains **"waiting for terms"**, and every self-registered shop says so on its
row. Without it a manager meets one of these customers for the first time as a
refused order in the approval queue. It is a burn-down — setting a credit limit
takes the shop off the list.

### The rest of the account

Signing out lived at the bottom of the home screen, which is a strange place for
it and also the reason it had to be there: there was no account menu to put it
in. There is now, with the addresses, the returns, notification settings, the
session list, the password — and a **language switch, which mobile did not
have at all**. Both sign-out buttons now share one sequence, so the push token
is unregistered while the credential authorising it is still valid; without
that, a signed-out counter tablet goes on receiving another pharmacy's order
updates.

### The gates, each proved by planting

| Gate                                | Planted with                          | Caught                                       |
| ----------------------------------- | ------------------------------------- | -------------------------------------------- |
| No arithmetic on a catalogue price  | the list price back in the basket     | the original defect                          |
| Every endpoint has a caller         | the return request pointed elsewhere  | named the capability, not the file           |
| One default address                 | the fallback dropped from the rule    | two unit tests                               |
| …and at the endpoint                | `isDefault: false` honoured literally | "a shop cannot leave itself with no default" |
| Self-registration cannot get credit | a 50,000 limit "to get them started"  | five tests, first the one it rests on        |
| Bangla uses codepoints that exist   | an unassigned one, U+09C9             | `hints.riderInstructions`                    |

That last one was a real defect this phase shipped and then caught: `রওনা`
became `র৉না`, an empty box in the middle of a word. A valid string, a valid
file and a valid render — nothing in the repository could see it.

### Numbers

API 182 unit and 225 integration + 5 coverage, up from 174 and 194. Mobile 206
logic tests and 33 render, from 93 and 33. Web 333. Typecheck clean, lint zero
errors.

## Phase 36 — three applications, one codebase

Asked for: a customer app, a manager/owner app and a delivery rider app.

### They already existed; they were wearing one coat

`apps/mobile` has thirty-nine screens and a per-role tab bar, so all three
products were already built. What did not exist was three of anything a person
can install: one binary called **MedSupply B2B**, one icon, one bundle
identifier, one store listing — and one permission prompt that had to serve a
pharmacy owner and a delivery rider at once.

That last one is the clearest measure of the problem. **Every pharmacy owner was
installing an application that asked for their location**, because one screen in
the building — a rider's proof of delivery — needs it. The prompt could not say
why, because for that person there was no why.

### What shipped

**Three applications**, chosen by `APP_VARIANT` at build time:

|                      | Roles                                | Identifier             | Camera       | Location        |
| -------------------- | ------------------------------------ | ---------------------- | ------------ | --------------- |
| **MedSupply Shop**   | shop owners                          | `com.medsupply.shop`   | —            | —               |
| **MedSupply Manage** | admins, managers, storekeepers, reps | `com.medsupply.manage` | barcodes     | —               |
| **MedSupply Rider**  | delivery riders                      | `com.medsupply.rider`  | proof photos | at confirmation |

Verified against Expo's own resolver rather than against the table: the shop
application's resolved `android.permissions` is **absent entirely**.

`VARIANT_ROLES` in `@medsupply/navigation` is where the split lives, so it sits
beside `MOBILE_TABS` and the rest of the permission matrix rather than in a
build file. Every role is in **exactly one** application, and a test fails if
that stops being true.

**Signing in to the wrong one is answered by name.** A manager who installs the
rider application is told _"This is MedSupply Rider, and your account is not
used here. Install MedSupply Manage and sign in there."_ Not "you do not have
permission" — the account is fine and the download was wrong, and those have
opposite next steps. The check runs **before** anything is written to
`SecureStore`, and the session just issued is revoked on the way out.

**`eas.json`, nine profiles** — development, preview and production for each —
plus bundle identifiers, an Android package name and a URL scheme per
application. None of that existed, so no installable binary could be produced at
all.

**The sign-in screen was rewritten.** It said the literal string "MedSupply
B2B", which is now the name of nothing; every word on it was hard-coded English,
on the one screen everybody sees before they can switch language; and it used
bare `TextInput`s below the 44px tap-target floor.

### Metro has been reading a stale build of every shared package

Found by adding an export to `@medsupply/navigation` and looking for it in
`packages/navigation/dist/index.js`, where it was not.

`metro.config.js` says it resolves the shared packages to their TypeScript
source. It maps each package name to its _directory_; Metro then reads that
directory's `package.json` and follows `main`, which every one of them points at
`dist/index.js`. So what a phone ran was whatever the API's `pretest` last
compiled. Nothing failed, because the stale build still contained everything
mobile used **before** the edit — which is exactly how this hides.

`resolveRequest` now maps the eight package names to `index.ts` directly. The
web app lost a day to the same shape of divergence, and that file's own comment
is the record of it.

### Gates

`navigationRules.test.ts` gains four: every role is in exactly one application,
no application is built for nobody, every tab an application carries can be
opened by one of its own roles, and each application carries exactly the tabs
its roles are given. Proved by putting `STOREKEEPER` in two applications —
`STOREKEEPER → staff, rider`.

`appVariant.test.ts` is new, 20 tests over the two files nothing else opens. It
asserts the three applications can be installed side by side (no shared name,
scheme or identifier), that identifiers and schemes match what the stores
accept, that a permission prompt names the application asking, that each
application declares what its own screens use **and nothing more**, and that an
`eas.json` profile called `production-rider` actually builds the rider. Proved
by giving the shop application a camera and by pointing `production-rider` at
the shop.

### Testing

Mobile 113 (was 93), API 174 unit (was 170). Web 332, integration 194 and the
browser suite unchanged.

### Not done

Three icons — all three share `assets/icon.png` today and are told apart only by
the adaptive-icon background, which is enough for an Android home screen and not
for a store listing. Store listings and a real API address are the other two.
`docs/MOBILE_BUILDS.md` lists them.

## Phase 35 — a number on the home screen means what its words say

Asked for: "the order page and approve page are not showing the same data".

### Two of the four tiles were counting finished work

The home screen said **"3 orders waiting for your decision"** when one was; the
other two had been approved and rejected days earlier. It said **"15 orders to
pick"** when one was; fourteen were packed and gone.

Neither tile was doing anything unreasonable. `homeSignals` said each signal
reuses the URL of the screen it links to and claimed of every one that its
_unfiltered_ length is itself the backlog. For deliveries and packed orders that
is true — those endpoints filter server-side. For `/approvals/queue` and
`/fulfilment/queue` it was false: both return a queue's **history**. Every test
passed throughout, because nothing anywhere said what either number excluded.

### What shipped

`APPROVAL_AWAITING` / `APPROVAL_DECIDED` and `PICKING_OUTSTANDING` /
`PICKING_DONE` in `@medsupply/shared-types`, with `workQueues.ts` on the web
turning each into the request its tile makes **and** the filter its screen opens
on. One string, two readers, so they cannot disagree.

`/fulfilment/queue` now accepts a comma-separated status list, as
`/approvals/queue` already did — "orders to pick" is five statuses and there was
no way to ask for them together. `PickingList`'s schema enum now comes from the
same constant instead of being written out a second time.

Both queue screens open on outstanding work rather than on everything, with the
decided and packed rows one tab away and `useSavedFilter` remembering anyone who
prefers them.

### Measured on live data

`approvals 3 → 1`, `picking 15 → 1`, which is what the orders page shows.

### The gate

`workQueues.test.ts`, 10 tests. The two halves of each queue must be disjoint
**and cover every status the endpoint serves**, so a seventh status added and
classified as neither fails here rather than vanishing from a number somebody
trusts. Each tile's URL must equal the request its destination makes by default.
And every tile must carry a filter or name an endpoint that filters itself —
`/fulfilment/ready` is on that list explicitly, so a fifth tile added against an
unfiltered endpoint has to justify itself.

## Phase 34 — a product that explains itself

Asked for: a short description under every box, and a fuller explanation at the
bottom of every page, so that somebody who is not technical can use this without
asking anybody.

### What was measured first

**143 form fields across the pages carried 27 hints between them.** The sign-in
screen — the first thing anybody meets — had none on either box. The medicine
form had one on nineteen controls, and nothing anywhere told the person typing
into "Sold as" that putting _Tablet_ there means a shop ordering five gets five
tablets rather than five boxes.

### What shipped

**A hint under all 150 fields**, in both languages. Written from one table so
the English and the Bangla cannot drift, and reused where the field repeats —
the same sentence explains "from" on all six screens that have a date range,
which is a feature and not a shortcut.

**An explanation under all 73 screens**, answering three questions: what the
page is for, how to use it, and — only where a screen shows a figure somebody
could disagree with — how that figure is worked out. Forty-three screens have
the third answer; thirty do not, and are left without one rather than given a
sentence saying there is no arithmetic.

`AppShell` renders it from the route rather than each page pasting a block,
because sixty-four pages doing that is sixty-four chances to forget, and the
page somebody writes next year would simply not have one.

### Two gates, each proved by planting the defect it claims to catch

`pageGuides.test.ts` fails when a route has no explanation — and also when the
explanation contains jargon (`endpoint`, `payload`, `basis points`), or is too
short to be a sentence. That last rule caught four of my own on its first run.

`fieldHints.test.ts` fails when a `<Field>` has no hint. Its parser tracks brace
depth and quoting, because `/<Field[^>]*>/` is defeated by `onChange={(e) => …}`
— and it proves that against the four prop shapes that would break it.

Both waiver lists are seeded **empty**, and both were proved by deleting one
hint and one route and watching each name the exact offender.

### The dev server has never watched the shared packages

Found while verifying the above, and it is the cause of three separate
investigations in this project — a blank page, a missing export, and a screen of
raw `home.whoOwesUs` keys this morning.

Every `@medsupply/*` package is aliased to its TypeScript source, so
`packages/i18n/en.ts` is a real module in the graph. It is not watched: Vite's
watcher covers the project root, and the root here is `apps/web`. `packages/` is
a sibling of it.

Measured, not guessed. Touching `apps/web/src/main.tsx` writes
`page reload src/main.tsx` to the log. Touching `packages/i18n/en.ts` writes
nothing, and a 143-line log of a working session contained not one mention of
any file under `packages/`. **A change to a shared package was wrong until
somebody restarted the server, and nothing on screen said so.**

`watchWorkspaceSources` hands the directory to the watcher. After it, the same
touch writes `page reload D:/b2b_medicine/packages/i18n/en.ts` and the served
bytes change — which is how it was verified rather than assumed.

## Phase 33 — a chart that is honest about the first of the month

Phase 32 filled the database and the home screen still drew a flat line. Two
separate causes, and only one of them was in the code.

### The window

The charts took the server's default range. `scopedRange` defaults every report
to **month-to-date**, which is the right default for the analytics screen — it
prints the period it is showing and offers a picker to change it — and the wrong
one for a fixed glance that shows neither.

It fails worst exactly when the question is asked most. **On the first of a
month, month-to-date is a single day**, and no trend can be drawn through one
point. Measured against the same seeded database on the sixth:

|                     | month-to-date           | rolling 30 days               |
| ------------------- | ----------------------- | ----------------------------- |
| points on the chart | 6, of which 3 non-zero  | 30, of which 12 non-zero      |
| net sales           | ৳13,410                 | ৳62,885                       |
| "selling most"      | Cef-3, Amoxin, Voltalin | Insulet 30/70, Roceph, Etorix |

Nearly four fifths of the month's trade was outside the window, and the
best-sellers list — which reads as a considered ranking — was drawn from three
days. The home charts now ask for a rolling thirty days explicitly, through a
new `rollingRange` helper tested against month ends, a year end, a leap
February and a reader whose clock is behind Dhaka's.

The cost is one cache entry: the range is part of the query key, so opening the
home screen and then the analytics screen now makes two requests where it made
one. A chart that is correct on the 1st is worth more than that.

Receivables were never affected and are unchanged — `receivablesAgeing` is
**as-of**, not windowed, so a five-week-old unpaid invoice ages correctly no
matter what period the sales chart shows.

### The other cause was not a defect

The same screen showed `home.whoOwesUs` and `home.bestSellers` as raw keys.
Every gate that could have caught it was already green and right to be: the keys
exist in `en.ts` and in `bn.ts`, and `catalogueKeys.test.ts` proves every key a
screen uses resolves to a string.

The dev server serving the page had been running since **two days before those
keys were written**, and was answering with a 336,170-byte transform of a
336,880-byte file. No test can catch that, because the source was never wrong —
only the process holding a copy of it. Recorded here because it is the third
time this project has spent an investigation on a stale or truncated dev-server
module, and the pattern is worth naming: **when the browser disagrees with the
source, fetch the module the browser is being served before reading the code.**

## Phase 32 — demo data worth testing against

The seed parked one order at each state a screen exists for. That is enough to
prove a screen renders and nowhere near enough to _use_ the system: with no
issued invoice there was no revenue, no receivable, nothing to age, nothing to
collect and nothing to chart — which is why the home screen's new sales line was
a flat zero and its "who owes us" card said nothing was outstanding.

Now: **36 medicines** across nine categories — prescription-only lines, two cold
chain lines, syrups, injections, an inhaler, a sachet, prices spanning three
orders of magnitude — **9 shops**, **4 suppliers**, **2 purchase orders** with
one received in full, **14 orders driven the whole way to an issued invoice**,
**8 payments** and **6 deliveries**, three of them out on the road.

Every state transition still goes through the HTTP API as the role the server
requires. The seed writes no status anywhere, so if a workflow gains a rule the
seed fails rather than producing a database no sequence of clicks could create —
which is how the three defects below were found.

### What it cost to write it honestly

**`PICK_LIMIT`.** The picking detail endpoint populates `medicineId` into a
document, so stringifying it gave `[object Object]`, no line matched, and the
server reported it as picking more than was allocated.

**`ADDRESS_REQUIRED`.** Six new shops hung off the two existing owners looked
tidier and could not place an order: a shop owner belongs to one ordering shop,
which `ASSUMPTIONS.md` has said since phase 2. Six new owner accounts.

**`HANDOVER_MISMATCH`.** The handover is a _check_ — the storekeeper reads the
references off the package in their hands and the server refuses if they do not
match what it issued. Invented references are correctly rejected.

### One real defect, and it was the data that exposed it

**A picker said "No suppliers yet" while it was still searching.** `SearchPicker`
had no loading state: it rendered the empty label whenever the option list was
empty, including before the request came back. That read as true for as long as
nothing was seeded, and became a lie the moment four suppliers existed. It now
says which of the two it means.

`pickers.spec.ts` was resting on the same accident. It typed "Padma", expected
"no suppliers yet", and passed either way — because the message it was reading
described a request that had not returned. It now searches a term that genuinely
matches nothing.

### The seed can be run twice

Idempotency is keyed on the seed's own records rather than on the tables being
empty. The end-to-end database is never dropped, and `pickers.spec.ts` creates a
supplier every run, so "are there any suppliers" was true after the first
browser run and the seed skipped its own four for good — which is how the
purchasing screens came to show nothing but a column of _Padma Traders
1785988918156508_.

## Phase 31 — the redesign

Asked for a redesign: more modern, more colourful, and charts on the dashboard.

The leverage is that fifty-three screens already read their colour, shape and
depth from one place. So this changes the tokens and the shared primitives, and
**not one page component was touched for appearance**.

**Shape and depth.** `rounded-lg` was on every surface in the product — cards,
dialogs, buttons, inputs, badges — which is the shape equivalent of having one
type size. Three radii now, and they mean something: a surface you read, a
control you press, a label. Elevation is two layers in light, because a contact
shadow plus a diffuse one is what makes a card look placed on the page rather
than drawn on it; in dark it is nearly nothing, because a black blur on
near-black reads as nothing and depth there comes from the surface steps.

**Colour, assigned by stage of work rather than by taste.** A queue keeps its
hue from the home tile through to the sidebar group: waiting on a person is
blue, being picked is teal, packed is amber, gone is plum. These are the tones
the badge palette already used, so the contrast test already held them — the
redesign spends a palette that was proved rather than inventing one.

The tiles paint their icon chip in the tone at **full strength**. The first
attempt tinted the card, the icon and the number in the same subtle shade and it
read as one pale smear: those tints are built to carry small text inside a
badge, a few percent off white. The four new `on-brand` over tone pairs are
asserted at 4.5:1 in both themes like every other pairing this product renders.

**Charts.** Sales over time, who owes us and for how long, and what is selling
most — from the single `/reports/overview` request the analytics screen already
makes, under the key it already uses. The whole section disappears if it fails,
because this is the first screen of somebody's day and the figures above it come
from different requests. A chart's figures table is collapsible here and never
optional: the SVG is `aria-hidden`, so a chart without its table does not exist
for anybody using a screen reader.

**The directory** below is compact rows with icons now, not twenty description
cards restating the sidebar in a larger font.

### `purchasing` had never been on the home screen

Found while giving each group a colour. `GROUP_ORDER` listed six of the seven
navigation groups, so suppliers, purchase orders, the recall trace and the
controlled register were reachable from the sidebar and absent from the screen
that claims to show everything you can do. It is typed `NavGroup[]`, and an
array of a union does not have to contain all of it — the omission was not a
type error, just a shorter array. A test counts them now.

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
