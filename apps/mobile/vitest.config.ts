import { fileURLToPath } from 'node:url';
import { defineConfig, configDefaults } from 'vitest/config';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The shared packages resolve to source, as Metro and jest already do.
 *
 * Every one of them declares `main: dist/index.js`, and **`design-tokens` has
 * no `dist` at all** — nothing in the mobile build has ever produced one, so
 * `metro.config.js` reads the TypeScript directly and `jest.config.js` maps to
 * the same files. vitest was the odd resolver out: `pretest` builds four of the
 * packages by hand and `design-tokens` is not among them, so importing it from
 * a module under test failed with "Failed to resolve entry for package".
 *
 * Three resolvers now agree, which is the property that matters. The comment
 * in `metro.config.js` records what disagreement costs here: the web app once
 * shipped a working production build alongside a blank dev server for exactly
 * this reason.
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

/**
 * The logic suite. Component rendering is jest's, next door.
 *
 * There was no config file here at all, which was fine while every test in this
 * package was pure logic. It stops being fine the moment a `*.render.test.tsx`
 * exists: vitest's default include is `**\/*.test.?(c|m)[jt]s?(x)`, and
 * `Controls.render.test.tsx` ends in `.test.tsx`, so both runners claim it. The
 * vitest run then fails on a `jest` global it has never heard of — and, worse,
 * would fail on `react-native` itself, whose Flow-typed source esbuild cannot
 * parse.
 *
 * `jest.config.js` explains the other half: why the render tests need jest at
 * all rather than this runner.
 */
export default defineConfig({
  resolve: {
    alias: workspacePackages.map((name) => ({
      find: `@medsupply/${name}`,
      replacement: `${workspaceRoot}packages/${name}/index.ts`,
    })),
  },
  test: {
    exclude: [...configDefaults.exclude, '**/*.render.test.tsx'],
  },
});
