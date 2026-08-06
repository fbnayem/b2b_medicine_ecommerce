/**
 * `import.meta.glob` for the test suite only.
 *
 * The Expo tsconfig knows nothing about Vite, and this package deliberately
 * does not pull in Node's type definitions — code that ships to Hermes must not
 * be able to reach the filesystem, so `node:fs` staying out of scope is a
 * feature. Vitest does provide `import.meta.glob`, and it is the right tool for
 * asking which route files exist: it resolves at build time, so a glob that
 * matches nothing shows up as a failing test rather than as an empty set that
 * quietly agrees with everything.
 *
 * Declared narrowly — only the one member, only the eager-less form actually
 * used — rather than by widening the whole `types` array.
 */
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<unknown>>;
  /**
   * The eager, raw form — file contents as strings at build time.
   *
   * Added for `tokenDiscipline.test.ts`, which has to read screens to check
   * they take their colours from the token package. Reading them with
   * `node:fs` would mean putting Node's definitions on this package's config,
   * and the paragraph above is the reason not to: a screen that ships to
   * Hermes must not be able to reach a filesystem, and the type system is
   * where that is cheapest to enforce.
   */
  glob(
    pattern: string | string[],
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
  /**
   * The same, for binary assets, which arrive as `data:` URIs.
   *
   * Added for `appVariant.test.ts`, which reads the PNG headers of the launcher
   * icons to check that `app.config.ts` names files that exist, at the sizes
   * both stores accept. `?raw` cannot serve that: a PNG decoded as text has
   * already lost the bytes the header is made of, so every file would look
   * equally valid and equally broken.
   */
  glob(
    pattern: string | string[],
    options: { query: '?inline'; import: 'default'; eager: true },
  ): Record<string, string>;
}
