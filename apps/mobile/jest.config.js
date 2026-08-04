/**
 * The component-rendering suite, on the runner Expo actually supports.
 *
 * This package already runs vitest, and a second runner in one package needs a
 * reason. The reason is that **`react-test-renderer` does not support React 19**
 * — Expo's own SDK 57 testing guide says so — and this app is on 19.2.3, so
 * `@testing-library/react-native` is the only way to render a React Native tree
 * at all. It is built for jest, and `jest-expo` is what resolves the Expo module
 * mocks that `expo-router`, `expo-secure-store` and the rest need to load
 * outside a device.
 *
 * Vitest cannot take its place here for a more basic reason: `react-native`
 * ships Flow-typed source, which esbuild cannot parse, so importing a single
 * component fails before any assertion runs.
 *
 * The split is by filename and is deliberately explicit at both ends:
 *
 *   - `*.render.test.tsx` — a component tree, run by jest, here.
 *   - `*.test.ts`         — pure logic, run by vitest, as before.
 *
 * `vitest.config.ts` excludes the first pattern by name. Without that both
 * runners claim the same files, and the vitest run fails on a `jest` global it
 * has never heard of.
 */
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '../..');

/**
 * The shared packages resolve to **source**, exactly as `metro.config.js` does.
 *
 * Every one of them declares `main: dist/index.js`, and `design-tokens` has no
 * `dist` at all because nothing in the mobile build has ever produced one —
 * Metro reads the TypeScript directly. Pointing jest at `dist` instead would
 * mean the render tests read different files from the app they are testing, and
 * `metro.config.js` records what that costs: the web app once shipped a working
 * production build and a blank dev server for precisely that reason.
 */
const workspacePackages = [
  'api-client',
  'design-tokens',
  'i18n',
  'jurisdictions',
  'navigation',
  'shared-types',
  'utilities',
  'validation',
];

module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.render.test.tsx', '<rootDir>/app/**/*.render.test.tsx'],
  moduleNameMapper: Object.fromEntries(
    workspacePackages.map((name) => [
      `^@medsupply/${name}$`,
      path.join(workspaceRoot, 'packages', name, 'index.ts'),
    ]),
  ),
};
