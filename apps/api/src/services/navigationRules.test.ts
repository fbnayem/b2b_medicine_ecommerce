import test from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '@medsupply/shared-types';
import { MOBILE_TABS, NAV_ITEMS } from '@medsupply/navigation';
import { routeKey, routeTable } from './routeTable';
import { SCREENS_WITHOUT_READS, SCREEN_READS } from './navigationReads';

/**
 * The fifth reconciliation: **a screen the navigation offers must be a screen
 * the API will serve.**
 *
 * The other four (`routeCoverage.test.ts`) line the router up against the
 * specification and against the tests. None of them look at the clients, and
 * this exact defect has now been found three times by hand: `DELIVERY_PERSON`
 * could not open the delivery board that is their entire job; `SALES` opened an
 * order-entry screen whose customer picker returned 403; and the audit that
 * preceded this file found four more by sampling twelve of roughly sixty
 * navigation entries. Three separate discoveries of one defect class is the
 * argument for a gate rather than a fourth reading.
 *
 * A conflict here is not cosmetic. The person sees a menu item, taps it, and
 * gets an empty screen or an error — with no way to tell whether the system is
 * broken or they are not allowed. The navigation promised something the server
 * had no intention of honouring.
 *
 * The comparison is against the **router**, not the specification: what a role
 * may actually do is decided by `requireRole`, and the document has twice been
 * the thing that was wrong.
 */

/** OpenAPI writes `{id}`; Express writes `:id`. Same route, two notations. */
const toExpressKey = (declared: string): string => declared.replace(/\{(\w+)\}/g, ':$1');

/**
 * Roles the router admits, by route key.
 *
 * A route with no `requireRole` restricts by nothing of its own — anybody
 * authenticated reaches it — so it is recorded as every role rather than as
 * none, which is the difference between "unguarded" and "forbidden to all".
 */
function admittedRoles(): Map<string, readonly UserRole[]> {
  const everyRole = Object.values(UserRole);
  return new Map(
    routeTable().map((route) => [routeKey(route), route.roles?.length ? route.roles : everyRole]),
  );
}

const navById = new Map(NAV_ITEMS.map((item) => [item.id, item]));

test('every screen is either reconciled or explicitly excused, and no screen is both', () => {
  /*
   * The bookkeeping that keeps the check below honest. Without it a screen can
   * be quietly dropped from `SCREEN_READS` and stop being checked, which is the
   * failure mode of every table maintained beside the thing it describes.
   */
  const declared = new Set(Object.keys(SCREEN_READS));
  const excused = new Set(Object.keys(SCREENS_WITHOUT_READS));

  const both = [...declared].filter((id) => excused.has(id)).sort();
  assert.deepEqual(both, [], 'a screen cannot both declare a read and claim to have none');

  const unknown = [...declared, ...excused].filter((id) => !navById.has(id)).sort();
  assert.deepEqual(unknown, [], 'these entries name screens the navigation no longer has');

  const unaccounted = NAV_ITEMS.map((item) => item.id)
    .filter((id) => !declared.has(id) && !excused.has(id))
    .sort();
  assert.deepEqual(
    unaccounted,
    [],
    'These screens are neither reconciled nor excused, so nothing checks that the ' +
      'roles offered them can reach them:\n' +
      unaccounted.map((id) => `  ${id}`).join('\n') +
      '\nAdd them to SCREEN_READS, or to SCREENS_WITHOUT_READS with the reason.',
  );
});

test('a declared read names a route that exists', () => {
  /*
   * Otherwise a typo silently exempts a screen: the check below skips what it
   * cannot resolve, so an unresolvable entry would read as a pass.
   */
  const real = admittedRoles();
  const phantom: string[] = [];
  for (const [id, reads] of Object.entries(SCREEN_READS)) {
    for (const read of reads) {
      const [method, path] = read.split(' ');
      if (!real.has(`${method!.toLowerCase()} ${toExpressKey(path!)}`))
        phantom.push(`${id}: ${read}`);
    }
  }
  assert.deepEqual(phantom, [], `These reads name no mounted route:\n  ${phantom.join('\n  ')}`);
});

test('every role the navigation offers a screen to can open it', () => {
  const admitted = admittedRoles();
  const conflicts: string[] = [];

  for (const [id, reads] of Object.entries(SCREEN_READS)) {
    const item = navById.get(id)!;
    for (const read of reads) {
      const [method, path] = read.split(' ');
      const allowed = admitted.get(`${method!.toLowerCase()} ${toExpressKey(path!)}`)!;
      const refused = item.roles.filter((role) => !allowed.includes(role));
      if (refused.length === 0) continue;
      conflicts.push(
        `  ${id} (${item.path}) needs ${read}\n` +
          `      offered to : ${[...item.roles].sort().join(', ')}\n` +
          `      admitted   : ${[...allowed].sort().join(', ')}\n` +
          `      refused    : ${refused.sort().join(', ')}`,
      );
    }
  }

  assert.deepEqual(
    conflicts,
    [],
    'The navigation offers screens the API refuses. Each of these is a menu item that ' +
      'opens onto an error:\n' +
      conflicts.join('\n') +
      '\nEither widen the route’s roles or narrow the navigation entry — whichever ' +
      'matches what the person is actually allowed to do.',
  );
});

test('every mobile tab is a screen its role can open', () => {
  /*
   * The tab bar is a stronger promise than a menu: it is on screen at all
   * times, and a role gets exactly five. One that leads nowhere is a fifth of
   * the application gone. `MOBILE_TABS` is a separate list from `NAV_ITEMS`,
   * so it can disagree with both the navigation and the API independently.
   */
  const wrong: string[] = [];
  for (const [role, tabs] of Object.entries(MOBILE_TABS)) {
    for (const tab of tabs) {
      const item = navById.get(tab);
      if (!item) {
        wrong.push(`${role}: tab "${tab}" is not a navigation entry at all`);
        continue;
      }
      if (!item.roles.includes(role as UserRole)) {
        wrong.push(`${role}: tab "${tab}" is not offered to them by NAV_ITEMS`);
      }
    }
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('the rule detects what it claims to, so a clean run means something', () => {
  /*
   * The reconciliation is only as good as the route reflection underneath it.
   * If `routeTable()` ever returns nothing — a refactor of the mount order, a
   * change to how Express exposes its stack — every check above passes by
   * finding nothing to compare, which is the exact shape of a gate that has
   * quietly stopped working.
   */
  const admitted = admittedRoles();
  assert.ok(admitted.size > 100, `Reflected only ${admitted.size} routes; the checks are vacuous.`);

  const sales = NAV_ITEMS.find((item) => item.id === 'orders')!;
  assert.ok(sales.roles.includes(UserRole.SALES), 'fixture assumption');
  assert.equal(
    admitted.get('get /api/v1/orders')!.includes(UserRole.SHOP_OWNER),
    true,
    'a role known to be admitted reads as admitted, so a refusal below means a refusal',
  );
  assert.equal(
    admitted.get('get /api/v1/admin/users')!.includes(UserRole.SHOP_OWNER),
    false,
    'and a role known to be refused reads as refused',
  );
});
