import { fileURLToPath } from 'node:url';
// `defineConfig` from vitest rather than vite, so the `test` block below is
// typed. Vitest re-exports vite's own config type with its additions.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { neverServeAnEmptySource } from './viteEmptySource.ts';
import { watchWorkspaceSources } from './viteWatchWorkspace.ts';

const workspacePackage = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/index.ts`, import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  /**
   * Tailwind v4 is configured in CSS, not in a config file. There is
   * deliberately **no `tailwind.config.js`**: v4 does not auto-detect one, and
   * loading one through `@config` switches off `corePlugins`, `safelist` and
   * `separator` — so a file added "just in case" would silently change how the
   * framework behaves.
   *
   * The plugin is skipped under vitest. It has no job in jsdom — no layout is
   * computed there — and it intercepts every `.css` import including
   * `?raw` ones, which made the token parity test read an empty string and
   * report agreement between a file and nothing.
   */
  plugins: [
    neverServeAnEmptySource(),
    watchWorkspaceSources(),
    ...(process.env.VITEST ? [] : [tailwindcss()]),
    react(),
  ],

  server: {
    watch: {
      /**
       * Wait for a file to stop changing before reacting to it.
       *
       * A tool that truncates and then writes produces two events, and the
       * first one describes an empty file. Without this the dev server acts on
       * that first event — see `neverServeAnEmptySource` above for what acting
       * on it costs. Chokidar holds the event until the size has been stable
       * for the threshold, so the empty state is never reported at all.
       */
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
    },
  },

  /**
   * `css: true` so a `?raw` stylesheet import returns the stylesheet.
   *
   * Vitest short-circuits anything ending in `.css` by default and hands back
   * an empty string, which is usually harmless — and here was not: the token
   * parity test would have compared `index.ts` against nothing and reported
   * that the two agreed. A gate that reads an empty file always passes.
   */
  test: { css: true, setupFiles: ['./src/testing/setup.ts'] },
  resolve: {
    /**
     * Resolve the shared workspace packages to their TypeScript source rather
     * than to `dist`.
     *
     * Those packages compile to CommonJS, because the API consumes them from
     * Node, and their manifests declare only `main`. The dev server serves
     * native ES modules, so every page died on
     * `does not provide an export named 'UserRole'` and React never mounted —
     * a blank screen with the error only in the browser console.
     *
     * Pre-bundling them does not help: the emitted `dist/index.js` opens with
     * `exports.A = exports.B = ... = void 0`, which defeats esbuild's CommonJS
     * export detection, so it produces a default export and nothing else.
     *
     * Vite compiles TypeScript anyway, and these packages are plain source with
     * no build step of their own worth preserving here. Pointing at the source
     * removes the CommonJS round trip entirely, and — more importantly — makes
     * the dev server and the production build resolve the same files. The old
     * arrangement had Rollup's interop quietly rescuing the build while the dev
     * server was broken, which is how this survived a passing build, a green
     * test suite and a container deployment.
     */
    alias: {
      /*
       * The stylesheet first. These aliases are prefix matches applied in
       * order, so a bare `@medsupply/design-tokens` entry alone would rewrite
       * `@medsupply/design-tokens/theme.css` to `…/index.ts/theme.css`.
       */
      '@medsupply/design-tokens/theme.css': fileURLToPath(
        new URL('../../packages/design-tokens/theme.css', import.meta.url),
      ),
      '@medsupply/api-client': workspacePackage('api-client'),
      '@medsupply/design-tokens': workspacePackage('design-tokens'),
      '@medsupply/i18n': workspacePackage('i18n'),
      '@medsupply/jurisdictions': workspacePackage('jurisdictions'),
      '@medsupply/navigation': workspacePackage('navigation'),
      '@medsupply/shared-types': workspacePackage('shared-types'),
      '@medsupply/utilities': workspacePackage('utilities'),
      '@medsupply/validation': workspacePackage('validation'),
    },
  },
});
