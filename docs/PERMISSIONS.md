# Permissions Matrix

> **This page is a summary, not the authority.** Who may call what is decided by
> `requireRole` on the mounted routers, published in `docs/openapi.json`, and
> reconciled against both the specification and the navigation package by
> `routeCoverage.test.ts` and `navigationRules.test.ts`. Where this page and
> those disagree, those are right — this one is hand-maintained and has been
> wrong before. The tables below the role summary still describe six roles and
> predate `SALES`.

- **SUPER_ADMIN**: Full system access, settings, destructive actions (if any).
- **ADMIN**: Access to shops, customers, inventory, orders, deliveries. Cannot change global system settings.
- **MANAGER**: Review and approve orders, assign deliveries, manage credit limits, view reports.
- **STOREKEEPER**: Pick batches, pack orders, report discrepancies, count stock.
  **Not the order book** — a pick list carries the lines to pick, and the order
  behind it carries the customer's prices, credit terms and discounts.
- **DELIVERY_PERSON**: View assigned deliveries, update delivery status, collect payments, capture POD.
- **SALES**: Take an order on behalf of a customer in their own territories, read
  the customer list and one customer's record, read price lists and schemes to
  quote from. No step in the return workflow, and no access to a customer's
  ledger.
- **SHOP_OWNER**: View own shop, own orders, own invoices, create new order drafts, submit orders, view own ledger, raise and track returns.

## Phase 3 catalogue and inventory

| Capability                     | Super Admin | Admin | Manager | Storekeeper | Delivery | Shop Owner |
| ------------------------------ | ----------- | ----- | ------- | ----------- | -------- | ---------- |
| Browse catalogue/selling price | Yes         | Yes   | Yes     | Yes         | No       | Yes        |
| View cost prices               | Yes         | Yes   | Yes     | No          | No       | No         |
| Create/edit medicines          | Yes         | Yes   | Yes     | No          | No       | No         |
| View exact batches/quantities  | Yes         | Yes   | Yes     | Yes         | No       | No         |
| Receive/add/transition stock   | Yes         | Yes   | Yes     | Yes         | No       | No         |
| Reconcile stock/block batch    | Yes         | Yes   | Yes     | No          | No       | No         |
| Run FEFO reservation           | Yes         | Yes   | Yes     | No          | No       | No         |
| View movement ledger           | Yes         | Yes   | Yes     | Yes         | No       | No         |

## Phase 4 ordering

Shop Owners can create/edit/delete their own drafts, submit orders, see only their shop's orders, duplicate/reorder, and request eligible cancellation. Admins and Managers can list and inspect all submitted orders but cannot impersonate a Shop Owner to create drafts. Storekeepers and Delivery Persons receive no Phase 4 order access.

## Phase 5 approvals

Managers, Admins and Super Admins can review, hold, reject and approve orders. **Only Admins and Super Admins may apply an exceptional credit override**, and only with a meaningful reason — overriding a credit block extends unsecured credit beyond an agreed limit, which is a decision for whoever carries that risk. This page previously said Managers could, `PHASE_STATUS.md` said they could not, and the service checked nobody's role at all; the ledger-derived position and override actor/role are captured in the immutable reservation decision. Storekeepers receive approved picking notifications but cannot make approval decisions. Shop Owners see decision status and owner-visible notes, never internal Manager notes.

## Phase 6 fulfilment

| Capability                        | Super Admin | Admin | Manager | Storekeeper | Delivery | Shop Owner |
| --------------------------------- | ----------- | ----- | ------- | ----------- | -------- | ---------- |
| View fulfilment and ready queues  | Yes         | Yes   | Yes     | Yes         | No       | No         |
| Start/save/pause/complete picking | No          | No    | No      | Yes         | No       | No         |
| Report picking discrepancy        | No          | No    | No      | Yes         | No       | No         |
| Resolve discrepancy               | Yes         | Yes   | Yes     | No          | No       | No         |
| Confirm packing and issue invoice | No          | No    | No      | Yes         | No       | No         |
| View/download any invoice         | Yes         | Yes   | Yes     | Yes         | No       | No         |
| View/download own-shop invoice    | No          | No    | No      | No          | No       | Yes        |

Every Storekeeper write is server-authorised and version-checked. Shop Owner invoice access additionally verifies ownership of the invoice's shop; knowing an invoice ID is insufficient.

## Phase 7 delivery

| Capability                           | Super Admin | Admin | Manager | Storekeeper | Delivery | Shop Owner |
| ------------------------------------ | ----------- | ----- | ------- | ----------- | -------- | ---------- |
| View delivery board/details          | Yes         | Yes   | Yes     | Yes         | Assigned | Own shop   |
| View workload / assign / reassign    | Yes         | Yes   | Yes     | No          | No       | No         |
| Confirm handover / returned package  | No          | No    | No      | Yes         | No       | No         |
| Acknowledge, pickup, start, arrive   | No          | No    | No      | No          | Assigned | No         |
| Send OTP / complete / report failure | No          | No    | No      | No          | Assigned | No         |
| Start return                         | Yes         | Yes   | Yes     | No          | Assigned | No         |
| View proof files                     | Yes         | Yes   | Yes     | Yes         | Assigned | Own shop   |

Delivery Person access checks the record's current assignee in addition to the role. Shop Owner detail and proof access independently verifies shop ownership; possession of a delivery or proof ID is insufficient.

## Phase 8 finance

| Capability                             | Super Admin  | Admin        | Manager      | Storekeeper | Delivery          | Shop Owner |
| -------------------------------------- | ------------ | ------------ | ------------ | ----------- | ----------------- | ---------- |
| View all Payments/reports/accounts     | Yes          | Yes          | Yes          | No          | Own collections   | Own shop   |
| Record/post/fail Payment               | Yes          | Yes          | Yes          | No          | No                | No         |
| Record delivery collection             | No           | No           | No           | No          | Assigned delivery | No         |
| Hand over collected cash               | No           | No           | No           | No          | Own collection    | No         |
| Reverse posted Payment                 | Yes          | Yes          | No           | No          | No                | No         |
| Post opening/adjustment journal        | Yes          | Yes          | No           | No          | No                | No         |
| Read/repair reconciliation             | Read/repair  | Read/repair  | Read only    | No          | No                | No         |
| Backfill a reported credit reservation | Yes          | Yes          | No           | No          | No                | No         |
| View receipt/statement                 | All accounts | All accounts | All accounts | No          | Own collection    | Own shop   |

Shop Owner and Delivery Person reads use record predicates in addition to route roles. Posted Payments cannot be patched or deleted; all changes use explicit posting, failure, handover or reversal actions.

## Phase 9 notifications and activity

| Action                             | Super Admin  | Admin        | Manager      | Storekeeper  | Delivery Person | Shop Owner                  |
| ---------------------------------- | ------------ | ------------ | ------------ | ------------ | --------------- | --------------------------- |
| Read own inbox and unread count    | Own          | Own          | Own          | Own          | Own             | Own                         |
| Mark read / archive                | Own          | Own          | Own          | Own          | Own             | Own                         |
| Read and update own preferences    | Own          | Own          | Own          | Own          | Own             | Own                         |
| Register / remove own push device  | Own          | Own          | Own          | Own          | Own             | Own                         |
| Read per-channel delivery attempts | Yes          | Yes          | No           | No           | No              | No                          |
| Send a test notification           | Yes          | Yes          | No           | No           | No              | No                          |
| Read entity activity timeline      | Role-visible | Role-visible | Role-visible | Role-visible | Role-visible    | Own shop, shop-visible only |
| Read organisation activity feed    | Role-visible | Role-visible | Role-visible | Role-visible | Role-visible    | Own shop, shop-visible only |

Activity visibility is a property of each record, not of the route. Every event stores `visibleToRoles` and `visibleToShop`; internal-only entries such as credit assessments are never returned to a Shop Owner. Notification queries are constrained by `recipientId` at the database layer, so a cross-user mark-read attempt returns `0` updated rather than an error.

## Phase 10 settings and administration

| Action                                     | Super Admin | Admin | Manager | Storekeeper | Delivery Person | Shop Owner |
| ------------------------------------------ | ----------- | ----- | ------- | ----------- | --------------- | ---------- |
| Read branding and display formatting       | Yes         | Yes   | Yes     | Yes         | Yes             | Yes        |
| Read all system settings                   | Yes         | Yes   | No      | No          | No              | No         |
| Update or reset a settings group           | Yes         | Yes   | No      | No          | No              | No         |
| Read the user directory                    | Yes         | Yes   | Yes     | No          | No              | No         |
| Change a role or account status            | Yes         | Yes   | No      | No          | No              | No         |
| Reset a password / revoke sessions         | Yes         | Yes   | No      | No          | No              | No         |
| Administer an Admin or Super Admin account | Yes         | No    | No      | No          | No              | No         |
| Grant the Admin or Super Admin role        | Yes         | No    | No      | No          | No              | No         |
| Read the audit log                         | Yes         | Yes   | No      | No          | No              | No         |

Guard rails apply on top of the role check, because these failures are not recoverable from inside the product:

- An Admin may not administer an Admin or Super Admin account, nor grant either role.
- Nobody may change their own role or move their own account out of `ACTIVE`.
- The last active Super Admin cannot be demoted or deactivated.
- A role change or a non-active status revokes that user's sessions immediately.

Managers see the directory read-only; the web interface renders their view without role, status or password controls rather than showing controls that would be refused.

## Phase 11 returns, reporting and analytics

| Action                                 | Super Admin | Admin | Manager | Storekeeper | Delivery Person | Shop Owner |
| -------------------------------------- | ----------- | ----- | ------- | ----------- | --------------- | ---------- |
| Request a return                       | Yes         | Yes   | Yes     | No          | No              | Own shop   |
| Read a return                          | Yes         | Yes   | Yes     | Yes         | Yes             | Own shop   |
| Start a review / decide / reject       | Yes         | Yes   | Yes     | No          | No              | No         |
| Cancel a return                        | Yes         | Yes   | Yes     | No          | No              | Own shop   |
| Mark returned goods collected          | Yes         | Yes   | Yes     | No          | Yes             | No         |
| Receive and disposition returned goods | Yes         | Yes   | Yes     | Yes         | No              | No         |
| Issue a credit note                    | Yes         | Yes   | Yes     | No          | No              | No         |
| Read a credit note                     | Yes         | Yes   | Yes     | Yes         | Yes             | Own shop   |
| Analytics overview                     | Yes         | Yes   | Yes     | No          | No              | No         |
| Sales, order and returns reports       | Yes         | Yes   | Yes     | No          | No              | Own shop   |
| Inventory report                       | Yes         | Yes   | Yes     | Yes         | No              | No         |
| Delivery and receivables reports       | Yes         | Yes   | Yes     | No          | No              | No         |

The whole return policy — which role may take which action from which status — lives in one table in `returnRules.ts`, so the route guard and the service cannot drift apart. Checks run in a fixed order: the role gate first, so a forbidden actor learns nothing about the record's state; then the version, because when a colleague has already acted "you are looking at a stale copy" is the accurate diagnosis and the one a client recovers from by reloading; then the state transition itself.

Record-level access is enforced in the service, not the route: a Shop Owner is confirmed to own the shop on the return before any read or action, and internal review notes are stripped from their view of a record they may otherwise see. A report a Shop Owner is permitted to read is narrowed to the shops they own rather than refused, so the same screen serves every role.

## Phase 12 account security

| Capability                  | Super Admin     | Admin | Manager | Storekeeper | Delivery | Shop Owner |
| --------------------------- | --------------- | ----- | ------- | ----------- | -------- | ---------- |
| List own sessions           | Yes             | Yes   | Yes     | Yes         | Yes      | Yes        |
| End own session             | Yes             | Yes   | Yes     | Yes         | Yes      | Yes        |
| End every own session       | Yes             | Yes   | Yes     | Yes         | Yes      | Yes        |
| End another user's sessions | Yes             | Yes   | No      | No          | No       | No         |
| Read the runtime status     | Yes             | Yes   | No      | No          | No       | No         |
| Read the API reference      | Yes             | Yes   | Yes     | Yes         | Yes      | Yes        |
| Health and readiness probes | Unauthenticated |       |         |             |          |            |

Self-service session management is deliberately available to every role: until this phase the only way to end a session on a lost device was to ask an administrator, and the person best placed to notice a device they do not recognise is its owner. A session is scoped to its owner in the query itself, so another user's identifier is simply not found rather than refused — the distinction matters, because "forbidden" would confirm that the identifier names a real session.

Ending another user's sessions remains an administrative action, unchanged from Phase 10, and still happens automatically on a role change, a status change away from active and an administrative password reset.

Revocation is now enforced on every authenticated request and on the realtime handshake, not only at refresh time. A revoked session's access token stops working immediately instead of remaining valid for the rest of its lifetime.

## Commercial terms: price lists and free-goods offers

| Action                              | Super Admin | Admin | Manager | Sales | Storekeeper | Delivery | Shop Owner |
| ----------------------------------- | ----------- | ----- | ------- | ----- | ----------- | -------- | ---------- |
| Read price lists and offers         | Yes         | Yes   | Yes     | Yes   | No          | No       | No         |
| Create or change a price list       | Yes         | Yes   | Yes     | No    | No          | No       | No         |
| Create or change a free-goods offer | Yes         | Yes   | Yes     | No    | No          | No       | No         |
| Assign a price list to a customer   | Yes         | Yes   | No      | No    | No          | No       | No         |
| Set the MRP printed on a pack       | Yes         | Yes   | Yes     | No    | No          | No       | No         |

A rep reads the terms and cannot set them. Quoting a customer means knowing what
they pay and what offer is running, so `SALES` reads both lists; writing stays
with management because a price list is the revenue of every order placed after
it. Assigning a list to a customer follows the existing shop-edit rule and is
therefore administration rather than management.

Two guard rails sit on top of the role check:

- **At most one default price list**, moved rather than added. Two would make
  "which list prices this shop" ambiguous for every customer assigned none.
- **A customer cannot be assigned an inactive list.** The resolver skips a list
  that is not in force and falls through to the default, so the assignment would
  be a price that silently does not apply.

Both writes are optimistic: a save carrying a stale version is refused with
`VERSION_CONFLICT` rather than overwriting, because two people editing one price
sheet would otherwise discard each other's prices and charge a customer an
amount nobody chose.
