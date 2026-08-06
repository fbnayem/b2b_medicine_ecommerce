import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

/**
 * Never serve a transform of a file that was empty for a moment.
 *
 * Reported twice as "the system is showing a white blank page", and the second
 * time the boot screen named it: `The requested module
 * '/@fs/…/packages/i18n/en.ts' does not provide an export named 'en'`. The dev
 * server was answering that request with **159 bytes** — a sourcemap whose
 * `sourcesContent` is `[""]`. It had read `en.ts` while the file was zero
 * bytes, transformed nothing into nothing, cached the result, and served it
 * from then on. The file on disk was correct the whole time. The build was
 * clean, the tests were green, and the application would not start.
 *
 * Any tool that truncates before it writes opens that window — Prettier on
 * commit, a formatter on save, a script doing `open(path, 'w')`. It is a race,
 * so it bites occasionally rather than every time, and once it has bitten the
 * only cure is restarting the server: the file never changes again, so nothing
 * ever invalidates the empty transform.
 *
 * The fix is to read the file here. An empty read is retried rather than
 * cached, and a file that is genuinely empty **throws** — which shows a real
 * message naming the file, and, unlike a successful transform, is not
 * remembered.
 *
 * `serve` only. A production build reads files that git has finished writing.
 */

/** Source in `packages/`, which the config's aliases serve straight to the browser. */
export const WORKSPACE_SOURCE = /[\\/]packages[\\/][^\\/]+[\\/][^\\/]+\.tsx?$/;

/** How long to keep looking, against how long a truncate-then-write takes. */
const ATTEMPTS = 10;
const PAUSE_MS = 50;

export type ReadSource = (file: string) => Promise<string | null>;

const fromDisk: ReadSource = (file) => readFile(file, 'utf8').catch(() => null);

export function neverServeAnEmptySource(read: ReadSource = fromDisk): Plugin {
  return {
    name: 'medsupply:never-serve-an-empty-source',
    apply: 'serve',
    enforce: 'pre',
    async load(id) {
      const file = id.split('?')[0];
      if (!WORKSPACE_SOURCE.test(file)) return null;

      let source = await read(file);
      for (let attempt = 0; source !== null && source.trim() === '' && attempt < ATTEMPTS;) {
        await new Promise((resume) => setTimeout(resume, PAUSE_MS));
        source = await read(file);
        attempt += 1;
      }

      // Not ours to explain — let Vite report a missing file its own way.
      if (source === null) return null;

      if (source.trim() === '') {
        throw new Error(
          `${file} is empty on disk. Refusing to serve it: an empty module is cached as a ` +
            'success and then reported in the browser as a missing export, which reads as a ' +
            'blank page rather than as a truncated file.',
        );
      }
      return source;
    },
  };
}
