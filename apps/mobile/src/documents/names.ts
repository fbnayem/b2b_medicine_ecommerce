/**
 * Naming a file that came off the network.
 *
 * Everything here is arithmetic on strings and has no native import, so it can
 * be tested on its own — `files.ts` next door needs `expo-file-system` and a
 * mocked API client to say anything at all.
 */

/**
 * A file name safe to write into the cache directory, built from a document
 * reference such as `INV-2026-000001`.
 *
 * **The reference comes from the server, and a file name is a path.** A
 * reference of `../../evil` would otherwise write outside the directory this
 * application is allowed to use, and one beginning with a dot writes a file the
 * user cannot see to delete. Neither is a realistic response from our own API;
 * both are one compromised or mistaken deployment away, and the sanitising
 * costs a line.
 *
 * Length is capped because Android's older filesystems refuse names beyond 255
 * bytes, and a reference is at most a couple of dozen characters anyway — if
 * one arrives long enough to matter, something is already wrong.
 */
export function documentFileName(reference: string, extension: string): string {
  const safe = reference
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 80);
  return `${safe || 'document'}.${extension}`;
}

/**
 * The extension for a `Content-Type`, because the share sheet on both platforms
 * decides which applications can open a file by its name and not by its bytes.
 * A proof photograph saved as `.dat` offers nothing to open it with.
 */
export function extensionFor(contentType: string | undefined): string {
  const subtype = (contentType ?? '').split(';')[0]!.trim().toLowerCase().split('/').pop();
  if (!subtype) return 'bin';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  const safe = subtype.replace(/[^a-z0-9]+/g, '');
  return safe || 'bin';
}

/** What went wrong saving a document, as a catalogue key rather than a sentence. */
export type SaveProblem =
  'documents.couldNotFetch' | 'documents.couldNotWrite' | 'documents.cannotShare';

export type SaveOutcome = { ok: true; uri: string } | { ok: false; problem: SaveProblem };
