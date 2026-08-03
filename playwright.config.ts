import { defineConfig, devices } from '@playwright/test';

/**
 * The harness that would have caught the defects this project found by hand.
 *
 * Nothing in the 280 unit, component and integration tests ever loaded a page.
 * A blank white screen, a dev server that could not start, and a shop owner
 * bounced back to the login form all passed every check the repository had,
 * because every check stopped at the module boundary.
 *
 * Two run targets, deliberately:
 *
 *   `preview` — the built bundle, which is what deploys.
 *   `dev`     — the Vite dev server, which is what every developer sees. The
 *               blank-page defect existed *only* here, so a suite that ran
 *               against the build alone would have missed it.
 *
 * Run one with `--project=smoke-dev` / `--project=smoke-preview`.
 */

const API_PORT = Number(process.env.E2E_API_PORT ?? 5100);
const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT ?? 4173);
const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 5174);

const API_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * A dedicated database, so a run never destroys whatever a developer had open
 * in their own stack.
 */
const MONGODB_URI =
  process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/medsupply_e2e?replicaSet=rs0';

const apiEnvironment = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  MONGODB_URI,
  JWT_SECRET: 'e2e-signing-secret-at-least-32-characters-long',
  REFRESH_TOKEN_SECRET: 'e2e-refresh-secret-at-least-32-characters-long',
  CORS_ORIGINS: `http://127.0.0.1:${PREVIEW_PORT},http://127.0.0.1:${DEV_PORT},http://localhost:${PREVIEW_PORT},http://localhost:${DEV_PORT}`,
  LOG_LEVEL: 'error',
  // The suite signs in as six roles repeatedly; the production budget of ten
  // sign-ins a minute exists to refuse exactly that shape of traffic.
  RATE_LIMIT_AUTH_MAX: '1000000',
  RATE_LIMIT_GLOBAL_MAX: '1000000',
  RATE_LIMIT_WRITE_MAX: '1000000',
  RATE_LIMIT_REPORT_MAX: '1000000',
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    // Frozen in docs/TESTING.md and emitted by the primitives from phase 3
    // onwards, so a redesign that replaces every class name leaves the specs
    // standing.
    testIdAttribute: 'data-test',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Chrome as installed, rather than a downloaded build: this repository is
    // developed on Windows workstations that already have it, and CI installs
    // Chromium explicitly.
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'chrome',
    extraHTTPHeaders: {},
  },

  projects: [
    {
      name: 'smoke-preview',
      testMatch: /(smoke|accessibility)\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${PREVIEW_PORT}` },
    },
    {
      name: 'journey',
      testMatch: /journey\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${PREVIEW_PORT}` },
    },
    {
      name: 'smoke-dev',
      testMatch: /smoke\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${DEV_PORT}` },
    },
  ],

  webServer: [
    {
      // Built output, not ts-node: this is the artefact that deploys.
      command: 'pnpm --filter @medsupply/api build && pnpm --filter @medsupply/api start',
      url: `${API_URL}/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: apiEnvironment,
    },
    {
      command: `pnpm --filter @medsupply/web build && pnpm --filter @medsupply/web preview --port ${PREVIEW_PORT} --host 127.0.0.1 --strictPort`,
      url: `http://127.0.0.1:${PREVIEW_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { VITE_API_URL: `${API_URL}/api/v1` },
    },
    {
      command: `pnpm --filter @medsupply/web dev --port ${DEV_PORT} --host 127.0.0.1 --strictPort`,
      url: `http://127.0.0.1:${DEV_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { VITE_API_URL: `${API_URL}/api/v1` },
    },
  ],
});

export { API_URL, MONGODB_URI, apiEnvironment };
