import { describe, expect, it } from 'vitest';
import { NAV_BY_ID } from '@medsupply/navigation';
import { bodyOf, importsIn, requestsIn, type Request } from '../api/paths';
import { MOBILE_ROUTE, NO_MOBILE_SCREEN } from './routes';

/**
 * **No role is offered a screen the server will not let it load.**
 *
 * The defect, found in Phase 40 and introduced by me in Phase 39: the shared id
 * `collections` is labelled *"Rider collections"* and is permitted to
 * `SUPER_ADMIN`, `ADMIN` and `MANAGER` — it is the desk screen that posts or
 * fails the cash riders hand in, and on web it opens `CollectionReview`.
 * `MOBILE_ROUTE` sent it to `/(protected)/collections`, which is the **rider's
 * own** screen: its only request is `GET /finance/my/collections`, permitted to
 * `DELIVERY_PERSON` and to nobody else.
 *
 * So every manager in MedSupply Manage had a menu entry that answered 403, and
 * the screen that was correct for them sat in the repository with nothing
 * pointing at it.
 *
 * Three gates existed and none could see it. `routes.test.ts` asks whether the
 * destination has a file — it did. `callers.test.ts` asks whether an endpoint
 * has a caller — it had one. `navigation.test.ts` on web asks whether a role has
 * a route. Between "the screen exists" and "the endpoint is called" is the
 * question nobody was asking: **whether the person being offered the screen is
 * allowed to make the request it opens with.**
 *
 * ## The rule, and why it is the conservative one
 *
 * For each destination, every role permitted to see it must be permitted to make
 * **at least one** of the `GET` requests the screen makes. Not all of them —
 * `delivery-detail.tsx` legitimately calls a storekeeper's handover and a
 * rider's acknowledgement from one file, each behind a role check in the markup,
 * and a rule demanding every role be able to call every endpoint would fire on
 * every shared screen in the application.
 *
 * A screen with no `GET` at all — a form that only posts — is skipped, because
 * there is nothing it can fail to load.
 *
 * That leaves exactly the class of defect worth a gate: a destination whose data
 * the role cannot fetch, which is a 403 the moment they tap it.
 *
 * Read through Vite rather than `node:fs`, as every other file-reading rule in
 * this application does, because code that ships to Hermes must not be able to
 * reach a filesystem.
 */

const SCREENS = import.meta.glob('../../app/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MODULES = import.meta.glob(['../**/*.ts', '../**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Both globs in one space, keyed the way an import resolves.
 *
 * The two arrive relative to *this file* — screens as `../../app/…`, modules as
 * `../finance/…` — and an import inside a screen is written relative to the
 * screen. Rebasing everything onto the workspace root is what makes the two
 * comparable; nothing else here cares what the keys look like.
 */
const HERE = 'apps/mobile/src/navigation';

function join(base: string, relative: string): string {
  const parts = base.split('/').filter(Boolean);
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

const SOURCE = new Map<string, string>(
  [...Object.entries(SCREENS), ...Object.entries(MODULES)]
    .filter(([key]) => !key.includes('.test.'))
    .map(([key, raw]) => [join(HERE, key), String(raw)]),
);

/** An import specifier, resolved to a file this run actually has. */
function fileAt(fromDirectory: string, specifier: string): string | undefined {
  const base = join(fromDirectory, specifier);
  return ['.ts', '.tsx', '/index.ts', '/index.tsx']
    .map((suffix) => base + suffix)
    .find((candidate) => SOURCE.has(candidate));
}

function directoryOf(file: string): string {
  return file.slice(0, file.lastIndexOf('/'));
}

/**
 * Every request a screen makes: the ones it writes itself, and the ones inside
 * the exact functions it imports.
 *
 * One hop, deliberately. Two would drag in the whole data layer and put a
 * manager's reports behind a rider's screen — which is the coarseness that made
 * the first draft of this gate blind to the defect it was written for.
 */
function requestsFor(screen: string): Request[] {
  const source = SOURCE.get(screen);
  if (!source) return [];
  const found = new Map<string, Request>();
  const add = (request: Request) => found.set(`${request.method} ${request.path}`, request);

  requestsIn(source).forEach(add);
  for (const { from, symbols } of importsIn(source)) {
    const file = fileAt(directoryOf(screen), from);
    const module = file && SOURCE.get(file);
    if (!module) continue;
    for (const symbol of symbols) {
      requestsIn(bodyOf(module, symbol)).forEach(add);
    }
  }
  return [...found.values()];
}

/**
 * The API's own description of itself, which is the only source both clients
 * and the server agree on.
 *
 * `securityRules.test.ts` on the API side compares this file byte for byte
 * against what the router actually enforces, so a stale copy fails there before
 * it can mislead here.
 */
const SPEC = (
  import.meta.glob('../../../../docs/openapi.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
)['../../../../docs/openapi.json'];

interface Operation {
  description?: string;
}

/** `get /deliveries/{}/complete` → the roles the server admits. */
function permittedRoles(): Map<string, Set<string> | 'public'> {
  const spec = JSON.parse(SPEC ?? '{"paths":{}}') as {
    paths: Record<string, Record<string, Operation>>;
  };
  const table = new Map<string, Set<string> | 'public'>();
  for (const [path, operations] of Object.entries(spec.paths)) {
    // `/api/v1/deliveries/{id}/complete` is written `/deliveries/{}/complete`
    // by a client, which is also how `api/paths.ts` normalises what it finds.
    const client = path.replace('/api/v1', '').replace(/\{[^}]*\}/g, '{}');
    for (const [method, operation] of Object.entries(operations)) {
      const description = operation.description ?? '';
      const roles = /^Permitted roles: (.+?)\.?$/.exec(description);
      if (roles) {
        table.set(`${method} ${client}`, new Set(roles[1]!.split(',').map((role) => role.trim())));
      } else if (description.startsWith('Available without authentication')) {
        table.set(`${method} ${client}`, 'public');
      }
    }
  }
  return table;
}

const ROLES = permittedRoles();

/** `/(protected)/collections` → `apps/mobile/app/(protected)/collections.tsx`. */
function fileFor(route: string): string {
  return join(HERE, `../../app${route.replace(/\?.*$/, '')}.tsx`);
}

/** Every destination with a screen, and the requests that screen makes. */
function destinations() {
  return Object.entries(MOBILE_ROUTE)
    .filter(([id]) => !NO_MOBILE_SCREEN.has(id) && NAV_BY_ID[id])
    .flatMap(([id, route]) => {
      const screen = fileFor(route);
      return SOURCE.has(screen)
        ? [{ id, route, item: NAV_BY_ID[id]!, requests: requestsFor(screen) }]
        : [];
    });
}

describe('nobody is offered a screen they may not load', () => {
  it('read the specification and the screens, so a clean run is not an empty one', () => {
    // Either glob returning nothing would make every rule below vacuous while
    // reporting perfect health — the exact shape of a gate that has quietly
    // stopped working.
    expect(ROLES.size).toBeGreaterThan(150);
    expect(destinations().length).toBeGreaterThan(40);

    /*
     * And the harder emptiness: the rule skips a destination whose reads it
     * could not find, so a resolver that silently stopped resolving would
     * report perfect health while checking nothing. This counts the ones it
     * genuinely understood.
     */
    const understood = destinations().filter((entry) =>
      entry.requests.some((request) => request.method === 'get'),
    );
    expect(understood.length).toBeGreaterThan(35);
  });

  it('can fetch the data behind every destination it is offered', () => {
    const refused: string[] = [];

    for (const { id, route, item, requests } of destinations()) {
      const reads = requests.filter((request) => request.method === 'get');
      // Nothing to load means nothing to be refused: a form that only posts is
      // reachable by anybody the manifest permits, and its writes are the
      // caller gate's business rather than this one's.
      if (!reads.length) continue;

      for (const role of item.roles) {
        const allowed = reads.some((request) => {
          const permitted = ROLES.get(`${request.method} ${request.path}`);
          // An unknown path is not evidence of a refusal. `/health` and the
          // static asset routes are not in the client surface, and a rule that
          // treated "I could not find it" as "you may not have it" would fail
          // loudly for the wrong reason.
          return !permitted || permitted === 'public' || permitted.has(role);
        });
        if (allowed) continue;

        refused.push(
          `${item.label} (${id} → ${route})\n      offered to ${role}, who may call none of: ` +
            reads.map((request) => `GET ${request.path}`).join(', '),
        );
      }
    }

    expect(
      refused,
      'These roles are offered a destination whose data the server will not give them. ' +
        'Tapping it is a 403, which reads as the application being broken rather than as ' +
        'a permission working:\n  ' +
        refused.join('\n  ') +
        '\nEither the route points at the wrong screen, or the manifest offers it to the ' +
        'wrong role.',
    ).toEqual([]);
  });

  it('sends the rider collections id to the desk screen, not to the rider one', () => {
    /*
     * The specific defect, named rather than left to the general rule.
     *
     * Two screens exist, one line apart in the directory listing, and their
     * names differ by a suffix: `collections.tsx` is what a rider carries and
     * `collection-review.tsx` is what a manager decides. The general rule above
     * catches a mix-up whatever its shape; this says which way round these two
     * go, so somebody reading the map does not have to work it out from the
     * roles.
     */
    expect(MOBILE_ROUTE.collections).toBe('/(protected)/collection-review');
    expect(NAV_BY_ID.collections?.roles).not.toContain('DELIVERY_PERSON');
  });

  it('the rule detects what it claims to, so a clean run means something', () => {
    /*
     * The self-proof. A rule that found no refusals because its role table was
     * empty, or because `requestsIn` returned nothing, would look identical to a
     * rule that found no refusals because there are none.
     */
    expect(ROLES.get('get /finance/my/collections')).toEqual(new Set(['DELIVERY_PERSON']));
    expect(ROLES.get('post /auth/login')).toBe('public');

    /*
     * The screen writes none of its own requests — it imports `getMyCollections`
     * — so this also proves the import hop works. Without it the first draft of
     * this gate found nothing at all and passed.
     */
    const reads = requestsFor(join(HERE, '../../app/(protected)/collections.tsx')).filter(
      (request) => request.method === 'get',
    );
    expect(reads.map((request) => request.path)).toContain('/finance/my/collections');
    // And not the manager's reports, which live in the same module: attributing
    // a whole file to a screen would let this defect through.
    expect(reads.map((request) => request.path)).not.toContain('/finance/reports/overdue');

    // And the refusal this file exists for is a real one: a manager may not
    // make that call, so pointing the management destination at this screen
    // would be caught above.
    expect(ROLES.get('get /finance/my/collections')).not.toContain('MANAGER');
  });
});
