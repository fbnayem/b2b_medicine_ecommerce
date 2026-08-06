import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { apiClient, baseURL } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { documentFileName, extensionFor, type SaveOutcome } from './names';

/**
 * Files the API will only hand over to a signed-in caller: an invoice PDF, a
 * credit note, a proof-of-delivery photograph, the deposit slip behind a
 * payment.
 *
 * All four are endpoints that answer with **bytes and a `Content-Type`**, not
 * with JSON, which is why none of them could be used through the ordinary
 * screens: there is nothing to render. On a desktop the browser opens a blob in
 * a tab. A phone has no such thing, so the file has to be written somewhere and
 * handed to whatever is installed to open it.
 *
 * Each document below **names its own request**, rather than passing a path
 * into a shared fetcher. That is not style: `api/callers.test.ts` reads the
 * HTTP method sitting immediately before a path literal, and a path handed
 * through a variable is invisible to it — so a shared fetcher would quietly
 * exempt all four of these from the one gate that exists to notice when a
 * capability loses its caller.
 */

/** What every one of these requests asks for: the bytes, not a rendering. */
const BYTES = { responseType: 'arraybuffer' } as const;

type Answer = { data: ArrayBuffer; headers: Record<string, unknown> };

/**
 * An image source the API will actually answer.
 *
 * A proof photograph is something a pharmacy **looks at**, not something it
 * files away, so it is rendered in place. `Image` accepts request headers for
 * exactly this case; without them the request arrives with no credential and
 * the customer gets a broken image where the signature should be.
 *
 * This deliberately reads the token rather than going through `apiClient`,
 * because the fetch happens inside the native image loader where an interceptor
 * cannot reach. That means **no refresh-and-retry**: if the access token has
 * expired the image fails while the rest of the screen works. It is acceptable
 * only because every screen using this has already loaded its data through
 * `apiClient` moments earlier, so a token that works for the screen works for
 * the picture on it.
 */
export function authorisedFileSource(path: string): {
  uri: string;
  headers: Record<string, string>;
} {
  const token = useAuthStore.getState().accessToken;
  return {
    uri: `${baseURL}${path}`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

/**
 * Write a fetched document into the cache directory and offer it to the share
 * sheet — which on both platforms is also how a file gets saved, printed or
 * sent to somebody.
 *
 * The cache directory rather than documents: this is a copy of something the
 * server holds, the customer has already been given the chance to keep it, and
 * the operating system may reclaim the space. A pharmacy's phone should not
 * fill up with every invoice it has ever glanced at.
 *
 * Goes through `apiClient` rather than `File.downloadFileAsync`, which would be
 * fewer lines and would carry no interceptor: an expired access token would
 * fail the download with no refresh and no retry, on the one screen where a
 * customer is trying to obtain a document rather than read one.
 */
async function saveAndShare(request: {
  fetch: () => Promise<Answer>;
  /** The human reference — `INV-2026-000001` — which becomes the file name. */
  reference: string;
  /** Shown as the share-sheet title on Android and web. */
  dialogTitle: string;
}): Promise<SaveOutcome> {
  let bytes: Uint8Array;
  let contentType: string | undefined;
  try {
    const answer = await request.fetch();
    bytes = new Uint8Array(answer.data);
    contentType = answer.headers['content-type'] as string | undefined;
  } catch {
    return { ok: false, problem: 'documents.couldNotFetch' };
  }

  const mimeType = (contentType ?? 'application/octet-stream').split(';')[0]!.trim();
  const name = documentFileName(request.reference, extensionFor(contentType));

  let uri: string;
  try {
    const file = new File(Paths.cache, name);
    // Overwrite, because opening the same invoice twice is the ordinary case
    // and the second attempt failing on "already exists" would be absurd.
    file.create({ overwrite: true });
    file.write(bytes);
    uri = file.uri;
  } catch {
    return { ok: false, problem: 'documents.couldNotWrite' };
  }

  /*
   * Checked rather than assumed: `shareAsync` throws where no share sheet
   * exists, and the file is already written by then — so the customer would be
   * told the save failed when it had not.
   */
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, problem: 'documents.cannotShare' };
  }

  await Sharing.shareAsync(uri, {
    mimeType,
    dialogTitle: request.dialogTitle,
    UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
  });
  return { ok: true, uri };
}

/** The invoice a shop was sent, as the PDF the distributor issued. */
export function saveInvoice(invoiceId: string, reference: string, dialogTitle: string) {
  return saveAndShare({
    fetch: () =>
      apiClient.get<ArrayBuffer>(`/fulfilment/invoices/${invoiceId}/pdf`, {
        // A4 rather than the 80 mm thermal layout: this one is going to a
        // phone, an email or a printer, not to a counter-top till roll.
        params: { layout: 'a4' },
        ...BYTES,
      }),
    reference,
    dialogTitle,
  });
}

/** The credit note behind an accepted return — the proof the money came back. */
export function saveCreditNote(creditNoteId: string, reference: string, dialogTitle: string) {
  return saveAndShare({
    fetch: () =>
      apiClient.get<ArrayBuffer>(`/returns/credit-notes/${creditNoteId}`, {
        // Without this the endpoint answers JSON, and the file written would be
        // a `.pdf` holding a JSON document — valid, saved, and useless.
        params: { format: 'pdf' },
        ...BYTES,
      }),
    reference,
    dialogTitle,
  });
}

/** The photograph or signature taken when the goods were handed over. */
export function saveDeliveryProof(fileId: string, reference: string, dialogTitle: string) {
  return saveAndShare({
    fetch: () => apiClient.get<ArrayBuffer>(`/deliveries/proof/${fileId}`, BYTES),
    reference,
    dialogTitle,
  });
}

/** The deposit slip or transfer screenshot filed against a payment. */
export function savePaymentAttachment(paymentId: string, reference: string, dialogTitle: string) {
  return saveAndShare({
    fetch: () => apiClient.get<ArrayBuffer>(`/payments/${paymentId}/attachment`, BYTES),
    reference,
    dialogTitle,
  });
}
