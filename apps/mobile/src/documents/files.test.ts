import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * `files.ts` reaches `expo-file-system`, `expo-sharing` and the API client —
 * the last of which reaches `react-native`, whose source is Flow-typed and
 * which the test runner cannot parse. Mocked exactly as `orders/quote.test.ts`
 * and `notifications/push.test.ts` do, so the decisions can be tested on a
 * workstation with no device attached.
 */
const state = vi.hoisted(() => ({
  get: vi.fn(),
  written: [] as Array<{ name: string; bytes: Uint8Array }>,
  createdWith: undefined as unknown,
  shareAvailable: true,
  shared: [] as Array<{ uri: string; options: Record<string, unknown> }>,
  writeThrows: false,
  accessToken: 'a-token' as string | null,
}));

vi.mock('../api/client', () => ({
  apiClient: { get: state.get },
  baseURL: 'https://api.example.test/api/v1',
}));

vi.mock('../store/useAuth', () => ({
  useAuthStore: { getState: () => ({ accessToken: state.accessToken }) },
}));

vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    name: string;
    constructor(_directory: unknown, name: string) {
      this.name = name;
    }
    get uri() {
      return `file:///cache/${this.name}`;
    }
    create(options: unknown) {
      state.createdWith = options;
    }
    write(bytes: Uint8Array) {
      if (state.writeThrows) throw new Error('no space left on device');
      state.written.push({ name: this.name, bytes });
    }
  },
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => state.shareAvailable,
  shareAsync: async (uri: string, options: Record<string, unknown>) => {
    state.shared.push({ uri, options });
  },
}));

const {
  authorisedFileSource,
  saveCreditNote,
  saveDeliveryProof,
  saveInvoice,
  savePaymentAttachment,
} = await import('./files');

function answers(body: string, contentType = 'application/pdf') {
  const bytes = new TextEncoder().encode(body);
  state.get.mockResolvedValue({
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    headers: { 'content-type': contentType },
  });
}

beforeEach(() => {
  state.get.mockReset();
  state.written = [];
  state.shared = [];
  state.createdWith = undefined;
  state.shareAvailable = true;
  state.writeThrows = false;
  state.accessToken = 'a-token';
});

describe('saving a document the API will only give to a signed-in caller', () => {
  it('writes the bytes it was sent, under the reference a person would recognise', async () => {
    answers('%PDF-1.7 pretend');
    const outcome = await saveInvoice('inv1', 'INV-2026-000001', 'Invoice');

    expect(outcome).toEqual({ ok: true, uri: 'file:///cache/INV-2026-000001.pdf' });
    expect(state.written).toHaveLength(1);
    expect(new TextDecoder().decode(state.written[0]!.bytes)).toBe('%PDF-1.7 pretend');
  });

  it('overwrites, because opening the same invoice twice is the ordinary case', async () => {
    answers('%PDF');
    await saveInvoice('inv1', 'INV-1', 'Invoice');
    expect(state.createdWith).toEqual({ overwrite: true });
  });

  it('takes the extension from what the server actually sent', async () => {
    answers('ÿØÿ', 'image/jpeg');
    await saveDeliveryProof('f1', 'DLV-9', 'Proof');
    expect(state.written[0]!.name).toBe('DLV-9.jpg');
    expect(state.shared[0]!.options.mimeType).toBe('image/jpeg');
  });

  it('does not let a reference from the server escape the cache directory', async () => {
    // The same rule `names.test.ts` proves in isolation, asserted here as well
    // because this is the only place the two are ever joined to a real path.
    answers('%PDF');
    await saveInvoice('inv1', '../../../etc/passwd', 'Invoice');
    expect(state.written[0]!.name).toBe('etc-passwd.pdf');
  });

  it('says the fetch failed, and writes nothing at all', async () => {
    state.get.mockRejectedValue(new Error('offline'));
    const outcome = await saveInvoice('inv1', 'INV-1', 'Invoice');

    expect(outcome).toEqual({ ok: false, problem: 'documents.couldNotFetch' });
    expect(state.written).toHaveLength(0);
    expect(state.shared).toHaveLength(0);
  });

  it('says the write failed rather than opening a share sheet on nothing', async () => {
    answers('%PDF');
    state.writeThrows = true;
    const outcome = await saveInvoice('inv1', 'INV-1', 'Invoice');

    expect(outcome).toEqual({ ok: false, problem: 'documents.couldNotWrite' });
    expect(state.shared).toHaveLength(0);
  });

  it('checks the share sheet exists before offering the file to it', async () => {
    /*
     * `shareAsync` throws where no sharing is available. Letting it throw would
     * surface as an unhandled rejection on a screen that has, by then, already
     * written the file — so the customer would be told nothing at all while the
     * document sat in the cache.
     */
    answers('%PDF');
    state.shareAvailable = false;
    const outcome = await saveInvoice('inv1', 'INV-1', 'Invoice');

    expect(outcome).toEqual({ ok: false, problem: 'documents.cannotShare' });
    expect(state.written).toHaveLength(1);
  });
});

describe('the four documents this application can hand over', () => {
  it('asks for the invoice on A4, not the till-roll layout', async () => {
    answers('%PDF');
    await saveInvoice('inv1', 'INV-2026-000001', 'Invoice');
    expect(state.get).toHaveBeenCalledWith('/fulfilment/invoices/inv1/pdf', {
      params: { layout: 'a4' },
      responseType: 'arraybuffer',
    });
  });

  it('asks the credit note for its PDF, which is not what it answers by default', async () => {
    // Without `format=pdf` this endpoint returns JSON, and the file written
    // would be a `.pdf` containing a JSON document — valid, saved, and useless.
    answers('%PDF');
    await saveCreditNote('cn1', 'CRN-2026-000007', 'Credit note');
    expect(state.get).toHaveBeenCalledWith('/returns/credit-notes/cn1', {
      params: { format: 'pdf' },
      responseType: 'arraybuffer',
    });
  });

  it('asks for a proof file and an attachment as they are stored', async () => {
    // No parameters: whatever the rider's phone captured is what should come
    // back, at whatever type it was captured as.
    answers('ÿØÿ', 'image/jpeg');
    await saveDeliveryProof('f1', 'DLV-2026-000003', 'Delivery');
    expect(state.get).toHaveBeenCalledWith('/deliveries/proof/f1', {
      responseType: 'arraybuffer',
    });

    await savePaymentAttachment('p1', 'PAY-2026-000004', 'Payment');
    expect(state.get).toHaveBeenCalledWith('/payments/p1/attachment', {
      responseType: 'arraybuffer',
    });
  });
});

describe('showing a picture the API will only give to a signed-in caller', () => {
  it('carries the credential, because the image loader has no interceptor', () => {
    expect(authorisedFileSource('/deliveries/proof/f1')).toEqual({
      uri: 'https://api.example.test/api/v1/deliveries/proof/f1',
      headers: { Authorization: 'Bearer a-token' },
    });
  });

  it('sends no empty authorisation header when there is no token', () => {
    state.accessToken = null;
    expect(authorisedFileSource('/deliveries/proof/f1').headers).toEqual({});
  });
});
