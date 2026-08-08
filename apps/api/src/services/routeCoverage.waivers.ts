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
 * the burn-down, and a burn-down nobody can read the number off is a mood.
 *
 * **186 routes. 186 documented. 182 reached by an integration test, and the
 * four that are not are the four the recorder cannot see.**
 *
 * It was 187 until `GET /payments/my-collections` was removed — a byte-for-byte
 * duplicate of `GET /finance/my/collections` that no client called. A burn-down
 * can also go down by deleting the thing being counted.
 *
 * Both lists are therefore finished. What they leave behind is a gate rather
 * than a number: a new route that is undocumented, or that no test calls, now
 * fails the build the moment it is added — which is what these lists were
 * always for, and what a percentage could never have provided.
 * (The earlier "150 routes" in this comment was itself stale by 37 — the same
 * drift that left `docs/openapi.json` describing 72 operations against 110.)
 */

/**
 * Served, but absent from the OpenAPI document.
 *
 * **Empty. 186 of 186 documented.**
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
 * **4 of 186**, from 81 — and all four are the health probes and `/metrics`,
 * which the recorder structurally cannot see. Their reason is written beside
 * them below and it is not "nobody got to them".
 *
 * Coverage is recorded live by `routeCoverageRecorder()` rather than inferred
 * from test source, so a test that merely mentions a path in a string does not
 * count as covering it.
 *
 * Seven tranches went in, ordered by what a real user's journey touches rather
 * than by what was easy to write:
 *
 *   finance         18   the money first, deliberately
 *   administration  10   including `POST /users` itself, whose original role
 *                        bug is now planted and caught rather than only cited
 *   warehouse       10   stock, and the buckets it moves between
 *   the inbox        6   whose ids belong to whom
 *   order journey   13   draft, amend, submit, review, reject, pick
 *   the last mile   14   the delivery board, returns, and four reports
 *
 * `docs/TESTING.md` carries the table.
 */
export const UNTESTED_ROUTES: readonly string[] = [
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
];
