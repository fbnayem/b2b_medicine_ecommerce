import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@medsupply/navigation';
import { en } from '@medsupply/i18n';
import { guideFor, routesWithGuides } from '../lib/pageGuides';
import { NO_PAGE_GUIDE } from './uiWaivers';

/**
 * Every screen explains itself, or is on a list saying it does not yet.
 *
 * The request this exists for was plain: *"a lot of boxes still don't have the
 * description … so a non tech person can read and use this without asking any
 * questions."* The only way that stays true is if a screen added next year
 * cannot ship without one, which is what this is.
 *
 * It fails in both directions, like every other rule in `uiDiscipline.test.ts`:
 * a route with no guidance fails because it is not waived, and a waiver for a
 * route that now has guidance fails because the list may only shrink.
 */

/** Every screen the navigation manifest declares. It is the list of what exists. */
function routes(): string[] {
  return NAV_ITEMS.map((item) => item.id).sort();
}

/** Resolves keys the way the application does, so a missing one shows up as itself. */
const translate = (path: string): string => {
  const value = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], en);
  return typeof value === 'string' ? value : path;
};

describe('every screen explains itself', () => {
  it('no route is without a guide', () => {
    const missing = routes().filter((id) => !routesWithGuides().includes(id));
    expect(
      missing.filter((id) => !NO_PAGE_GUIDE.includes(id)),
      'Write guide.<route>What and guide.<route>Use in en.ts and bn.ts, then map the route ' +
        'in lib/pageGuides.ts. A screen nobody can use without asking is not finished.',
    ).toEqual([]);
  });

  it('the waiver list has no stale entries', () => {
    const stale = NO_PAGE_GUIDE.filter((id) => routesWithGuides().includes(id));
    expect(stale, 'These routes now have a guide. Strike them off uiWaivers.ts.').toEqual([]);
  });

  it('no guide names a route that does not exist', () => {
    const known = new Set(routes());
    const ghosts = routesWithGuides().filter((id) => !known.has(id));
    expect(ghosts, 'A guide for a deleted screen is read by nobody.').toEqual([]);
  });

  it('every key a guide uses resolves to real words', () => {
    /*
     * The failure this catches is the one the home screen shipped a fortnight
     * ago: a key that does not exist renders as its own path, so the reader is
     * shown `guide.orderDetailWhat` where a sentence should be. `t()` cannot
     * fail loudly — returning the path is the only sane runtime behaviour — so
     * it has to be caught here.
     */
    const unresolved: string[] = [];
    for (const id of routesWithGuides()) {
      const guide = guideFor(id, translate);
      for (const [part, text] of Object.entries(guide ?? {})) {
        if (typeof text === 'string' && /^guide\.[a-zA-Z]+$/.test(text)) {
          unresolved.push(`${id}.${part} → ${text}`);
        }
      }
    }
    expect(unresolved, 'These keys are missing from en.ts.').toEqual([]);
  });

  it('guidance is written for somebody who has not been trained', () => {
    /*
     * Not a style opinion — the request was that a non-technical reader manage
     * without asking, and these are the words that send them to ask. Each is
     * either the system's vocabulary rather than the shop's, or a term this
     * catalogue has a plainer word for already.
     */
    const JARGON =
      /\b(endpoint|payload|idempotenc|mutation|API|JSON|boolean|enum|null|UUID|ObjectId|CRUD|basis points?|minor units?)\b/i;
    const offenders: string[] = [];
    for (const id of routesWithGuides()) {
      const guide = guideFor(id, translate);
      for (const [part, text] of Object.entries(guide ?? {})) {
        if (typeof text === 'string' && JARGON.test(text)) offenders.push(`${id}.${part}`);
      }
    }
    expect(offenders, 'Rewrite these in the words a shop uses.').toEqual([]);
  });

  it('a guide answers in sentences rather than a label', () => {
    // A one-word "answer" is the shape guidance takes when somebody is filling
    // the gate in rather than explaining the screen.
    const tooShort: string[] = [];
    for (const id of routesWithGuides()) {
      const guide = guideFor(id, translate);
      for (const [part, text] of Object.entries(guide ?? {})) {
        if (typeof text === 'string' && text.length < 25) tooShort.push(`${id}.${part}`);
      }
    }
    expect(tooShort, 'Say what the screen does, not what it is called.').toEqual([]);
  });

  it('the rules detect what they claim to, so a clean run means something', () => {
    // Without this, a helper that silently returned nothing would satisfy
    // every assertion above.
    expect(routes().length).toBeGreaterThan(60);
    expect(routes()).toContain('orders');
    expect(routesWithGuides().length).toBeGreaterThan(60);

    // The resolver really resolves, and really fails on a key that is absent.
    expect(translate('guide.ordersWhat')).not.toBe('guide.ordersWhat');
    expect(translate('guide.thisKeyDoesNotExist')).toBe('guide.thisKeyDoesNotExist');

    // An unknown route has no guide rather than an empty one.
    expect(guideFor('no-such-route', translate)).toBeUndefined();
  });
});
