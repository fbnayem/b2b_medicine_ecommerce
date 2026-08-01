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
