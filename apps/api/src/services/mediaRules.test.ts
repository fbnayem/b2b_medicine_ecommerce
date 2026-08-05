import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { CreateMedicineSchema } from '@medsupply/validation';
import { MEDIA_PREFIX, mediaFiles, mediaRoot, servable } from '../middlewares/media';
import { securityHeaders } from '../middlewares/securityHeaders';
import { notFoundHandler } from '../middlewares/error';

/**
 * Serving the catalogue's photographs.
 *
 * The import records a picture against every medicine it brings in. That is
 * only true if a client can fetch the picture, so what this file asserts is the
 * join between the two halves: the path the importer writes is a path this API
 * will serve, and nothing else in that directory is.
 *
 * Two of these exist because the obvious implementation is wrong in a way that
 * never announces itself — `securityHeaders()` puts `no-store` on every
 * response before any route sees it, and `send` declines to replace a
 * Cache-Control that is already present, so a photograph configured to cache
 * for a year would quietly cache for none of it.
 */

const FIXTURE = join(mediaRoot, 'catalogue', 'arogga', '999999');

function serverUnderTest() {
  const app = express();
  app.use(securityHeaders());
  app.use(MEDIA_PREFIX, ...mediaFiles());
  app.use(notFoundHandler);
  return app;
}

async function withServer(run: (base: string) => Promise<void>) {
  mkdirSync(FIXTURE, { recursive: true });
  // A one-pixel WEBP would be more honest; the handler never looks inside the
  // file, so the bytes only have to be distinguishable from an empty read.
  writeFileSync(join(FIXTURE, 'box.webp'), 'RIFF----WEBPVP8 ');
  writeFileSync(join(FIXTURE, 'box.html'), '<script>alert(1)</script>');

  const app = serverUnderTest();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(FIXTURE, { recursive: true, force: true });
  }
}

test('the allow-list refuses everything that is not a raster picture', () => {
  for (const accepted of [
    '/catalogue/arogga/12507/napro-a-plus-500-1-faf82da1d1-clean.webp',
    '/catalogue/arogga/1/photo.JPEG',
    '/catalogue/arogga/1/photo.png',
  ]) {
    assert.equal(servable(accepted), true, `${accepted} should be servable`);
  }

  for (const refused of [
    // A document that would execute on this API's own origin.
    '/catalogue/x.html',
    '/catalogue/x.js',
    // SVG is a document too, whatever the folder it is filed in suggests.
    '/catalogue/x.svg',
    // Traversal, raw and escaped. The escaped form is the reason this check
    // decodes first: `req.path` is not decoded, so `%2e%2e` reads as an
    // ordinary segment to anything that looks at the raw string.
    '/catalogue/../../.env',
    '/catalogue/%2e%2e/%2e%2e/.env',
    '/.env',
    // A truncation attempt, and a malformed escape.
    '/catalogue/x.webp%00.html',
    '/catalogue/%zz.webp',
    // No extension at all.
    '/catalogue/arogga/12507',
  ]) {
    assert.equal(servable(refused), false, `${refused} should not be servable`);
  }
});

test('the path the importer writes is a path the catalogue accepts and the API serves', () => {
  /*
   * The two halves of the same decision, asserted together. `importArogga.ts`
   * composes `${MEDIA_PREFIX}/catalogue/arogga/<product>/<file>` and stores it
   * on the medicine; if either the validation rule or the allow-list is
   * tightened without the other, every imported row starts pointing at nothing
   * and no existing test notices.
   */
  const written = `${MEDIA_PREFIX}/catalogue/arogga/12507/napro-a-plus-500-1-faf82da1d1-clean.webp`;

  const parsed = CreateMedicineSchema.safeParse({
    sku: 'AROGGA-12507',
    brandName: 'Napro-A Plus 500',
    manufacturer: 'The ACME Laboratories Ltd.',
    packSize: '10 Tablet',
    unit: 'Strip',
    category: 'Analgesic',
    costPriceMinor: 10_000,
    defaultSellingPriceMinor: 12_000,
    mrpMinor: 15_000,
    classification: 'OTC',
    productImageUrl: written,
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));

  assert.equal(
    servable(written.slice(MEDIA_PREFIX.length)),
    true,
    'the catalogue would store a picture the API then refuses to hand out',
  );
});

test('a picture is served, and cached, despite the no-store the API sets on everything', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}${MEDIA_PREFIX}/catalogue/arogga/999999/box.webp`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /image\/webp/);

    const cacheControl = response.headers.get('cache-control') ?? '';
    assert.notEqual(
      cacheControl,
      'no-store',
      'the global no-store won, so every catalogue photograph is re-fetched on every page view',
    );
    assert.match(cacheControl, /immutable/);
  });
});

test('a document sitting in the media root is still not served', async () => {
  /*
   * This is the test that makes the allow-list worth having. `box.html` is
   * genuinely on disk, next to a picture that genuinely is served, so a pass
   * here means the refusal came from the rule rather than from the file being
   * absent — which is the only way to tell the two apart.
   */
  await withServer(async (base) => {
    const picture = await fetch(`${base}${MEDIA_PREFIX}/catalogue/arogga/999999/box.webp`);
    const document = await fetch(`${base}${MEDIA_PREFIX}/catalogue/arogga/999999/box.html`);

    assert.equal(
      picture.status,
      200,
      'the sibling picture must be reachable for this to mean anything',
    );
    assert.equal(document.status, 404);
  });
});

test('a picture that is not there is a 404, and is not cached for a year', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}${MEDIA_PREFIX}/catalogue/arogga/999999/absent.webp`);
    assert.equal(response.status, 404);
    // Caching a 404 immutably means a picture uploaded five minutes later stays
    // invisible to that browser until the cache is cleared by hand.
    assert.doesNotMatch(response.headers.get('cache-control') ?? '', /immutable/);
  });
});
