import { describe, expect, it } from 'vitest';
import { watchWorkspaceSources } from './viteWatchWorkspace.ts';

/**
 * No filesystem and no server.
 *
 * What the plugin has to get right is one thing — that it asks the watcher to
 * cover the shared packages, and only when serving — and both are observable
 * from a recording double. Standing a real dev server up to assert it would be
 * slower, flakier, and would be testing chokidar rather than this.
 *
 * The behaviour it exists for was proved by hand against a running server, and
 * the measurement is written into the plugin's own comment: before it, touching
 * `packages/i18n/en.ts` produced no event at all; after it, the log says
 * `page reload …/packages/i18n/en.ts`.
 */

function recorder() {
  const added: string[] = [];
  return { added, server: { watcher: { add: (path: string) => added.push(path) } } };
}

/** `configureServer` is typed as a hook object or a function; here it is a function. */
function configure(plugin: ReturnType<typeof watchWorkspaceSources>, server: unknown) {
  (plugin.configureServer as (s: unknown) => void)(server);
}

describe('watching the shared packages', () => {
  it('hands the packages directory to the watcher', () => {
    const { added, server } = recorder();
    configure(watchWorkspaceSources('/repo/packages'), server);
    expect(added).toEqual(['/repo/packages']);
  });

  it('runs when serving and not when building', () => {
    // A build reads every file once and exits. Watching there would keep a
    // process alive that is meant to finish.
    expect(watchWorkspaceSources('/repo/packages').apply).toBe('serve');
  });

  it('defaults to the repository’s own packages directory, resolved', () => {
    const { added, server } = recorder();
    configure(watchWorkspaceSources(), server);

    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/packages$/);
    // An unresolved `../../packages` would be watched relative to wherever the
    // process was started, which is to say: nothing.
    expect(added[0]).not.toContain('..');
  });

  it('keeps a stable name, because a duplicate plugin name is silently ignored', () => {
    expect(watchWorkspaceSources().name).toBe('medsupply:watch-workspace-sources');
  });
});
