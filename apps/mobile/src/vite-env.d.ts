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
}
