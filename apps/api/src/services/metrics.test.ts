import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import { recordRequest, renderPrometheus, resetMetrics, routeLabel } from './metrics';

/**
 * The guard that matters here is **cardinality**, not arithmetic.
 *
 * A Prometheus label built from a URL rather than a route template creates one
 * time series per order, per payment, per batch — and a scraper pointed at a
 * busy deployment will fall over long before anyone notices the labels are
 * wrong. The counters themselves are trivial; the identifier stripping is the
 * part that has to keep working.
 */

function fakeRequest(baseUrl: string, routePath?: string, path = '/'): Request {
  return {
    baseUrl,
    route: routePath ? { path: routePath } : undefined,
    path,
  } as unknown as Request;
}

test('a route label never carries an identifier', () => {
  assert.equal(routeLabel(fakeRequest('/api/v1/orders', '/:id')), '/api/v1/orders/:id');
  // Unmatched routes fall back to the URL, which is where a raw id would leak.
  assert.equal(
    routeLabel(fakeRequest('', undefined, '/api/v1/orders/507f1f77bcf86cd799439011')),
    '/api/v1/orders/:id',
  );
  assert.equal(
    routeLabel(fakeRequest('', undefined, '/api/v1/invoices/507f1f77bcf86cd799439011/pdf')),
    '/api/v1/invoices/:id/pdf',
  );
  assert.equal(
    routeLabel(fakeRequest('', undefined, '/api/v1/reports/2026/08')),
    '/api/v1/reports/:id/:id',
  );
});

test('a label is bounded in length so one bad path cannot dominate a scrape', () => {
  const long = `/api/v1/${'x'.repeat(500)}`;
  assert.ok(routeLabel(fakeRequest('', undefined, long)).length <= 120);
});

test('counters accumulate per method, route and status', async () => {
  resetMetrics();
  recordRequest('get', '/api/v1/orders', 200, 12);
  recordRequest('GET', '/api/v1/orders', 200, 8);
  recordRequest('GET', '/api/v1/orders', 500, 3);

  const rendered = await renderPrometheus();
  assert.match(
    rendered,
    /medsupply_requests_total\{method="GET",route="\/api\/v1\/orders",status="200"\} 2/,
  );
  assert.match(
    rendered,
    /medsupply_request_duration_ms_sum\{method="GET",route="\/api\/v1\/orders",status="200"\} 20\.0/,
  );
  // Only 5xx counts as a server error; a 401 is the caller's problem.
  assert.match(rendered, /medsupply_server_errors_total 1/);
});

test('the ledger gauge is exposed and distinguishes "balanced" from "unchecked"', async () => {
  resetMetrics();
  const rendered = await renderPrometheus();
  const match = rendered.match(/medsupply_ledger_unbalanced_transactions (-?\d+)/);
  assert.ok(match, 'the ledger gauge must always be emitted');
  /*
   * With no database connected the check cannot run, and the gauge must say so
   * with -1 rather than 0. An alert reading "zero unbalanced transactions" when
   * nothing was actually examined is worse than no alert at all.
   */
  assert.equal(match[1], '-1');
});

test('label values cannot break the exposition format', async () => {
  resetMetrics();
  recordRequest('GET', '/api/v1/"quoted"\\path', 200, 1);
  const rendered = await renderPrometheus();
  assert.match(rendered, /route="\/api\/v1\/\\"quoted\\"\\\\path"/);
  // Every line is either a comment or `name{labels} value` / `name value`.
  for (const line of rendered.trim().split('\n')) {
    assert.ok(
      line.startsWith('#') || /^[a-z_]+(\{.*\})? -?[\d.]+$/.test(line),
      `malformed exposition line: ${line}`,
    );
  }
});
