/**
 * The burn-down lists for `routeCoverage.test.ts`.
 *
 * Every entry is an endpoint this project ships without the corresponding
 * guarantee. They are written out one by one, rather than summarised as a
 * percentage, because a percentage hides *which* endpoints are unguarded — and
 * the endpoint that mattered here was `POST /api/v1/users`, whose role bug
 * survived twelve phases precisely because nothing called it.
 *
 * The rules that make these lists useful:
 *
 *   - Adding an entry is a deliberate act, reviewed like any other change.
 *   - Removing an entry is automatic: the moment a route becomes covered, the
 *     test fails on the stale waiver until it is struck off. The list can
 *     therefore only shrink, which is the whole point.
 *
 * The counts below are stated as figures rather than as prose because they are
 * the burn-down, and a burn-down nobody can read the number off is a mood. At
 * the time of writing: **187 routes, 187 documented, 156 covered by an
 * integration test.**
 * (The earlier "150 routes" in this comment was itself stale by 37 — the same
 * drift that left `docs/openapi.json` describing 72 operations against 110.)
 */

/**
 * Served, but absent from the OpenAPI document.
 *
 * **Empty. 187 of 187 documented.**
 *
 * It began at 91, and the last 77 went in one pass because the roles assertion
 * had made the exercise worth doing: every `roles` list written here is checked
 * against the mounted router, so documenting an endpoint means stating who may
 * call it and being told immediately if that is wrong.
 *
 * Keeping it empty is now the gate's job — a new route with no `OPERATIONS`
 * entry fails the build rather than joining a list.
 *
 * Writing them out surfaced one thing worth acting on: **four write endpoints
 * validate their request body by hand rather than through a Zod schema**, so
 * they are the four operations in the document with no request shape. They are
 * `PATCH /inventory/batches/{id}/block`, `PATCH /shops/{id}/status`,
 * `POST /shops/{id}/assign-owner` and `POST /shops/{id}/assign-manager`. Each
 * is marked in `openapi.ts` where it is declared.
 */
export const UNDOCUMENTED_ROUTES: readonly string[] = [];

/**
 * Served, but no integration test reaches them.
 *
 * **31 of 187**, from 81. Recorded live by `routeCoverageRecorder()` rather than
 * inferred from test source, so a test that merely mentions a path in a string
 * does not count as covering it.
 *
 * Four of the thirty-one are the health probes and `/metrics`, which the
 * recorder structurally cannot see; their reason is written beside them below.
 * So **twenty-seven** are genuinely untested, in four tranches that remain:
 * orders and drafts, approvals, returns, and deliveries with their reports.
 * `docs/TESTING.md` carries the table, because "81 → 31" without saying which
 * is the same dishonesty as a percentage.
 *
 * Four tranches went in: **finance** (18 — the money first, deliberately),
 * **administration** (10, including `POST /users` itself, whose original role
 * bug is now planted and caught rather than only cited), **warehouse** (10),
 * and **the inbox** (6).
 */
export const UNTESTED_ROUTES: readonly string[] = [
  'delete /api/v1/orders/drafts/:id',
  'get /api/v1/approvals/:id',
  'get /api/v1/approvals/queue',
  'get /api/v1/deliveries',
  'get /api/v1/deliveries/:id',
  'get /api/v1/deliveries/personnel',
  'get /api/v1/deliveries/proof/:fileId',
  'get /api/v1/fulfilment/picking/:id',
  'get /api/v1/fulfilment/queue',
  'get /api/v1/orders/:id',
  'get /api/v1/reports/deliveries',
  'get /api/v1/reports/orders',
  'get /api/v1/reports/returns',
  'get /api/v1/reports/sales/breakdown',
  'get /api/v1/returns/:id',
  'get /api/v1/returns/credit-notes/:id',
  /*
   * These four are mounted directly on the application, ahead of the coverage
   * recorder, so that a degraded process can still answer a probe and a scraper
   * can still be served while the rate limiter is refusing everything else.
   * That position is also why the recorder never sees them — not an absence of
   * tests. All four are exercised in `hardeningIntegration.test.ts`:
   * "health and readiness report the database honestly" and "metrics expose the
   * ledger gauge without leaking an identifier into a label".
   */
  'get /health',
  'get /health/ready',
  'get /health/version',
  'get /metrics',
  'patch /api/v1/orders/drafts/:id',
  'post /api/v1/approvals/:id/clarify',
  'post /api/v1/approvals/:id/hold',
  'post /api/v1/approvals/:id/reject',
  'post /api/v1/deliveries/:id/cancel',
  'post /api/v1/orders/:id/duplicate',
  'post /api/v1/orders/drafts',
  'post /api/v1/orders/drafts/:id/submit',
  'post /api/v1/returns/:id/collect',
  'post /api/v1/returns/:id/reject',
  'post /api/v1/returns/:id/review',
];
