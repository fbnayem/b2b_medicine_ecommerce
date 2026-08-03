import { execFileSync } from 'node:child_process';
import { E2E_PASSWORD } from './fixtures';
import { MONGODB_URI, apiEnvironment } from '../playwright.config';

/**
 * Puts a working system behind the browser before a single spec runs.
 *
 * The seed drives every state transition through the real HTTP API, so if it
 * completes, the workflow works — which means a failure here is a genuine
 * finding about the system rather than a broken harness, and is reported as
 * such rather than being retried into silence.
 */
export default function globalSetup() {
  process.stdout.write('\n[e2e] seeding the end-to-end database…\n');
  try {
    execFileSync('pnpm', ['--filter', '@medsupply/api', 'run', 'seed'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        ...apiEnvironment,
        NODE_ENV: 'development',
        MONGODB_URI,
        SEED_PASSWORD: E2E_PASSWORD,
      },
    });
  } catch {
    throw new Error(
      'Seeding failed. The end-to-end suite needs MongoDB and Redis running:\n' +
        '  docker compose up -d mongodb redis\n' +
        `and a reachable replica set at ${MONGODB_URI}.`,
    );
  }
  process.stdout.write('[e2e] seeded.\n\n');
}
