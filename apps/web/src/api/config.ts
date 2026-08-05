/**
 * Where this build talks to.
 *
 * The origin was hard-coded to `http://localhost:5000` until Phase 12, which
 * meant a production build talked to the developer's machine. It now comes from
 * the build, and the default is a same-origin relative path, so a deployment
 * behind one reverse proxy needs no configuration — and, because the request is
 * then same-site, the `SameSite=Strict` refresh cookie is actually delivered.
 *
 * It lives in its own module rather than alongside the axios instance because
 * tests replace that instance wholesale; a value nobody needs to mock should
 * not sit inside the thing everybody mocks.
 */
export const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api/v1';

/**
 * The Socket.IO origin, derived from the same value so one build argument
 * configures both. An empty string tells socket.io to connect back to the
 * page's own origin, which is what a relative API base implies.
 */
export const realtimeOrigin = /^https?:\/\//.test(apiBaseUrl) ? new URL(apiBaseUrl).origin : '';

/**
 * Where a product photograph actually lives.
 *
 * The catalogue stores `/media/catalogue/...` — a path, not a URL, because the
 * API has no idea what origin it is reached on. In production that path is
 * same-origin and needs nothing done to it; in development the web application
 * is on 5173 and the API on 5000, so it needs the API's origin in front. The
 * same value that already resolves the realtime channel resolves this, so a
 * build cannot have the two disagree.
 *
 * A row whose picture is already an absolute URL — a hosted one, rather than
 * one the importer placed — is left alone.
 */
export function mediaUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${realtimeOrigin}${path.startsWith('/') ? path : `/${path}`}`;
}
