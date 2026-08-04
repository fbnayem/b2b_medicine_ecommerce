import { defineConfig, configDefaults } from 'vitest/config';

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
  test: {
    exclude: [...configDefaults.exclude, '**/*.render.test.tsx'],
  },
});
