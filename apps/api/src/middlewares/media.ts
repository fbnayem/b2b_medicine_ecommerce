import { extname, resolve } from 'node:path';
import express, { type RequestHandler } from 'express';
import { env } from '../env';

/**
 * Product photography, served as files.
 *
 * The catalogue import records a picture against every medicine it brings in.
 * Until this existed it recorded a path to nothing: the bytes sat in the
 * supplier's bundle, outside the deployment, and `productImageUrl` pointed at a
 * file no client could fetch. This is the other half of that step.
 *
 * **Unauthenticated, deliberately.** Both clients render these through an
 * ordinary `<img>` — a browser's image loader and React Native's `<Image>` — and
 * neither can attach a bearer token to one. The alternatives are a signed URL
 * scheme or streaming every photograph through an authenticated handler, and
 * both are real designs that buy nothing here: a photograph of a box tells a
 * stranger what the box looks like. Prices, stock and customers stay behind the
 * API, where they were.
 *
 * What is *not* relaxed is what may be served. An operator who drops an HTML
 * file into the media directory must not thereby get a page executing on the
 * API's own origin, so the extension allow-list below is checked before the
 * static handler is reached rather than trusted to the directory's contents.
 */

/** Public prefix. Also the prefix the importer writes into `productImageUrl`. */
export const MEDIA_PREFIX = '/media';

/**
 * Raster formats only. Notably absent: `.svg`, which is a document that can
 * carry script, and which a browser will execute if it is navigated to directly.
 */
const SERVABLE = new Set(['.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif']);

/** Where the pictures live, resolved once so nothing can disagree about it. */
export const mediaRoot = resolve(process.cwd(), env.MEDIA_ROOT);

/**
 * Whether a request path names something this API is willing to serve.
 *
 * `express.static` refuses traversal on its own, and this does not replace that
 * — it runs first because the extension check has to happen on the *decoded*
 * path, and a check written against the raw one would read `%2e%2e` as an
 * ordinary segment. Having decoded it, refusing traversal here as well costs a
 * line and means the guarantee does not rest on one library's behaviour.
 */
export function servable(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is not a filename anybody meant to ask for.
    return false;
  }
  if (decoded.includes('\0')) return false;
  for (const segment of decoded.split(/[\\/]/)) {
    // Rejects `..` and every dotfile, so a stray `.env` or `.git` under the
    // media root is not reachable even if one is put there by mistake.
    if (segment.startsWith('.')) return false;
  }
  return SERVABLE.has(extname(decoded).toLowerCase());
}

/**
 * The handler chain for `MEDIA_PREFIX`.
 *
 * Anything the guard declines falls through to the 404 handler, so a request
 * for `/media/x.html` is answered the same way as a request for a route that
 * does not exist — which is what it is.
 */
export function mediaFiles(): RequestHandler[] {
  const serve = express.static(mediaRoot, {
    index: false,
    redirect: false,
    dotfiles: 'deny',
    /*
     * Cache-Control is set here rather than through `maxAge`, for two reasons
     * that both bite silently.
     *
     * `securityHeaders()` puts `no-store` on every response before any route
     * sees it, and `send` will not replace a Cache-Control that is already
     * present — so the `maxAge` option would be accepted, ignored, and every
     * photograph re-fetched on every page view. And `setHeaders` runs only when
     * a file is actually about to be streamed, which is the difference between
     * caching a picture for a year and caching a 404 for a year.
     */
    setHeaders: (response) => {
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });

  return [
    (request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      if (!servable(request.path)) return next();
      return serve(request, response, next);
    },
  ];
}
