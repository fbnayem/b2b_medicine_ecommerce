import { Router } from 'express';
import { buildOpenApiDocument } from '../services/openapi';

const router = Router();

/**
 * The OpenAPI document and a reference rendered from it.
 *
 * The specification is the artefact that matters: it imports into Swagger UI,
 * Postman or a code generator unchanged. The page exists so that reading the
 * API needs no other tool, and is rendered from the same document rather than
 * written separately, so the two can never disagree.
 *
 * It is deliberately self-contained. Pulling Swagger UI from a public CDN would
 * mean the content security policy this phase sets has to allow a third-party
 * origin to run scripts on the API's own domain, which is a poor trade for a
 * nicer set of collapsible panels.
 */

let cached: string | null = null;

function document() {
  cached ??= JSON.stringify(buildOpenApiDocument());
  return cached;
}

router.get('/openapi.json', (_req, res) => {
  res.type('application/json').send(document());
});

router.get('/', (_req, res) => {
  res.type('html').send(REFERENCE_PAGE);
});

const REFERENCE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MedSupply B2B API reference</title>
<style>
  :root { color-scheme: light dark; --line: #d5dae2; --muted: #5b6472; --bg: #ffffff; --panel: #f7f8fa; --text: #121721; }
  @media (prefers-color-scheme: dark) {
    :root { --line: #2c3442; --muted: #98a2b3; --bg: #0f131a; --panel: #161c26; --text: #e8ecf3; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 2rem 1.5rem 1rem; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 .35rem; font-size: 1.5rem; }
  header p { margin: .25rem 0; color: var(--muted); white-space: pre-wrap; }
  main { padding: 1.25rem 1.5rem 4rem; max-width: 72rem; margin: 0 auto; }
  section { margin-bottom: 2rem; }
  h2 { font-size: 1.05rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); border-bottom: 1px solid var(--line); padding-bottom: .4rem; }
  .op { border: 1px solid var(--line); border-radius: 8px; margin: .5rem 0; background: var(--panel); }
  .op > summary { cursor: pointer; padding: .7rem .9rem; display: flex; gap: .75rem; align-items: baseline; flex-wrap: wrap; }
  .verb { font: 600 12px/1 ui-monospace, monospace; padding: .35rem .5rem; border-radius: 4px; color: #fff; letter-spacing: .05em; }
  .get { background: #1c6fd0; } .post { background: #1f8a4c; } .put, .patch { background: #b3701a; } .delete { background: #b3261e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  .path { font-family: ui-monospace, monospace; }
  .summary { color: var(--muted); }
  .body { padding: 0 .9rem .9rem; border-top: 1px solid var(--line); }
  .roles { font-size: .82rem; color: var(--muted); }
  pre { overflow-x: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: .7rem; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; border-bottom: 1px solid var(--line); padding: .35rem .5rem; font-size: .88rem; }
  a { color: inherit; }
</style>
</head>
<body>
<header>
  <h1>MedSupply B2B API reference</h1>
  <p id="intro">Loading the specification…</p>
  <p><a href="openapi.json">Download the OpenAPI 3.1 document</a></p>
</header>
<main id="content"></main>
<script>
(async function () {
  const text = (value) => { const node = document.createElement('span'); node.textContent = value; return node; };
  const response = await fetch('openapi.json');
  const spec = await response.json();
  document.getElementById('intro').textContent =
    spec.info.description + '\\n\\nVersion ' + spec.info.version + '.';

  const groups = new Map();
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const tag = (operation.tags || ['Other'])[0];
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push({ path, method, operation });
    }
  }

  const content = document.getElementById('content');
  for (const [tag, operations] of groups) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.appendChild(text(tag));
    section.appendChild(heading);

    for (const { path, method, operation } of operations) {
      const details = document.createElement('details');
      details.className = 'op';
      const summary = document.createElement('summary');
      const verb = document.createElement('span');
      verb.className = 'verb ' + method;
      verb.appendChild(text(method.toUpperCase()));
      const route = document.createElement('span');
      route.className = 'path';
      route.appendChild(text(path));
      const label = document.createElement('span');
      label.className = 'summary';
      label.appendChild(text(operation.summary || ''));
      summary.append(verb, route, label);
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'body';
      const roles = document.createElement('p');
      roles.className = 'roles';
      roles.appendChild(text(operation.description || ''));
      body.appendChild(roles);

      if (operation.parameters && operation.parameters.length) {
        const table = document.createElement('table');
        const head = document.createElement('tr');
        for (const column of ['Parameter', 'In', 'Required']) {
          const cell = document.createElement('th');
          cell.appendChild(text(column));
          head.appendChild(cell);
        }
        table.appendChild(head);
        for (const parameter of operation.parameters) {
          const row = document.createElement('tr');
          for (const value of [parameter.name, parameter.in, parameter.required ? 'yes' : 'no']) {
            const cell = document.createElement('td');
            cell.appendChild(text(String(value)));
            row.appendChild(cell);
          }
          table.appendChild(row);
        }
        body.appendChild(table);
      }

      const schema = operation.requestBody?.content?.['application/json']?.schema;
      if (schema) {
        const heading = document.createElement('p');
        heading.appendChild(text('Request body'));
        const pre = document.createElement('pre');
        pre.appendChild(text(JSON.stringify(schema, null, 2)));
        body.append(heading, pre);
      }

      details.appendChild(body);
      section.appendChild(details);
    }
    content.appendChild(section);
  }
})();
</script>
</body>
</html>`;

export default router;
