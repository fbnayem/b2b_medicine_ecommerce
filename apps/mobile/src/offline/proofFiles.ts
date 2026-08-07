import { File, Paths } from 'expo-file-system';

/**
 * The photograph, the signature and the payment slip, held on disk until there
 * is signal to send them.
 *
 * ## Why not in the queue itself
 *
 * The queue is JSON in `AsyncStorage`, which on Android is one SQLite row per
 * key. A delivery photograph at the quality this application captures is a few
 * hundred kilobytes of base64, a signature adds more, and a payment slip a third
 * — so a rider with four unsent stops would be asking `AsyncStorage` to hold
 * several megabytes in a single value, which is how a queue starts silently
 * failing to write. The queue holds **paths**; the bytes live here.
 *
 * ## Why `Paths.document` and not `Paths.cache`
 *
 * The cache is, by the operating system's definition, a place it may reclaim
 * when storage runs short. Everything else this application writes goes there
 * deliberately — an invoice a pharmacy has already been offered is a copy of
 * something the server holds. **Proof waiting for signal is not a copy of
 * anything.** If the phone deletes it, the delivery cannot be evidenced and the
 * rider is the one who has to explain it.
 *
 * Files are removed only once the server has the completion, in
 * `delivery/offlineQueue.ts`.
 */

/** Where a queued proof file lives, and what it is a proof of. */
export interface HeldFile {
  uri: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png';
}

const FOLDER = 'medsupply-proof';

/**
 * A name that cannot escape the folder it is written into.
 *
 * The reference comes from the server and becomes part of a path, which is the
 * same reasoning `documents/names.ts` carries — this application has two places
 * where a server string becomes a file name, and both sanitise.
 */
function safeName(reference: string, kind: string, extension: string): string {
  const stem = reference
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 60);
  return `${stem || 'delivery'}-${kind}.${extension}`;
}

/**
 * Write one base64 payload down and return where it went.
 *
 * Stored **as the base64 text**, not decoded to bytes: it is what the request
 * body carries, so writing it verbatim means reading it back is `file.text()`
 * with nothing to get wrong. Decoding to bytes and calling `file.base64()` on
 * the way out would be a third smaller on disk and two conversions that have to
 * agree; a few hundred kilobytes is not worth that.
 */
export function holdProof(
  reference: string,
  kind: 'photo' | 'signature' | 'payment',
  base64Data: string,
  mimeType: HeldFile['mimeType'],
): HeldFile {
  const fileName = safeName(reference, kind, mimeType === 'image/png' ? 'png' : 'jpg');
  const file = new File(Paths.document, FOLDER, fileName);
  // Overwrite: a rider who retakes a photograph before the queue flushes is
  // replacing it, not adding a second one.
  file.create({ overwrite: true, intermediates: true });
  file.write(base64Data);
  return { uri: file.uri, fileName, mimeType };
}

/**
 * Read one back for sending, or `undefined` if it is no longer there.
 *
 * Absent rather than throwing: a proof file that has gone missing must not stop
 * the rest of the completion — the receiver's name, the time, and the cash are
 * the parts somebody is waiting on, and the server will say if it required a
 * photograph it did not get.
 */
export async function readProof(held: HeldFile) {
  const file = new File(held.uri);
  if (!file.exists) return undefined;
  return { fileName: held.fileName, mimeType: held.mimeType, base64Data: await file.text() };
}

/** Once the server has it, the phone does not need it. */
export function releaseProof(held: HeldFile | undefined) {
  if (!held) return;
  const file = new File(held.uri);
  if (file.exists) file.delete();
}
