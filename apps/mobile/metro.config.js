const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Teaches Metro about the workspace.
 *
 * There was no Metro config at all, which meant the shared packages resolved
 * through `main` → `dist/index.js`, and **nothing builds that**. `pretest`,
 * `pretypecheck` and `prestart` each run the package builds by hand, so the
 * gap is invisible from a terminal — but `expo run:android`, EAS and
 * `expo export` do not run npm lifecycle hooks, so a real build would resolve a
 * `dist` that had never been produced, or a stale one from somebody's last
 * `pnpm test`. A `prestart` hook is not a fix for that; this is.
 *
 * Two changes:
 *
 *   `watchFolders` — Metro refuses to serve a file outside the project root,
 *   and in a pnpm workspace every shared package is exactly that.
 *
 *   `extraNodeModules` — resolve each shared package to its TypeScript source.
 *   Metro compiles TypeScript anyway, so this removes the CommonJS round trip
 *   and, more importantly, makes the packaged app and the dev bundle read the
 *   same files. The web app was broken by precisely this class of divergence:
 *   the production build worked while the dev server served a blank page.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@medsupply/design-tokens': path.resolve(workspaceRoot, 'packages/design-tokens'),
  '@medsupply/navigation': path.resolve(workspaceRoot, 'packages/navigation'),
  '@medsupply/shared-types': path.resolve(workspaceRoot, 'packages/shared-types'),
  '@medsupply/utilities': path.resolve(workspaceRoot, 'packages/utilities'),
  '@medsupply/validation': path.resolve(workspaceRoot, 'packages/validation'),
};

// pnpm's store is a symlink farm; without this Metro follows a symlink out of
// the project and then refuses to serve what it finds.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
