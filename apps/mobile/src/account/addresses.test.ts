import { describe, expect, it, vi } from 'vitest';
import { catalogueKeys, en } from '@medsupply/i18n';

/*
 * `addresses.ts` reaches the API client, which reaches `react-native` — whose
 * source is Flow-typed and which esbuild cannot parse. Mocked so the pure half
 * can be tested on a workstation, exactly as `orders/quote.test.ts` does.
 */
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

const { addressBody, addressProblem, defaultAddress, draftFrom, emptyDraft, oneLine } =
  await import('./addresses');
type DeliveryAddress = import('./addresses').DeliveryAddress;

const KNOWN = new Set(catalogueKeys(en));

/**
 * The rules the address screen applies before it asks the server anything.
 *
 * Two of them are the reason this file exists rather than the checks living
 * inline: the trimming, because an empty optional field sent as `''` is stored
 * and rendered as a blank line under the street; and `defaultAddress`, because
 * checkout has been preselecting the wrong one since the checkout screen was
 * written.
 */

const draft = (over: Partial<ReturnType<typeof emptyDraft>> = {}) => ({
  ...emptyDraft(),
  label: 'Shop front',
  line1: '12 Green Road',
  city: 'Dhaka',
  district: 'Dhaka',
  ...over,
});

describe('what is wrong with a draft', () => {
  it('accepts the shortest address somebody could really have', () => {
    expect(addressProblem(draft())).toBeNull();
  });

  it('names the field, not just the fact, so the screen can focus it', () => {
    // A form that says "something is wrong" and highlights nothing is a form
    // somebody scrolls up and down looking at.
    expect(addressProblem(draft({ label: '' }))?.field).toBe('label');
    expect(addressProblem(draft({ line1: 'A1' }))?.field).toBe('line1');
    expect(addressProblem(draft({ city: 'D' }))?.field).toBe('city');
    expect(addressProblem(draft({ district: '' }))?.field).toBe('district');
  });

  it('returns a catalogue key rather than an English sentence', () => {
    /*
     * The message somebody reads while standing at a counter must go through
     * the catalogue like everything else. A rule that returns finished English
     * is a rule whose output cannot be translated.
     */
    expect(addressProblem(draft({ line1: '' }))?.key).toBe('addresses.line1TooShort');
  });

  it('every key it can return is one the catalogue holds', () => {
    /*
     * `catalogueKeys.test.ts` finds keys by reading literal `t('…')` call
     * sites, and these reach the screen as `t(problem.key)` — a variable, and
     * so invisible to it. Without this a misspelling renders as the dotted path
     * `addresses.cityTooShort` under the field it is complaining about.
     */
    const keys = [
      addressProblem(draft({ label: '' })),
      addressProblem(draft({ line1: '' })),
      addressProblem(draft({ city: '' })),
      addressProblem(draft({ district: '' })),
    ].map((problem) => problem?.key);

    expect(keys.filter(Boolean)).toHaveLength(4);
    expect(keys.filter((key) => key && !KNOWN.has(key))).toEqual([]);
  });

  it('does not count whitespace as an answer', () => {
    expect(addressProblem(draft({ label: '   ' }))?.field).toBe('label');
    expect(addressProblem(draft({ line1: '      ' }))?.field).toBe('line1');
  });

  it('is no stricter than the server, so nothing is refused twice over', () => {
    // `AddressSchema` asks for five characters of street and two of city and
    // district. A client that demanded more would be inventing a rule nobody
    // wrote down, and the person typing would have no way to find out what it
    // was.
    expect(addressProblem(draft({ line1: '12 GR', city: 'Ch', district: 'Ct' }))).toBeNull();
  });
});

describe('the body that goes to the server', () => {
  it('trims every field', () => {
    expect(addressBody(draft({ label: '  Back godown  ', city: ' Dhaka ' }))).toMatchObject({
      label: 'Back godown',
      city: 'Dhaka',
    });
  });

  it('leaves an untouched optional field out entirely', () => {
    /*
     * Not `line2: ''`. An empty string is a value, and the schema takes it —
     * so it is stored, and then drawn as a blank line between the street and
     * the city on every screen that renders the address, including the rider's.
     */
    const body = addressBody(draft());
    expect(body).not.toHaveProperty('line2');
    expect(body).not.toHaveProperty('postalCode');
  });

  it('keeps an optional field that was actually filled in', () => {
    const body = addressBody(draft({ line2: 'Beside the mosque', postalCode: '1205' }));
    expect(body.line2).toBe('Beside the mosque');
    expect(body.postalCode).toBe('1205');
  });
});

describe('which address a screen should offer first', () => {
  const addresses = [
    { _id: '1', label: 'First typed', isDefault: false },
    { _id: '2', label: 'The real one', isDefault: true },
  ] as DeliveryAddress[];

  it('is the one the shop marked, not the one typed first', () => {
    /*
     * The defect this replaces: `checkout.tsx` took `deliveryAddresses[0]`,
     * which is document order — the order the addresses were created in. A
     * pharmacy whose default is their second branch was offered the first one
     * on every order and had to spot it each time.
     */
    expect(defaultAddress(addresses)?.label).toBe('The real one');
  });

  it('falls back to the first when nothing is marked', () => {
    // Older shops seeded before the invariant existed can hold a list with no
    // default. Offering nothing at all would leave the submit button disabled
    // with no field to blame.
    const unmarked = addresses.map((entry) => ({ ...entry, isDefault: false }));
    expect(defaultAddress(unmarked)?.label).toBe('First typed');
  });

  it('offers nothing when there is nothing', () => {
    expect(defaultAddress([])).toBeUndefined();
  });
});

describe('reading an address back', () => {
  const address: DeliveryAddress = {
    _id: '1',
    label: 'Shop front',
    line1: '12 Green Road',
    city: 'Dhaka',
    district: 'Dhaka',
    isDefault: true,
  };

  it('joins only the parts that are there', () => {
    expect(oneLine(address)).toBe('12 Green Road, Dhaka, Dhaka');
    expect(oneLine({ ...address, line2: 'Beside the mosque' })).toBe(
      '12 Green Road, Beside the mosque, Dhaka, Dhaka',
    );
  });

  it('never leaves a stray comma where an optional line was empty', () => {
    // The visible symptom of joining before filtering, and the reason the
    // filter is in `oneLine` rather than at each call site.
    expect(oneLine({ ...address, line2: '' })).not.toContain(', ,');
  });

  it('round-trips into a draft the form can edit', () => {
    const editable = draftFrom({ ...address, line2: 'Beside the mosque' });
    expect(editable.line2).toBe('Beside the mosque');
    // `undefined` in a `TextInput` value makes it uncontrolled, and the field
    // then silently stops responding to state.
    expect(draftFrom(address).line2).toBe('');
    expect(draftFrom(address).postalCode).toBe('');
  });
});
