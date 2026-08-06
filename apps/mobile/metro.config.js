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
 *   `extraNodeModules` — teach Metro where each shared package is at all. It
 *   locates the directory; `resolveRequest` below is what picks the file
 *   inside it, and the note there records why that turned out to be two jobs
 *   rather than one.
 *
 * Reading the TypeScript source rather than a build removes the CommonJS round
 * trip and, more importantly, makes the packaged app and the dev bundle read
 * the same files. The web app was broken by precisely this class of divergence:
 * the production build worked while the dev server served a blank page.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/** The shared packages, and the one file each of them is. */
const WORKSPACE_PACKAGES = [
  'api-client',
  'design-tokens',
  'i18n',
  'jurisdictions',
  'navigation',
  'shared-types',
  'utilities',
  'validation',
];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  ...Object.fromEntries(
    WORKSPACE_PACKAGES.map((name) => [
      `@medsupply/${name}`,
      path.resolve(workspaceRoot, 'packages', name),
    ]),
  ),
};

/**
 * Resolve the shared packages to their **source**, which `extraNodeModules`
 * alone does not do.
 *
 * That mapping points Metro at the package *directory*; Metro then reads its
 * `package.json` and follows `main`, which every one of these sets to
 * `dist/index.js`. So the comment above was describing an intention rather than
 * a behaviour, and the intention is the one that matters: a `dist/` here is
 * whatever the API's `pretest` last produced, so what a phone ran depended on
 * which npm script somebody happened to run most recently.
 *
 * Found by adding an export to `@medsupply/navigation` and finding it absent
 * from `packages/navigation/dist/index.js`. Nothing failed, because the stale
 * build still had everything mobile used **before** that edit — which is
 * exactly how this class of bug stays hidden. `apps/web` lost a day to the same
 * shape of divergence, and the paragraph above is the record of it.
 *
 * `resolveRequest` rather than a `react-native` field in eight `package.json`s:
 * one file, explicit, and it cannot be half-applied.
 */
const SOURCE_ENTRY = new Map(
  WORKSPACE_PACKAGES.map((name) => [
    `@medsupply/${name}`,
    path.resolve(workspaceRoot, 'packages', name, 'index.ts'),
  ]),
);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const source = SOURCE_ENTRY.get(moduleName);
  if (source) return { type: 'sourceFile', filePath: source };
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

// pnpm's store is a symlink farm; without this Metro follows a symlink out of
// the project and then refuses to serve what it finds.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
