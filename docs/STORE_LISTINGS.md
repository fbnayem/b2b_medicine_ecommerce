# Store listings for the three applications

Everything a submission to Google Play and the App Store asks for, written out
so it is reviewed here rather than typed into a console at midnight. One section
per application, then the parts that are the same for all three.

**Nothing here has been submitted.** No binary has been built, no store account
exists for this project, and the two data-safety declarations at the bottom are
the ones that need a human decision before anybody uploads anything.

The distributor's own details — legal entity, support address, privacy-policy
URL, the DGDA licence number the store may ask for — are marked `‹›` and are the
distributor's to supply. They are deliberately not guessed.

---

## MedSupply Shop

**For:** the owner or counter staff of a pharmacy that buys from ‹distributor›.

|                   |                                        |
| ----------------- | -------------------------------------- |
| Bundle identifier | `com.medsupply.shop`                   |
| Category          | Business (Play) · Business (App Store) |
| Content rating    | Everyone / 4+                          |
| Contains ads      | No                                     |
| In-app purchases  | No                                     |

**Short description** (Play, 80 characters)

> Order medicines from your distributor, and see what you owe.

**Subtitle** (App Store, 30 characters)

> Order from your distributor

**Full description**

> MedSupply Shop is for pharmacies that buy from ‹distributor›. It is not a
> shop for the public and it does not sell medicine to anybody who is not an
> approved trade customer.
>
> **Order at your own prices.** The catalogue shows the list price; your basket
> shows what _your_ pharmacy pays — your discount, your price list, any free
> goods you have earned, and the delivery charge. The total on the screen is the
> total on the invoice.
>
> **Know where an order is.** Every order shows its stage, from waiting for
> approval through to who signed for it at your door, with the photograph.
>
> **Order it again.** One tap fills the basket from a delivered order.
>
> **See what you owe.** What is due, what is overdue, how much credit you have
> left, and a statement for any period. Invoices open line by line, with the
> batch number and expiry printed on each box.
>
> **Send something back.** Raise a return against an invoice while you are
> standing over the carton, and keep the credit note when it is issued.
>
> **In Bangla or English**, switchable at any time. Money in taka, dates as they
> are written here.
>
> You need an account with ‹distributor›. You can open one in the application;
> a manager sets your credit terms before you can buy on credit.

**Keywords** (App Store, 100 characters)

> pharmacy,medicine,wholesale,distributor,order,invoice,pharma,stock,bangladesh

**What's new** (first release)

> The first release.

**Screenshots to capture** (6.5" iPhone, 6.7" iPhone, 12.9" iPad, Android phone
and 7" tablet — the same six screens each):

1. Home — what you owe, what is on its way, order it again
2. The catalogue, with a medicine open
3. The basket, showing a discount and free goods against the total
4. An order, with where it is
5. An invoice, batch numbers and expiry visible
6. Delivery addresses

Capture from the seeded demo data (`pnpm seed:demo`), never from a real
customer's account: the screenshots are public and an invoice carries a real
pharmacy's name, address and balance.

---

## MedSupply Manage

**For:** ‹distributor›'s own managers, storekeepers and sales representatives.

|                   |                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle identifier | `com.medsupply.manage`                                                                                                                                                       |
| Category          | Business                                                                                                                                                                     |
| Content rating    | Everyone / 4+                                                                                                                                                                |
| Distribution      | **Internal / private.** Play: an internal-testing or closed track, or Managed Google Play for the organisation. App Store: Apple Business Manager custom app, or TestFlight. |

**Short description**

> Approve orders, pick and pack, and keep the stock straight.

**Subtitle**

> Run the distribution floor

**Full description**

> MedSupply Manage is ‹distributor›'s internal application. It is not useful to
> anybody outside the company and an account is issued by the company.
>
> **Approve or hold an order** with the credit position, the stock position and
> the customer's history on the same screen.
>
> **Pick and pack** against a picking list, by batch, with a barcode scan and a
> way to report a shortfall without abandoning the list.
>
> **Count stock** on a blind count sheet that only shows the expected quantity
> once counting is finished, and posts every variance in one go.
>
> **Take a payment** at the counter or from a rider's collection, with the
> deposit slip attached.
>
> **Decide a return**, line by line, and issue the credit note.
>
> Everything a person does here is recorded against their name.

**Keywords**

> distribution,warehouse,picking,stock,approval,wholesale,pharma,inventory

**Screenshots to capture**

1. The approvals queue
2. One order under review, with credit and stock
3. A picking list mid-pick
4. A blind count sheet
5. The finance dashboard

---

## MedSupply Rider

**For:** ‹distributor›'s delivery riders.

|                   |                                   |
| ----------------- | --------------------------------- |
| Bundle identifier | `com.medsupply.rider`             |
| Category          | Business                          |
| Content rating    | Everyone / 4+                     |
| Distribution      | **Internal / private**, as above. |

**Short description**

> Your round, your deliveries, and proof you delivered them.

**Subtitle**

> Deliveries and proof

**Full description**

> MedSupply Rider is for ‹distributor›'s delivery riders. An account is issued
> by the company.
>
> **Your round for the day**, in the order it was planned.
>
> **Confirm a delivery** with a one-time code, a signature or a photograph,
> whichever that consignment requires.
>
> **Take a payment** on the doorstep and hand the cash over at the end of the
> day, with both halves recorded.
>
> **It works without a signal.** Deliveries confirmed in a lane with no
> reception are held on the handset and sent when there is one. Nothing is lost
> and nothing is sent twice.

**Keywords**

> delivery,rider,proof of delivery,route,logistics,collection

**Screenshots to capture**

1. Today's round
2. One delivery, ready to confirm
3. Capturing proof
4. Collecting a payment
5. The end-of-day handover

---

## The permission prompts, word for word

These are what a person actually reads, and they come from `app.config.ts`
rather than from this document — `appVariant.test.ts` fails if a prompt does not
name the application asking.

| Application | Camera                                                                        | Location                                                                                                         |
| ----------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Shop**    | _not requested_                                                               | _not requested_                                                                                                  |
| **Manage**  | "Allow MedSupply Manage to scan barcodes while picking and packing an order." | _not requested_                                                                                                  |
| **Rider**   | "Allow MedSupply Rider to photograph proof of delivery and payment."          | "Allow MedSupply Rider to record where a delivery was confirmed. It is read only at the moment you confirm one." |

A pharmacy owner's application asks for **nothing**. That is worth keeping: it
is the only one a member of the public installs, and it is the difference
between a listing that reads as a trade tool and one that reads as tracking.

## Data safety — the declarations both stores require

Accurate as of the current build. Anything that changes here changes a
declaration, and a declaration that has drifted is what gets an application
pulled.

| Data                         | Collected | Why                                            | Shared with anybody                   | Optional |
| ---------------------------- | --------- | ---------------------------------------------- | ------------------------------------- | -------- |
| Name, email, phone           | Yes       | To identify the account and address deliveries | No                                    | No       |
| Business address             | Yes       | To deliver to it                               | With the rider carrying that delivery | No       |
| Purchase history             | Yes       | It is the product                              | No                                    | No       |
| Photographs (Rider)          | Yes       | Proof of delivery and payment                  | No                                    | No       |
| Approximate location (Rider) | Yes       | Recorded at the moment a delivery is confirmed | No                                    | No       |
| Crash and diagnostic data    | No        | —                                              | —                                     | —        |
| Advertising identifiers      | No        | —                                              | —                                     | —        |

**Encrypted in transit:** yes. **A way to ask for deletion:** ‹distributor› must
publish one; the API has no self-service deletion, and a distributor holding
purchase records for a trade customer has record-keeping duties that a delete
button cannot simply override. **This is the decision that needs a human**, and
it needs to be settled before submission rather than after a rejection.

**Location is only read on the Rider application, and only at the moment a
delivery is confirmed.** There is no background location, no tracking between
stops, and no location permission at all in the other two. Play's declaration
must say exactly that; the honest version is also the one that gets approved.

## Before anybody submits

- [ ] `EAS_PROJECT_ID` and `EAS_OWNER` set — see `MOBILE_BUILDS.md`
- [ ] A production build of each of the three, on both platforms
- [ ] A privacy policy at a URL, covering all three
- [ ] ‹distributor›'s legal entity, support email and DGDA licence number
- [ ] Screenshots captured from demo data, not from a real customer
- [ ] Manage and Rider on a private or internal track — neither belongs on a
      public listing, and a public one invites installs from people who then
      cannot sign in
