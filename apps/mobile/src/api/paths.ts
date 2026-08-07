/**
 * Reading API calls back out of the source that makes them.
 *
 * Two gates need this and used to have one copy between them. `callers.test.ts`
 * asks *"does anything still call this endpoint?"*; `navigation/permissions.test.ts`
 * asks *"is every role offered this screen allowed to call what it opens with?"*
 * — opposite questions off the same parse, and a second implementation of the
 * parse would let the two disagree about what a call is.
 *
 * This is test-time machinery that happens to live in `src/`, because a `.ts`
 * file under `src/` is what both test files can import. Nothing in the shipped
 * application imports it, and `tokenDiscipline.test.ts`-style file reading stays
 * in the tests themselves.
 */

/**
 * A template's interpolations flattened to `{}`, so one pattern matches both
 * `'/returns'` and `` `/orders/${id}/duplicate` ``.
 *
 * The path is then written the way the OpenAPI document writes one, minus the
 * parameter names — which nobody agrees on between a client and a specification
 * anyway.
 */
export function normalise(raw: string): string {
  return raw.replace(/\$\{[^{}]*\}/g, '{}');
}

const METHOD = /\.(get|post|patch|put|delete)\b/g;

/** The HTTP methods this client can issue, in the spelling both gates use. */
export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

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
 * **The method is half the capability.** `GET /returns` lists the returns a shop
 * has raised; `POST /returns` raises one. Without this, the list screen
 * satisfies the entry and deleting the whole return form goes unnoticed — which
 * is precisely what happened when this rule was first written without it.
 */
export function methodBefore(source: string, index: number): string | undefined {
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
 * Whether this exact endpoint, by this exact method, is called in any of these
 * sources.
 *
 * The endpoint must be followed by the end of its string, or a query. Without
 * that boundary, `/shops/my/addresses` would be satisfied by the *sub*-path
 * `/shops/my/addresses/{}` — so deleting the "add an address" call would pass
 * because editing one still exists.
 */
export function isCalled(method: string, path: string, sources: readonly string[]): boolean {
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

/** One request a file makes: the method, and the path with `{}` for each id. */
export interface Request {
  method: HttpMethod;
  path: string;
}

/**
 * Every API path literal in one file, with the method it is handed to.
 *
 * The inverse of `isCalled`: that answers "is this endpoint called", this
 * answers "what does this file call". A screen is offered to a role, and the
 * permission gate needs the second question — you cannot check a screen against
 * a role by guessing which endpoints to test it for.
 *
 * Only strings that begin `/` and are passed straight to a method are counted.
 * A path assembled from a variable is invisible here, exactly as it is to
 * `isCalled`, which is why `documents/files.ts`, `reports/api.ts` and now
 * `delivery/actions.ts` each write their own literal.
 */
const LITERAL = /['"`](\/[A-Za-z0-9{}/_.-]*)(?:\?[^'"`]*)?['"`]/g;

export function requestsIn(source: string): Request[] {
  const found = new Map<string, Request>();
  LITERAL.lastIndex = 0;
  for (let match = LITERAL.exec(source); match; match = LITERAL.exec(source)) {
    const method = methodBefore(source, match.index);
    if (!method) continue;
    const path = match[1]!;
    found.set(`${method} ${path}`, { method: method as HttpMethod, path });
  }
  return [...found.values()];
}

/**
 * The body of one exported function, from its declaration to the next one.
 *
 * A screen almost never writes its own request — it imports `getMyCollections`
 * from `finance/api.ts` and calls that. Attributing the requests of the whole
 * module to every screen that imports any part of it is too coarse to be worth
 * anything: `finance/api.ts` holds a rider's collections **and** a manager's
 * reports, so a rule fed the whole file would conclude that a manager can load
 * the rider's screen, which is the exact defect it was built to catch.
 *
 * The slice is crude — declaration to the next top-level `export` — and it is
 * reliable here because this codebase writes one exported function per
 * capability, which `documents/files.ts` and `reports/api.ts` say out loud.
 * A symbol that cannot be found yields nothing rather than guessing.
 */
export function bodyOf(source: string, symbol: string): string {
  const declaration = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${symbol}\\b`,
  ).exec(source);
  if (!declaration) return '';
  const from = declaration.index;
  const next = source.indexOf('\nexport ', from + 1);
  return source.slice(from, next < 0 ? source.length : next);
}

/** Relative import specifiers and the names taken from each. */
export function importsIn(source: string): Array<{ from: string; symbols: string[] }> {
  const found: Array<{ from: string; symbols: string[] }> = [];
  const pattern = /import\s+(type\s+)?([^;]*?)\s*from\s*['"](\.[^'"]*)['"]/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    // `import type { X }` brings no runtime call with it, so it cannot bring a
    // request either.
    if (match[1]) continue;
    const clause = match[2] ?? '';
    const symbols = [...clause.matchAll(/(?:^|[{,]\s*)(?!type\s)([A-Za-z_$][\w$]*)/g)].map(
      (name) => name[1]!,
    );
    found.push({ from: match[3]!, symbols });
  }
  return found;
}
