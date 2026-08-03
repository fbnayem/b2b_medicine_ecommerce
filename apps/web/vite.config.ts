import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const workspacePackage = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/index.ts`, import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
      '@medsupply/shared-types': workspacePackage('shared-types'),
      '@medsupply/utilities': workspacePackage('utilities'),
      '@medsupply/validation': workspacePackage('validation'),
    },
  },
});
