import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Watch the shared packages, which Vite otherwise does not.
 *
 * ## The defect
 *
 * Every `@medsupply/*` package is aliased to its TypeScript source, so
 * `packages/i18n/en.ts` is a first-class module in the graph — served over
 * `/@fs/` and compiled like anything else. What it is **not** is watched.
 * Vite's file watcher covers the project root, and the project root here is
 * `apps/web`; everything in `packages/` is a sibling of it.
 *
 * The consequence is that a change to a shared package produces no event, so
 * the module is never invalidated, so the dev server keeps serving the copy it
 * compiled when it started. It is not a cache that expires. **It is wrong until
 * somebody restarts the server**, and nothing on screen says so.
 *
 * This was measured rather than guessed. Touching `apps/web/src/main.tsx`
 * writes `page reload src/main.tsx` to the log; touching `packages/i18n/en.ts`
 * writes nothing at all, and a 143-line log of a working session contained not
 * one mention of any file under `packages/`.
 *
 * ## Why it took three investigations to find
 *
 * Because the symptom never looks like staleness. It looked like a blank page
 * once, a missing export once, and a screenful of `home.whoOwesUs` where
 * sentences should have been once — and each time the source on disk was
 * correct, every test passed, and the build was clean. The only way to see it
 * is to fetch the module the browser is being served and compare it with the
 * file, which is a thing nobody thinks to do until they have been caught by it.
 *
 * So the fix belongs here rather than in a note telling people to restart.
 */
export function watchWorkspaceSources(packagesDirectory?: string): Plugin {
  const directory = packagesDirectory ?? fileURLToPath(new URL('../../packages', import.meta.url));

  return {
    name: 'medsupply:watch-workspace-sources',
    // Serve only. A build reads the files once and exits; there is nothing to
    // keep in step with.
    apply: 'serve',
    configureServer(server) {
      /*
       * Adding the directory rather than each file: the alias list names eight
       * packages today and a ninth would otherwise be silently unwatched,
       * which is the same defect wearing a different name. Chokidar ignores
       * paths it is already watching, so this cannot double-report.
       */
      server.watcher.add(directory);
    },
  };
}
