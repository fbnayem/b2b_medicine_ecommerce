import { describe, expect, it } from 'vitest';
import { NAV_GROUP_LABEL, NAV_ITEMS } from '@medsupply/navigation';
import { DASHBOARD_GROUPS } from './Dashboard';

/**
 * Every group of the menu reaches the home screen.
 *
 * `GROUP_ORDER` is typed `NavGroup[]`, and an array of a union does not have to
 * contain all of it — so `purchasing` was left out when the list was written
 * and nothing anywhere noticed. Suppliers, purchase orders, the recall trace
 * and the controlled register were reachable from the sidebar and absent from
 * the screen that claims to show everything you can do.
 */

describe('the home screen directory', () => {
  it('lists every group the navigation declares', () => {
    const declared = Object.keys(NAV_GROUP_LABEL).sort();
    expect([...DASHBOARD_GROUPS].sort()).toEqual(declared);
  });

  it('leaves no navigable screen out of the group it belongs to', () => {
    const covered = new Set(DASHBOARD_GROUPS);
    const stranded = NAV_ITEMS.filter((item) => !item.hidden && !covered.has(item.group)).map(
      (item) => `${item.id} (${item.group})`,
    );

    expect(stranded).toEqual([]);
  });
});
