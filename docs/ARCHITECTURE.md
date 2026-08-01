# MedSupply B2B Architecture

## Overview

MedSupply B2B is a scalable, modular monolith built as a TypeScript MERN monorepo using Turborepo.

## High-Level Domain Architecture

The backend is structured around domain modules to maintain separation of concerns while allowing easy refactoring into microservices later if necessary.

### Domain Modules

- **auth**: Authentication, token rotation, session management.
- **users**: User profile and role management.
- **shops**: Medicine shop accounts, addresses, credit limits.
- **medicines**: Medicine catalogue, categories.
- **batches**: Inventory batches, expiry tracking.
- **inventory**: Real-time stock, reservations, ledger.
- **orders**: Customer order creation, drafts, processing.
- **approvals**: Manager review and approval workflows.
- **fulfilment**: Picking lists and storekeeper queue.
- **packing**: Packing confirmation and discrepancy handling.
- **invoices**: Final invoice generation from packed quantities.
- **deliveries**: Assignment, tracking, proof-of-delivery.
- **payments**: Collection tracking, ledger posting.
- **ledgers**: Double-entry financial tracking for customer accounts.
- **returns**: Handling damaged/returned items.
- **notifications**: Event-driven alerts (in-app, email, sms).
- **audit**: Immutable logging of all sensitive actions.

## Technology Stack

- **Monorepo Tooling**: pnpm workspaces, Turborepo
- **Backend**: Node.js, Express, Mongoose, Socket.IO, BullMQ, Pino
- **Web Frontend**: React, Vite, Tailwind CSS, TanStack Query, Zustand, React Hook Form, Zod
- **Mobile Frontend**: React Native, Expo, Expo Router
- **Databases**: MongoDB (Primary), Redis (Caching/Queues), S3 (Object Storage)

## Core Strategies

- **Authentication**: JWT access tokens (short-lived) + Refresh tokens (HttpOnly cookies for web, SecureStore for mobile).
- **File Storage**: Abstracted service interface (S3-compatible via MinIO locally).
- **Real-time Updates**: Socket.IO for targeted push events (order status, delivery).
- **Background Jobs**: BullMQ on Redis for reliable async tasks (emails, pdf generation).
- **API Versioning**: URL-based (`/api/v1/`).

## Phase 6 fulfilment boundary

The fulfilment module remains inside the modular monolith but separates HTTP controllers, Zod contracts, Mongoose models, transaction services, integer financial calculations, and PDF rendering. PickingList is the optimistic workflow aggregate. MedicineBatch remains the stock authority, while Invoice and Package are immutable outputs created exactly once per order.

MongoDB transactions cover every stock-changing fulfilment action. The web and role-based Expo application call only business actions; neither client can set an order or picking status directly. Invoice PDF rendering is deterministic and on demand from the persisted issued snapshot, with A4 and 80 mm thermal page variants.

## Phase 7 delivery boundary

Delivery is a separate workflow aggregate created atomically with the final Invoice and Package. HTTP controllers validate shared Zod actions; `deliveryService` owns state, role, assignee, custody, Order/Package coordination, idempotency, audit and notifications. `deliveryRules` publishes transition-policy metadata for tests and operations documentation.

OTP delivery and proof-file persistence are replaceable provider interfaces. The local adapters use Shop Owner in-app notifications and bounded MongoDB image records. The Expo application keeps tokens in SecureStore, caches non-secret assignments/actions in AsyncStorage, and makes camera, signature and foreground-location collection user initiated. The web board refreshes delivery status every 15 seconds.

## Phase 8 financial boundary

The finance domain remains inside the modular monolith but owns its persistence and actions. Controllers validate/authorise commands; Payment services control state; Ledger services append balanced journals; reporting services derive balances, overdue amounts and statements. Issued Invoices and journal history are never edited to represent settlement.

Invoice issuance, journal charge creation, credit-reservation consumption and Shop projection changes share the packing MongoDB transaction. Delivery completion, payment proof and pending Payment creation share the delivery transaction. Payment posting and reversal each append a journal, update projections and create audit/notification records in one transaction.

Ledger entries use integer minor units and explicit accounts. Customer position is the sum of `customerBalanceDeltaMinor`; customer-advance liability is independently derived from `CUSTOMER_ADVANCE` lines. `sourceKey` and Payment action keys make retried writes deterministic. Credit approval also writes the common Shop projection so two different Orders contend on one document before separate Order reservations are created.

## Phase 9 notification, real-time and activity boundary

Notifications are a pipeline, not a set of inline writes. A business action calls `notify()` with an event key and a context bag; the service resolves the template, renders the title/body/link, resolves each recipient's channels, writes the in-app record and one delivery row per channel, then queues dispatch. Domain services no longer compose notification copy, so wording and channel policy change in one place.

`notificationCatalogue` owns the closed event catalogue and its templates. `notificationRules` is pure and holds channel resolution, Asia/Dhaka quiet hours and the dedupe key derivation, which is why those are unit-testable without a database. `notificationChannels` holds the replaceable adapters: one signed-webhook adapter covers email, SMS and WhatsApp until vendor credentials exist, and the Expo adapter is a real implementation. `notificationAudience` centralises recipient lookup so audiences are consistent across domains.

`jobQueue` presents one interface over two drivers. With Redis configured it is BullMQ; without it, an in-process queue applies the same attempt limit and exponential backoff. Both are observable through `notificationdeliveries`, and a sweeper re-queues any PENDING row older than a minute, so a lost enqueue or a crashed process cannot silently drop a notification. Dispatch inside a transaction is delayed briefly and the worker treats a missing row as an aborted transaction rather than an error.

`realtime` attaches Socket.IO to the same HTTP server as Express. The handshake verifies the access token, then joins user, role and shop rooms; every emit targets rooms rather than broadcasting. With Redis present the Redis adapter is installed so multiple API instances share one fan-out. All emit helpers are no-ops when realtime is not initialised, which keeps scripts, migrations and tests free of transport concerns.

`activityService` writes the append-only, user-facing timeline. AuditLog remains the forensic record with before/after values, IP and user agent; ActivityEvent is the readable history that carries explicit `visibleToRoles`/`visibleToShop`, so a Shop Owner timeline cannot leak an internal note. Denormalised `orderId`/`shopId` links let an order timeline absorb its delivery, invoice and payment events in one indexed query.

Clients treat realtime as an accelerator, not a dependency. The web delivery board and detail views refresh on a socket signal and keep a slower polling fallback, so a blocked websocket degrades to the Phase 7 behaviour instead of going stale.

## Phase 10 configuration boundary

Configuration is split by who owns it. Infrastructure — database, Redis, JWT secret, CORS allow-list and provider webhooks — stays in the environment: it is needed before the database is reachable, and it must not be editable through an authenticated web form. Business policy — identity, tax, credit control, inventory thresholds, delivery proof, notification defaults, localisation and password policy — moves into System Settings, where an administrator owns it.

`settingsDefaults` holds the built-in defaults and the environment variables each group falls back to. `settingsService` resolves the effective value per field, caches the result and reports where each group's values came from. The precedence is persisted, then environment, then default. This is what let every Phase 3-9 configuration read migrate without changing behaviour for an existing deployment: `INVOICE_TAX_BASIS_POINTS`, `DELIVERY_REQUIRED_PROOFS`, `CREDIT_*`, `CUSTOMER_ADVANCE_ENABLED`, `NEAR_EXPIRY_DAYS` and the `BUSINESS_*` identity fields all still work, they are simply no longer the last word.

Settings are read on nearly every invoice, approval and notification, so they are cached in memory. A local write invalidates the cache immediately; a short TTL is what makes a second API instance converge and bounds how long a stale value can be in force after another instance saves. Changing a group also emits `settings:updated`, so clients holding branding or formatting values refetch rather than waiting for a reload.

Invoices, receipts and statements continue to snapshot business identity at issue time. Changing the business name does not rewrite a document that has already been issued, which is the same rule the ledger follows.

`userAdminService` owns account administration. Its guard rails are separated from the controller because they are decisions, not transport concerns, and because the failure modes are unrecoverable from inside the product: an Admin quietly promoting themselves, or the last Super Admin locking everyone out. AuditLog gains sign-in outcomes and every administrative change, which is what makes the new read-only audit viewer worth having.

## Phase 11 returns and reporting boundary

The returns module owns the reverse flow and nothing else. `returnRules.ts` is pure: the transition table, the returnable-quantity arithmetic, the disposition guards and every money calculation, all unit tested without a database. `returnService.ts` is the only place that writes, and each lifecycle action runs in one transaction that covers the return document, the stock movements, the order status, the ledger, the audit record, the notification and the timeline entry. A failure part-way through can therefore never leave stock booked in against a return that stayed unreceived.

Stock and money move at different moments and by different hands, deliberately. Receiving is a warehouse action: it books the goods in, dispositions each unit and recalculates the credit from what actually arrived rather than what was approved. Issuing the credit note is a separate finance decision that posts to the customer ledger. A received return therefore sits in a visible "awaiting credit" queue instead of silently crediting an account the moment a carton is opened.

Returns reuse the existing financial primitives rather than growing their own. The credit posts through `appendLedgerTransaction` as a balanced `RETURN_CREDIT` — the RETURNS control account debited, receivables credited — keyed on the return, so a retried issue cannot double-credit. Inventory moves through a session-aware sibling of `applyStockOperation` that takes the caller's transaction instead of opening its own.

Reporting is read-only and lives entirely in `reportService.ts` as MongoDB aggregations over the records the other phases already write. It owns no state, so a report can never disagree with the ledger by drifting: the numbers are recomputed from the source on every request. Buckets follow the Asia/Dhaka business calendar, matching the ledger's day boundary, because a report and the statement it summarises must agree on which day a transaction belongs to. CSV rendering is a separate module with its own escaping and formula-injection defence, so the shape of an export is decided in one place.

The web application renders charts with hand-written SVG rather than a charting dependency. Every chart is hidden from assistive technology and paired with the same figures as a real data table, so the numbers reach every reader rather than only those who can see the picture.

## Phase 12 platform boundary

Security is a layer of the request pipeline rather than a concern each controller repeats. The order is load-bearing and is written out in `app.ts`: proxy trust first, because everything that reads `req.ip` depends on it; then headers, so a protection is set before any handler can return early; then the correlation context, so even a rejected request is traceable; then CORS, compression, cookies and body parsing; then sanitisation, before any controller can build a query; then rate limiting; then routes, a 404 and the error handler.

The pure parts are separated from the middleware that uses them, which is what makes them testable without a server. `requestSanitiser` holds the key rules, the query parser and the regex escaping. `rateLimitStore` holds the counters behind an interface with a Redis implementation and an in-process one, following the pattern `jobQueue` established in Phase 9: use the shared store when Redis is configured, and behave identically without it. `tokenService` owns token issue, verification and session hashing, so no controller decides for itself what a token means. `logger` owns redaction and the async-local request context.

The OpenAPI document is generated from the Zod schemas the server already validates with rather than maintained alongside them. A hand-written specification drifts from the implementation within a release or two, and a wrong specification is worse than none. The route table — path, method, tag, permitted roles — is declared rather than reflected off the Express router, because the router knows a path and a method but nothing about who may call it, and the permission column is what a reader most needs.

Health is split into liveness and readiness because an orchestrator asks two different questions. "Is the process alive?" must not fail because the database blinked, or the container is restarted for a fault it would have recovered from. "Is it ready for traffic?" must fail in exactly that case, so the instance leaves the load balancer instead of answering with errors. Shutdown is ordered to match: stop accepting requests, stop background work, drain the queue, then close the database, with a hard timer so the process always exits before an orchestrator resorts to SIGKILL and interrupts a transaction.
