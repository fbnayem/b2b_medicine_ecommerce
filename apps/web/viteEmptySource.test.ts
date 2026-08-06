import { describe, expect, it } from 'vitest';
import { neverServeAnEmptySource } from './viteEmptySource.ts';

/**
 * The guard that stands between a half-written file and a blank page.
 *
 * The reader is injected rather than stubbed at the module level, so these run
 * with no filesystem and no timers of their own — and so the retry can be
 * proved by handing back an empty string once and the real thing afterwards,
 * which is precisely what a truncate-then-write looks like from here.
 */

const EN = 'D:/b2b_medicine/packages/i18n/en.ts';

/** The plugin's `load`, called the way Vite calls it. */
function loader(read: (file: string) => Promise<string | null>) {
  const plugin = neverServeAnEmptySource(read);
  const load = plugin.load;
  if (typeof load !== 'function') throw new Error('the plugin has no load hook');
  return (id: string) =>
    (load as (this: unknown, id: string) => Promise<string | null>).call({}, id);
}

describe('never serving an empty source', () => {
  it('waits out a file that is empty for a moment and serves what lands', async () => {
    // Exactly the window Prettier opens on every commit that touches a
    // catalogue: truncated, then written.
    let call = 0;
    const load = loader(() => {
      call += 1;
      return Promise.resolve(call === 1 ? '' : 'export const en = {};');
    });

    await expect(load(EN)).resolves.toBe('export const en = {};');
    expect(call).toBe(2);
  });

  it('refuses a file that is genuinely empty, and names it', async () => {
    /*
     * A throw, not an empty string. This is the whole point: Vite caches a
     * successful transform and does not cache an error, so serving "" once
     * poisons the server until it restarts, while throwing is survivable and
     * says what happened.
     */
    const load = loader(() => Promise.resolve(''));

    await expect(load(EN)).rejects.toThrow(/en\.ts is empty on disk/);
  });

  it('leaves everything that is not workspace source alone', async () => {
    let reads = 0;
    const load = loader(() => {
      reads += 1;
      return Promise.resolve('');
    });

    for (const id of [
      'D:/b2b_medicine/apps/web/src/main.tsx',
      'D:/b2b_medicine/packages/design-tokens/theme.css',
      '\0virtual:something',
    ]) {
      await expect(load(id)).resolves.toBeNull();
    }
    // Not read at all — the guard must not become a second file-loading path
    // for the whole application.
    expect(reads).toBe(0);
  });

  it('matches the file behind a query string, which is how Vite asks for it', async () => {
    const load = loader(() => Promise.resolve('export const en = {};'));

    await expect(load(`${EN}?t=1785985917597`)).resolves.toBe('export const en = {};');
  });

  it('says nothing about a file that is missing rather than empty', async () => {
    // `null` means "no such file". Vite's own message for that is better than
    // anything this plugin could invent.
    const load = loader(() => Promise.resolve(null));

    await expect(load(EN)).resolves.toBeNull();
  });
});
