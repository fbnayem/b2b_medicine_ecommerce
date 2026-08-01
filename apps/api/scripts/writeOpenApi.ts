import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOpenApiDocument, documentedOperationCount } from '../src/services/openapi';

/**
 * Writes the OpenAPI document to a file.
 *
 * The running API serves the same document at `/api/v1/docs/openapi.json`, but
 * a client generator, a contract test or an API gateway usually wants it as a
 * committed artefact that can be diffed in review — a specification change is
 * a contract change, and reviewing it as a diff is the point.
 *
 *   pnpm --filter @medsupply/api openapi
 *   pnpm --filter @medsupply/api openapi -- ./somewhere-else.json
 *
 * No database or signing secret is required: this reads schemas, not settings.
 */

/**
 * The workspace root, found by walking up for the pnpm workspace file. The
 * script is compiled before it runs, so a path relative to this file would
 * point at the build output rather than the repository.
 */
function workspaceRoot(from: string): string {
  let directory = from;
  while (!existsSync(resolve(directory, 'pnpm-workspace.yaml'))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error('Could not find the workspace root from ' + from);
    }
    directory = parent;
  }
  return directory;
}

const target = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(workspaceRoot(__dirname), 'docs/openapi.json');

writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, 'utf8');
console.log(`Wrote ${documentedOperationCount} operations to ${target}`);
