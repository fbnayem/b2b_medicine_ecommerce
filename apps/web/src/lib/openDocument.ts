import { apiClient } from '../api/client';

/**
 * Opening a document the API will only give to a signed-in caller.
 *
 * **`requireAuth` reads a bearer header and nothing else** — no cookie, no
 * query parameter. So an `<a href="/api/v1/…">` pointing at one of these
 * endpoints opens a tab showing `{"error":{"code":"UNAUTHORIZED"}}`, which is
 * what the credit-note link on the return screen did from the day it was
 * written. It looked like a working link, and the only way to find out
 * otherwise was to click it.
 *
 * Fetching through the client and opening the result as a blob is the shape
 * three screens had each written for themselves; this is that shape, once, so
 * the fourth one cannot be written as a link again.
 *
 * The object URL is revoked after half a minute rather than immediately: the
 * new tab needs it long enough to load, and holding it for the life of the page
 * leaks the whole document into memory for as long as the user stays.
 */
export async function openDocument(
  path: string,
  params?: Record<string, string>,
): Promise<boolean> {
  try {
    const file = await apiClient.get(path, { params, responseType: 'blob' });
    const objectUrl = URL.createObjectURL(file.data as Blob);
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return true;
  } catch {
    return false;
  }
}
