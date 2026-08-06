import { describe, expect, it } from 'vitest';

/**
 * **Every endpoint this application exists to reach has something that reaches
 * it.**
 *
 * The defect this is built for is not a bug in any one file. It is that a
 * `SHOP_OWNER` may call 55 endpoints and this client called 22 of them — so
 * reordering, cancelling, raising a return, reading an invoice, tracking a
 * delivery, changing a password and pricing a basket correctly were all
 * *finished server work with no way to use it*. Every test passed the whole
 * time, because a screen that does not exist has nothing to fail.
 *
 * A coverage percentage cannot catch that either: the API's own
 * `routeCoverage.test.ts` reads 100% documented and 98% tested while a third of
 * a customer's endpoints had no caller on the device they use. Coverage of the
 * server says nothing about whether the client ever asks.
 *
 * So this is a **list**, in the same spirit as the waiver lists next door:
 * every entry names an endpoint and the sentence that says why a customer needs
 * it. Deleting the screen that calls one fails this file, and the failure names
 * the capability rather than the file — which is the difference between "a test
 * broke" and "a pharmacy can no longer send anything back".
 *
 * Read through Vite rather than `node:fs`, as `catalogueKeys.test.ts` and
 * `tokenDiscipline.test.ts` do and for the same reason: code that ships to
 * Hermes must not be able to reach a filesystem.
 */
const RAW = import.meta.glob(['../../app/**/*.tsx', '../**/*.ts', '../**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * A template's interpolations flattened to `{}`, so one pattern matches both
 * `'/returns'` and `` `/orders/${id}/duplicate` ``.
 *
 * The path in the table is then written the way the OpenAPI document writes
 * one, minus the parameter names — which nobody agrees on between a client and
 * a specification anyway.
 */
function normalise(raw: string): string {
  return raw.replace(/\$\{[^{}]*\}/g, '{}');
}

const METHOD = /\.(get|post|patch|put|delete)\b/g;

/**
 * Which HTTP method a path literal is being passed to.
 *
 * The nearest preceding `.get(`/`.post(`/… with **no closing parenthesis**
 * between it and the path — which is what says the call has not already ended.
 * That tolerates the two shapes this codebase actually writes: a generic
 * argument (`.post<Envelope<{ _id: string }>>('/returns', …)`, semicolons and
 * all) and a ternary (`.post(draftId ? … : '/orders/submit', …)`), while a path
 * sitting after some unrelated finished call is separated from it by the `)`
 * that finished it.
 *
 * **The method is half the capability.** `GET /returns` lists the returns a
 * shop has raised; `POST /returns` raises one. Without this, the list screen
 * satisfies the entry and deleting the whole return form goes unnoticed — which
 * is precisely what happened when this rule was first written without it.
 */
function methodBefore(source: string, index: number): string | undefined {
  METHOD.lastIndex = 0;
  let found: { method: string; end: number } | undefined;
  for (let match = METHOD.exec(source); match; match = METHOD.exec(source)) {
    if (match.index >= index) break;
    found = { method: match[1]!, end: match.index + match[0].length };
  }
  if (!found) return undefined;
  const between = source.slice(found.end, index);
  return between.includes(')') ? undefined : found.method;
}

/**
 * The endpoint must be followed by the end of its string, or a query.
 *
 * Without that boundary, `/shops/my/addresses` would be satisfied by the
 * *sub*-path `/shops/my/addresses/{}` — so deleting the "add an address" call
 * would pass because editing one still exists.
 */
function isCalled(method: string, path: string, sources: readonly string[]): boolean {
  return sources.some((source) => {
    let from = 0;
    for (;;) {
      const at = source.indexOf(path, from);
      if (at < 0) return false;
      const next = source[at + path.length];
      const ends = next === "'" || next === '"' || next === '`' || next === '?';
      if (ends && methodBefore(source, at) === method) return true;
      from = at + 1;
    }
  });
}

/**
 * What a pharmacy must be able to do from this application, by the endpoint
 * that does it.
 *
 * The reasons are not decoration: a failure here prints them, and "a pharmacy
 * can no longer find out where an order is" is a sentence somebody can act on
 * where "callers.test.ts:41 failed" is not.
 */
const MUST_REACH: ReadonlyArray<{ method: string; path: string; capability: string }> = [
  {
    method: 'post',
    path: '/orders/quote',
    capability:
      'see what this shop will actually pay — the only endpoint that applies their ' +
      'discount, their price list, free goods and the delivery charge',
  },
  { method: 'post', path: '/orders/submit', capability: 'send an order to the distributor' },
  { method: 'post', path: '/orders/{}/duplicate', capability: 'order the same thing again' },
  {
    method: 'post',
    path: '/orders/{}/cancellation-request',
    capability: 'ask for an order to be cancelled before it is dispatched',
  },
  {
    method: 'get',
    path: '/deliveries/order/{}',
    capability: 'find out where an order is, without opening the rider’s working screen',
  },
  {
    method: 'get',
    path: '/fulfilment/invoices/{}',
    capability: 'read an invoice, with the batch numbers a return has to name',
  },
  {
    method: 'get',
    path: '/finance/my/invoices',
    capability: 'choose the invoice a return is raised against',
  },
  {
    method: 'get',
    path: '/finance/my/summary',
    capability: 'see what is owed, and whether credit is blocked',
  },
  {
    method: 'get',
    path: '/finance/my/statement',
    capability: 'see everything charged and paid between two dates',
  },
  { method: 'post', path: '/returns', capability: 'send damaged or short-dated goods back' },
  {
    method: 'post',
    path: '/auth/change-password',
    capability: 'change a password on the device most likely to be lost',
  },
  {
    method: 'post',
    path: '/auth/register',
    capability: 'open an account without telephoning the distributor',
  },
  {
    method: 'post',
    path: '/shops/my/addresses',
    capability: 'add a delivery address, without which no order can be sent at all',
  },
  {
    method: 'patch',
    path: '/shops/my/addresses/{}',
    capability: 'correct an address, or change which one deliveries go to',
  },
  {
    method: 'delete',
    path: '/shops/my/addresses/{}',
    capability: 'remove an address the shop no longer uses',
  },
  {
    method: 'get',
    path: '/shops/my',
    capability: 'read the shop’s own delivery addresses at checkout',
  },
];

function sources(): Array<[string, string]> {
  return Object.entries(RAW)
    .map(
      ([path, raw]) =>
        [
          path
            .replace(/^\.\.\/\.\.\//, '')
            .replace(/^\.\.\//, 'src/')
            .replace(/^\.\//, 'src/api/'),
          normalise(String(raw)),
        ] as [string, string],
    )
    .filter(([file]) => !file.includes('.test.'));
}

describe('what a pharmacy can do from this application', () => {
  it('found the source to search, so a clean run is not an empty one', () => {
    // A glob matching nothing would satisfy every rule below in silence — the
    // exact shape of a gate that has quietly stopped working.
    expect(sources().length).toBeGreaterThan(40);
  });

  it('reaches every endpoint it exists to reach', () => {
    const code = sources().map(([, raw]) => raw);
    const unreachable = MUST_REACH.filter((entry) => !isCalled(entry.method, entry.path, code)).map(
      (entry) =>
        `${entry.method.toUpperCase()} ${entry.path}\n      so that a shop can: ${entry.capability}`,
    );

    expect(
      unreachable,
      'These endpoints exist on the server and nothing on this client calls them. Each ' +
        'is finished work a pharmacy cannot use:\n  ' +
        unreachable.join('\n  ') +
        '\nEither restore the caller, or remove the entry and the endpoint with it.',
    ).toEqual([]);
  });

  it('the matcher finds what it claims to, and misses what it should', () => {
    /*
     * The self-proof. A matcher that returned `true` unconditionally would make
     * the rule above vacuous while looking perfect, and one that ignored either
     * the boundary or the method would accept a near-miss as the real thing.
     */
    const sample = normalise('apiClient.post(`/orders/${order._id}/duplicate`)');
    expect(isCalled('post', '/orders/{}/duplicate', [sample])).toBe(true);
    expect(isCalled('post', '/orders/{}/cancellation-request', [sample])).toBe(false);

    /*
     * **The method matters.** Written without it, this rule passed while the
     * whole return form was deleted, because `GET /returns` — the list of
     * returns already raised — sits in the same application and matched.
     */
    expect(
      isCalled('get', '/returns', ["apiClient.get<Envelope<T>>('/returns', { params })"]),
    ).toBe(true);
    expect(
      isCalled('post', '/returns', ["apiClient.get<Envelope<T>>('/returns', { params })"]),
    ).toBe(false);

    // A path is not satisfied by something longer that starts with it.
    const child = "apiClient.patch('/shops/my/addresses/{}')";
    expect(isCalled('patch', '/shops/my/addresses/{}', [child])).toBe(true);
    expect(isCalled('post', '/shops/my/addresses', [child])).toBe(false);

    // The generic argument and the ternary are the two shapes this codebase
    // writes, and both have to resolve to the method that precedes them. The
    // generic may itself contain semicolons, which is why only a closing
    // parenthesis is treated as the end of a call.
    expect(
      isCalled('post', '/orders/submit', [
        normalise("apiClient.post(draftId ? `/orders/drafts/${id}/submit` : '/orders/submit', {}"),
      ]),
    ).toBe(true);
    expect(
      isCalled('post', '/returns', [
        "apiClient.post<Envelope<{ _id: string; reference: string }>>('/returns', {",
      ]),
    ).toBe(true);

    // A finished call does not lend its method to whatever follows it.
    expect(
      isCalled('get', '/second', ["await apiClient.get('/first'); const x = '/second';"]),
    ).toBe(false);

    // A query string still counts as the end of the path.
    expect(isCalled('get', '/shops', ["apiClient.get('/shops?awaitingTerms=true')"])).toBe(true);

    // And an endpoint nothing calls is reported as such.
    expect(
      isCalled(
        'post',
        '/nothing/calls/this',
        sources().map(([, raw]) => raw),
      ),
    ).toBe(false);
  });

  it('names no endpoint and method twice, so the count means something', () => {
    const keys = MUST_REACH.map((entry) => `${entry.method} ${entry.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry says what it is for, in words a shop would use', () => {
    // A list of paths with no reasons becomes a list nobody dares delete from.
    const silent = MUST_REACH.filter((entry) => entry.capability.trim().length < 20);
    expect(silent).toEqual([]);
  });
});
