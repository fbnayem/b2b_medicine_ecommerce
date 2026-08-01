# Security Rules

- Never store access or refresh tokens in local storage. Use HTTP-only cookies for web and Expo SecureStore for mobile.
- Use bcrypt or Argon2 for password hashing.
- API requests must validate input using Zod schemas.
- Implement rate-limiting on login/password-reset endpoints.
- All destructive operations require re-authentication or explicit confirmation.
- Protect against NoSQL injection through Mongoose and strict schema validation.
- Every API endpoint (except public ones) must have explicit role-based access checks.

## Fulfilment controls

- Storekeeper mutations use role checks plus optimistic versions; stale or simultaneous actions receive `409`.
- Batch eligibility is revalidated inside the transaction at both picking and packing time.
- Conditional batch updates prevent negative stock and simultaneous double movement.
- Every packing request must contain every allocated line exactly once and cannot exceed confirmed quantities.
- Issued invoice and package uniqueness is enforced per order, and issued invoice documents reject silent mutation.
- Shop Owner invoice reads enforce record ownership before returning JSON or PDF.
- Discrepancy, picking, packing and invoice events create append-only audit records and targeted notifications.

## Delivery controls

- Record-level checks limit Delivery Persons to their current assignment and Shop Owners to deliveries/proofs for owned shops.
- Critical writes are role checked, Zod validated, optimistic-versioned and idempotent; clients never set statuses directly.
- Package/invoice references, package count and custody acknowledgement are revalidated before pickup.
- OTPs are cryptographically generated, expire after ten minutes, have resend/attempt controls and are stored only as an application-secret digest.
- Proof uploads accept bounded JPEG/PNG content whose magic bytes match the declared MIME type. Proof reads re-check parent-delivery access.
- Camera and location are user initiated; the app explains purpose and requests foreground location only at confirmation.
- Offline storage never contains tokens, proof images or financial completion payloads. Safe status actions stay visibly unconfirmed and reuse stable idempotency keys; completion retries remain in memory and require an immediate server response.
- Positive delivery collections create exactly one Payment and validated proof in the completion transaction. They remain pending until configured verification posts balanced Ledger entries.

## Financial controls

- All financial inputs are safe integer minor units. Web/mobile decimal parsers use digit strings and BigInt; Invoice tax and proration use exact integer rounding.
- Payment creation, posting, failure, handover and reversal are separate role-checked commands with unique idempotency keys. Reusing a creation key with different content is rejected.
- Posted Payments reject generic update/delete operations. Ledger transactions and Payment attachments reject all update/delete operations; reversal appends the exact inverse journal.
- Debits and credits must balance before persistence. Unique source, Delivery, receipt and scoped transaction-reference indexes prevent duplicate effects.
- Overpayment is denied unless customer advance is enabled and explicitly authorised. Applying advance requires an open Invoice and sufficient derived advance liability.
- Shop Owner and Delivery Person access is record scoped. Attachment and receipt downloads re-run parent Payment ownership checks.
- Payment files are size bounded and magic-byte checked as JPEG, PNG or PDF. Financial/proof payloads are never stored in the mobile offline queue.
- Credit decisions use ledger balance, active shared Shop reservation exposure, overdue rules and manual block status. Overrides require a reason and immutable actor/position snapshot.

## Phase 9 notification and real-time controls

- The Socket.IO handshake verifies the access token, rejects non-active accounts and derives rooms server-side. A client cannot request a room; it receives only its own user room, its role room and the shop rooms it owns.
- The token travels in the handshake `auth` payload rather than a query string, so it does not land in proxy or server access logs. Socket CORS uses the same `CORS_ORIGINS` allow-list as the REST API.
- Every emit is room-targeted. There is no global broadcast, so an unrelated role cannot observe another domain's traffic.
- Notification queries are constrained by `recipientId` at the database layer. A cross-user mark-read attempt updates nothing rather than erroring, which avoids confirming that another user's notification exists.
- Activity visibility is stored per record. Shop Owner reads are additionally narrowed to shops they own, and an owner with no shop matches nothing rather than falling through to an unfiltered query.
- Push tokens are validated against the Expo token format before storage, so a raw device token or arbitrary string is never forwarded to a provider. A token is unique across users and moves to whoever registered it last; sign-out removes it.
- Outbound channel adapters send only the rendered title, body and link. Delivery OTP codes remain a CRITICAL in-app and SMS event and are never written to the activity timeline.
- In-app delivery cannot be disabled by preference, so a muted or quiet-hours-suppressed event still leaves an auditable record. Suppression is recorded with a reason rather than silently dropped.
- The admin test-send and delivery-inspection endpoints are restricted to Admin and Super Admin.

## Phase 10 configuration and administration controls

- Only Admin and Super Admin may read or change system settings. Every other role sees only the branding subset, which carries no finance, credit or security policy.
- Every settings group is validated by its own schema before it is stored, so a value that would corrupt downstream arithmetic — a tax rate above 100%, a fractional basis point, a zero-day near-expiry window — is rejected at the boundary rather than reaching an invoice.
- An unknown IANA time zone is rejected on save, because accepting one would break every subsequent date format at read time.
- Settings writes use per-group optimistic concurrency. A save composed against a stale read is refused, and the first writer of a group wins the unique-index race rather than being silently overwritten.
- Every settings change and reset is audited with the previous and new values and the acting administrator. A reset keeps the discarded values in the audit record.
- An Admin cannot administer an Admin or Super Admin account or grant either role; nobody can change their own role or deactivate their own account; the last active Super Admin cannot be demoted or deactivated.
- A role change or a non-active status revokes that user's sessions immediately, so a removed privilege cannot outlive the change in an open session.
- An administrative password reset forces a change at next sign-in, clears the lockout and signs out every session. The temporary password is never written to the audit log.
- Sign-in outcomes are audited. A failed attempt records the account and the attempt count but never the submitted password, and an unknown email records no actor rather than inventing one.
- Lockout thresholds and the minimum password length are policy, not constants, and can be tightened without a redeploy.
- The user directory escapes its search term, so a regular-expression metacharacter is matched literally instead of becoming a pattern. Password hashes are excluded from every administrative response.
- The audit log is read-only. There is no write, edit or delete endpoint for it in the application.

## Phase 11 returns and reporting controls

- A return may only be raised against an issued invoice for a delivered order, and only for lines that are actually on that invoice. Cumulative claims across every open return are checked against the invoiced quantity, so two requests can never together return more than was sold. A rejected or cancelled return releases its claim.
- Approval, receipt and crediting are separate actions with separate roles. A storekeeper cannot approve a return or issue credit, and a shop owner cannot receive their own goods or credit their own account.
- Cumulative credit notes cannot exceed the invoice they credit, checked inside the transaction that posts the ledger entry.
- Credit notes are immutable once issued and carry a snapshot of the supplier and customer identity. Correcting one means posting a balancing adjustment, never editing the original.
- An expired batch cannot be restocked. The units may still be received and written off, so the physical count stays honest without expired stock re-entering allocation.
- Every lifecycle action carries the record version and an idempotency key. A stale version is refused; a replayed key returns the original outcome, so a retried request after a dropped response cannot restock stock twice or credit an account twice.
- The whole return lifecycle is written to the append-only audit log with the actor, role, before and after values, IP address and user agent.
- CSV exports neutralise formula injection: any value beginning with `=`, `+`, `-` or `@` is prefixed with an apostrophe, so a shop name copied out of the database cannot execute when the file is opened in a spreadsheet. Exports are downloaded through the authenticated client so the access token travels in the header rather than a URL.
- Report access is role-gated per report, and a Shop Owner is narrowed to the shops they own rather than being allowed a shopId of their choosing.

## Phase 12 hardening

### Vulnerabilities found and closed in this phase

Each of these existed in code written in earlier phases and was found by auditing this one. All four are covered by tests that fail if the fix is reverted.

- **The sign-in response returned the account's bcrypt hash.** `login` loaded the whole user document to compare the password and then returned that document to the caller. The `User` model now strips `passwordHash`, `loginAttempts` and `lockoutUntil` at serialisation, so the safe outcome is the default rather than something each call site has to remember, and an integration test searches the whole payload rather than named fields.
- **Search terms were interpolated into `$regex` unescaped.** A caller could change what a shop search matched, or submit a pattern that costs the database far more than it costs them to send. Terms are now escaped and length-capped by `containsFilter`.
- **Query parameters were assigned straight into database filters.** With the default Express query parser, `?status[$ne]=DRAFT` arrives as an operator object. The parser is replaced with one that cannot produce nested objects, request bodies and route parameters are stripped of `$`-prefixed and dotted keys, and the affected controllers coerce each filter value to the type they compare it as.
- **Reuse detection missed the case it exists for.** Replaying an already-rotated refresh token was answered with an error while the live session kept working; only an already-revoked session triggered detection. A valid signature that does not match the stored hash is now treated as theft: every session for that user is revoked and the event is audited.

- **The first Super Admin had a published password.** `scripts/bootstrap.ts` created it with a credential hard-coded in this repository, printed it to the console, and left `forcePasswordChange` off — so any deployment that ran the documented bootstrap step had a highest-privilege account whose password anyone reading the source knew, valid indefinitely. The credential is now supplied by the operator, validated against the configured minimum length, never echoed, and must be changed at first sign-in; the script refuses to overwrite an existing Super Admin.

### Transport and request handling

- Helmet sets the security headers. The content security policy is `default-src 'none'` with no external origin permitted for scripts, styles, fonts or frames, `frame-ancestors 'none'`, `base-uri 'none'`, HSTS for a year with subdomains, and a permissions policy that turns off every browser feature this API does not use. `X-Powered-By` is removed.
- The API reference is served from the API itself rather than pulling Swagger UI from a CDN, so the policy above needs no third-party exception.
- `trust proxy` is configured by hop count from `TRUST_PROXY_HOPS`. A trusted-by-default proxy chain would let any caller forge `X-Forwarded-For` and with it their own rate-limit budget and audit trail.
- Request bodies are tiered: 256 KB by default, 4 MB on the delivery and payment routers, which carry base64 uploads already capped at 2 MB decoded and content-sniffed against their declared media type.
- Every request carries a correlation identifier, returned as `x-request-id`, attached to audit records and every log line, and included in every failure response. A caller-supplied value is honoured only when it matches `[\w-]{8,64}`.
- Unknown routes return the same JSON envelope as everything else rather than an HTML stack page.

### Rate limiting

Four separate budgets in one window, so a burst in one cannot lock a user out of another: sign-in and rotation (strict, these are the endpoints worth guessing at), state-changing requests, report aggregations, and a generous global backstop. Authenticated callers are keyed by user, so one shop behind a shared office address cannot exhaust another's budget. With Redis configured the budget is shared across instances; without it each instance keeps its own, which is a documented property of a single-instance deployment rather than a hidden one. The limiter fails open on a store failure and logs it, because a rate limiter that fails closed turns a Redis blip into an outage.

### Sessions and tokens

- An access token names the session that issued it, and that session's revocation is checked on every authenticated request and on every realtime handshake. Revoking a session — by the user, by an administrator, or by a role change — now takes effect immediately instead of at the end of the access token's lifetime.
- Refresh tokens are stored as an HMAC keyed on the refresh secret rather than a bcrypt hash. bcrypt exists to make a low-entropy secret expensive to guess; a refresh token is high-entropy inside a signed JWT, so the deliberate cost bought nothing and was being paid twice per rotation. Sessions written before this phase still verify against their bcrypt hash until they rotate, so nobody is signed out by the change.
- The refresh cookie is HTTP-only, `SameSite=Strict`, `Secure` in production and scoped to `/api/v1/auth`, so it is not sent on requests to any other endpoint.
- Access and refresh tokens are typed and may optionally use separate secrets, so one cannot be presented as the other.
- Sessions expire from the database on a TTL index with a grace period, which is what lets reuse detection still recognise a stolen token rather than seeing a missing session.
- Every user can list their own sessions and end any of them; ending someone else's returns "not found" rather than "forbidden", so an identifier reveals nothing.
- Sign-in pays the same bcrypt cost whether the account exists, is inactive, is locked or has the wrong password, so response time no longer discloses which addresses have accounts.

### Errors and logging

Failures a caller can act on keep their message. Anything else is reported as an internal failure with a correlation identifier and nothing more, because an unexpected exception's message routinely contains a hostname, a file path or part of the query that failed. Validation failures return the offending paths and reasons but never the submitted values. Logs are structured JSON, and any field whose name looks like a credential — password, hash, token, authorization, cookie, OTP, signature, base64 data — is redacted before it is written, with bounded depth, breadth and string length.

### Secrets and configuration

Signing secrets are length-checked at boot, and production refuses to start with the example values. Invalid configuration is reported by field name and reason, never by value, because a bad value is frequently a secret pasted into the wrong variable. Infrastructure configuration stays in the environment and is not editable through the application; business configuration lives in System Settings as of Phase 10.
