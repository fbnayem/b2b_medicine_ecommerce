import { describe, expect, it } from 'vitest';
import { isCalled, normalise } from './paths';

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

/*
 * `normalise`, `methodBefore` and `isCalled` moved to `src/api/paths.ts` when
 * `navigation/permissions.test.ts` needed the same parse for the opposite
 * question — that one asks what a screen calls, this one asks whether anything
 * still calls an endpoint. Two implementations of "what counts as a call" would
 * let the two gates disagree, and the disagreement would be silent.
 */

/**
 * What somebody must be able to do from this application, by the endpoint that
 * does it.
 *
 * The first sixteen are a pharmacy's, because this file was written during the
 * Shop phase. The rest are a warehouse's, a counter's and a goods-in door's —
 * the defect has nothing to do with which role is holding the phone.
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
    method: 'get',
    path: '/inventory/medicines/{}/alternatives',
    capability:
      'find another brand of the same medicine when the one they asked for has no stock, ' +
      'instead of being told "out of stock" and left to ring somebody',
  },
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

  /*
   * The four endpoints that answer with a **file** rather than with JSON, and
   * the two that finish a job the screens above only started.
   *
   * These are the second sweep. The first one found the endpoints a screen
   * would obviously call; these are the ones a screen *mentions* — the invoice
   * that was rendered but could not be obtained, the credit note whose
   * reference was printed with no way to open it, the attachment that was
   * announced as the word "Attachment" and nothing else.
   */
  {
    method: 'get',
    path: '/fulfilment/invoices/{}/pdf',
    capability:
      'keep or send the invoice document itself — to print for the file behind the counter, ' +
      'or to pass to whoever pays the bills',
  },
  {
    method: 'get',
    path: '/returns/credit-notes/{}',
    capability: 'obtain the credit note that proves the money for a return came back',
  },
  {
    method: 'get',
    path: '/deliveries/proof/{}',
    capability: 'see who actually signed for a delivery, and what was photographed at the door',
  },
  {
    method: 'get',
    path: '/payments/{}/attachment',
    capability: 'see the deposit slip filed against a payment, when a balance is queried',
  },
  {
    method: 'post',
    path: '/notifications/archive',
    capability:
      'take something out of the inbox — the only thing that shortens a list which otherwise ' +
      'grows for as long as the account exists',
  },
  {
    method: 'delete',
    path: '/orders/drafts/{}',
    capability:
      'withdraw a saved order, so emptying the basket does not leave the distributor holding ' +
      'a draft for goods nobody wants',
  },

  /*
   * The staff half — MedSupply Manage. This file was written for a pharmacy and
   * the entries above are all a pharmacy's, but the defect it guards has
   * nothing to do with which role is holding the phone: a finished endpoint
   * with no caller is finished work nobody can use.
   *
   * These are the ones a **warehouse, a counter or a goods-in door** needs, and
   * the four at the end had no caller on any client at all.
   */
  {
    method: 'post',
    path: '/stocktakes/{}/counts',
    capability:
      'count a rack from the aisle it is in, rather than on paper to be typed up at a desk ' +
      'afterwards',
  },
  {
    method: 'post',
    path: '/stocktakes/{}/post',
    capability: 'post a finished count to stock, so what the shelf says is what the system says',
  },
  {
    method: 'post',
    path: '/purchasing/orders/{}/receipts',
    capability:
      'book a delivery in at the door it arrives at, with the batch number and expiry read ' +
      'off the carton rather than transcribed twice',
  },
  {
    method: 'get',
    path: '/purchasing/recall/batches',
    capability:
      'find a batch by the number printed on a manufacturer’s recall notice, standing in ' +
      'front of the shelves',
  },
  {
    method: 'get',
    path: '/purchasing/controlled-register',
    capability: 'produce the prescription-medicine return an inspector asks for, in the stockroom',
  },
  {
    method: 'post',
    path: '/fulfilment/picking/{}/{}',
    capability:
      'decide a discrepancy that has stopped a picking list, which otherwise leaves a ' +
      'storekeeper standing still until somebody reaches a desk',
  },
  {
    method: 'post',
    path: '/orders/{}/cancellation-decision',
    capability: 'answer a customer who has asked to cancel, releasing the stock and the credit',
  },
  {
    method: 'get',
    path: '/finance/shops/{}/summary',
    capability:
      'see what a customer owes while standing at their counter, which is what decides ' +
      'whether to take the order',
  },
  {
    method: 'post',
    path: '/payments',
    capability: 'record money handed over, where it is handed over',
  },
  {
    method: 'patch',
    path: '/pricing/price-lists/{}',
    capability: 'correct one price without the whole list being on screen at once',
  },
  {
    method: 'get',
    path: '/inventory/batches/{}',
    capability:
      'see how much of a batch is already promised to an approved order — the difference ' +
      'between what is on the shelf and what may be sold',
  },
  {
    method: 'get',
    path: '/reports/orders',
    capability: 'see how many submitted orders actually become deliveries',
  },
  {
    method: 'get',
    path: '/reports/stock-movements',
    capability: 'see what moved in and out of stock over a period, and why',
  },
  {
    method: 'get',
    path: '/activity',
    capability: 'find out what has been happening, after a day away',
  },

  /*
   * A rider's whole day, added in Phase 40.
   *
   * Not one of these was named here before, and none of them could be: both of
   * a rider's busiest screens assembled the path from a variable —
   * `` `/deliveries/${id}/${step}` `` — so the entire round was exempt from the
   * gate. Deleting the button that tells the office a rider has reached the
   * shop failed nothing anywhere in the repository.
   */
  {
    method: 'post',
    path: '/deliveries/{}/acknowledge',
    capability:
      'confirm they have the packages a storekeeper handed them — the handover is not ' +
      'finished until somebody says they took it',
  },
  {
    method: 'post',
    path: '/deliveries/{}/pickup',
    capability: 'say the goods have physically left the building',
  },
  {
    method: 'post',
    path: '/deliveries/{}/start',
    capability: 'go on the road, which is what lets the shop see the delivery coming',
  },
  {
    method: 'post',
    path: '/deliveries/{}/arrived',
    capability: 'say they are at the door, which is what turns the proof screen on',
  },
  {
    method: 'post',
    path: '/deliveries/{}/send-otp',
    capability:
      'send the customer the six digits that prove the person signing is the person ' +
      'the order was for',
  },
  {
    method: 'post',
    path: '/deliveries/{}/complete',
    capability:
      'finish a delivery: who took it, the signature, the photograph, and any cash ' +
      'handed over at the door',
  },
  {
    method: 'post',
    path: '/deliveries/{}/fail',
    capability:
      'report that a delivery did not happen, with the reason management reads to decide ' +
      'whether to send them back',
  },
  {
    method: 'post',
    path: '/deliveries/{}/returning',
    capability: 'tell the warehouse that goods are coming back, before they arrive',
  },
  {
    method: 'post',
    path: '/deliveries/{}/handover',
    capability: 'hand a packed order to the rider who is going to carry it',
  },
  {
    method: 'post',
    path: '/deliveries/{}/returned',
    capability: 'book undelivered goods back into the warehouse',
  },
  {
    method: 'get',
    path: '/trips',
    capability: 'see the round they are meant to drive today, in the order the office planned',
  },
  {
    method: 'post',
    path: '/trips/{}/start',
    capability: 'begin the round, so the office knows the van has left',
  },
  {
    method: 'get',
    path: '/finance/my/collections',
    capability:
      'count the cash they are carrying — the money is on the customer’s account the ' +
      'moment it is taken, and this is the only view of what is still in the bag',
  },
  {
    method: 'post',
    path: '/payments/{}/handover',
    capability: 'hand that cash in at the end of the day and stop being answerable for it',
  },
  {
    method: 'post',
    path: '/returns/{}/collect',
    capability:
      'take back goods a shop is sending — the returns screen already filters a rider’s ' +
      'list down to exactly this queue',
  },

  /*
   * The catalogue's reading half, added with the monograph.
   *
   * Until this phase a medicine's page said what a product costs and how many
   * are on the shelf, and nothing about the product itself — the supplier's
   * copy existed on the server with no screen anywhere that asked for it.
   */
  {
    method: 'get',
    path: '/inventory/medicines/{}/content',
    capability:
      'read what a medicine is for, how it is taken and whether it is safe in pregnancy ' +
      'or with a failing kidney — at the counter, in Bangla where the supplier shipped it',
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
        `${entry.method.toUpperCase()} ${entry.path}\n      so that somebody can: ${entry.capability}`,
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
