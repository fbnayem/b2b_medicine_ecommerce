import { describe, expect, it, vi } from 'vitest';
import { RegisterShopSchema } from '@medsupply/validation';
import { catalogueKeys, en } from '@medsupply/i18n';

// `registration.ts` reaches the API client, and through it `react-native`,
// whose Flow-typed source esbuild cannot parse.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

const { REGISTRATION_PASSWORD_MINIMUM, emptyRegistration, registrationBody, registrationProblem } =
  await import('./registration');

const KNOWN = new Set(catalogueKeys(en));

/**
 * The registration form's own checks, and the one property that matters about
 * them: **they agree with the server.**
 *
 * A client stricter than `RegisterShopSchema` refuses something the API would
 * take, and the person typing has no way to discover what the extra rule was. A
 * client looser than it sends a finished form and gets back a list of paths. On
 * a ten-field form typed with a thumb, either is enough to lose the customer —
 * so the last test in this file feeds the *server's own schema* the very drafts
 * this module accepts.
 */

const complete = () => ({
  ...emptyRegistration(),
  firstName: 'Rahim',
  lastName: 'Uddin',
  email: 'rahim@pharmacy.test',
  password: 'Correct-Horse-1',
  shopName: 'Rahim Pharmacy',
  primaryPhone: '01712345678',
  drugLicenceNumber: 'DL-1234',
  line1: '12 Green Road, Block C',
  city: 'Dhaka',
  district: 'Dhaka',
});

describe('what is wrong with a registration', () => {
  it('accepts a form somebody has genuinely filled in', () => {
    expect(registrationProblem(complete())).toBeNull();
  });

  it('reports the first problem in screen order, not the last', () => {
    /*
     * An empty form has ten problems. Naming the last one sends somebody to the
     * bottom of the page to fix a field they have not reached yet.
     */
    expect(registrationProblem(emptyRegistration())?.field).toBe('firstName');
  });

  it('names each field so the screen can mark and focus it', () => {
    const cases: Array<[Partial<ReturnType<typeof complete>>, string]> = [
      [{ firstName: 'R' }, 'firstName'],
      [{ lastName: '' }, 'lastName'],
      [{ email: 'not-an-address' }, 'email'],
      [{ password: 'short' }, 'password'],
      [{ shopName: 'AB' }, 'shopName'],
      [{ primaryPhone: '12345' }, 'primaryPhone'],
      [{ drugLicenceNumber: '' }, 'drugLicenceNumber'],
      [{ line1: 'A1' }, 'line1'],
      [{ city: 'D' }, 'city'],
      [{ district: '' }, 'district'],
    ];
    for (const [over, field] of cases) {
      expect(registrationProblem({ ...complete(), ...over })?.field, field).toBe(field);
    }
  });

  it('insists on a Bangladesh mobile number, in either of the two forms people write', () => {
    // Both are what `bdPhone` accepts, and both are what people actually type.
    expect(registrationProblem({ ...complete(), primaryPhone: '01712345678' })).toBeNull();
    expect(registrationProblem({ ...complete(), primaryPhone: '+8801712345678' })).toBeNull();
    // A landline and an overseas number are not mobile numbers a rider can call.
    expect(registrationProblem({ ...complete(), primaryPhone: '01212345678' })?.field).toBe(
      'primaryPhone',
    );
    expect(registrationProblem({ ...complete(), primaryPhone: '+14155550100' })?.field).toBe(
      'primaryPhone',
    );
  });

  it('requires the drug licence number, unlike the staff shop form', () => {
    /*
     * `CreateShopSchema` leaves it optional because a member of staff has
     * spoken to the customer. Nobody has spoken to this one, and the licence
     * number is the single field that can be checked against a register
     * afterwards — which is most of what makes self-registration reviewable.
     */
    expect(registrationProblem({ ...complete(), drugLicenceNumber: '' })?.field).toBe(
      'drugLicenceNumber',
    );
  });

  it('every key it can return is one the catalogue holds', () => {
    // These reach the screen as `t(problem.key, problem.values)`, which
    // `catalogueKeys.test.ts` cannot see.
    const keys = [
      registrationProblem(emptyRegistration()),
      registrationProblem({ ...complete(), email: 'x' }),
      registrationProblem({ ...complete(), password: 'a' }),
      registrationProblem({ ...complete(), shopName: '' }),
      registrationProblem({ ...complete(), primaryPhone: '1' }),
      registrationProblem({ ...complete(), drugLicenceNumber: '' }),
      registrationProblem({ ...complete(), line1: '' }),
      registrationProblem({ ...complete(), city: '' }),
      registrationProblem({ ...complete(), district: '' }),
    ].map((problem) => problem?.key);

    expect(keys.filter(Boolean).length).toBeGreaterThan(6);
    expect(keys.filter((key) => key && !KNOWN.has(key))).toEqual([]);
  });
});

describe('the body that goes to the server', () => {
  it('trims what a trailing space would spoil, and leaves the password alone', () => {
    const body = registrationBody({
      ...complete(),
      shopName: '  Rahim Pharmacy  ',
      password: ' spaces matter ',
    });
    expect(body.shopName).toBe('Rahim Pharmacy');
    // Trimming a password stores one thing and signs in with another, and the
    // failure appears at the next sign-in with nothing to explain it.
    expect(body.password).toBe(' spaces matter ');
  });

  it('lower-cases the email, because that is what will be typed at sign-in', () => {
    expect(registrationBody({ ...complete(), email: 'Rahim@Pharmacy.Test' }).email).toBe(
      'rahim@pharmacy.test',
    );
  });

  it('labels the address with the shop’s own name', () => {
    // The form asks for one address and no label for it. "Rahim Pharmacy" is
    // what a rider will recognise; "Address 1" is not.
    expect(registrationBody(complete()).address.label).toBe('Rahim Pharmacy');
  });
});

describe('agreement with the server', () => {
  it('sends nothing the schema refuses', () => {
    /*
     * The test this file exists for. `RegisterShopSchema` is the authority; a
     * draft this module calls acceptable must survive it, or a customer gets a
     * green form and a red response.
     */
    const parsed = RegisterShopSchema.safeParse(registrationBody(complete()));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('is no stricter than the schema at the edges', () => {
    // The exact minimums: two-character names, three-character shop name and
    // licence, five-character street, two-character city and district. If the
    // client demanded more, these would be refused here and accepted there.
    const minimal = {
      ...complete(),
      firstName: 'Ab',
      lastName: 'Cd',
      shopName: 'ABC',
      drugLicenceNumber: 'D-1',
      line1: '12 GR',
      city: 'Ct',
      district: 'Ct',
      password: 'a'.repeat(REGISTRATION_PASSWORD_MINIMUM),
    };
    expect(registrationProblem(minimal)).toBeNull();
    expect(RegisterShopSchema.safeParse(registrationBody(minimal)).success).toBe(true);
  });

  it('refuses what the schema refuses, so nothing reaches it that cannot pass', () => {
    /*
     * The other direction, and the one that stops the form from being a
     * round-trip generator. Each of these is a value the server rejects; each
     * must be caught here first.
     */
    const bad = [
      { firstName: 'R' },
      { email: 'nope' },
      { password: 'short' },
      { shopName: 'AB' },
      { primaryPhone: '999' },
      { drugLicenceNumber: '' },
      { line1: 'A' },
    ];
    for (const over of bad) {
      const draft = { ...complete(), ...over };
      expect(registrationProblem(draft), JSON.stringify(over)).not.toBeNull();
      expect(RegisterShopSchema.safeParse(registrationBody(draft)).success).toBe(false);
    }
  });

  it('never sends a credit limit, payment terms, a discount or a price list', () => {
    /*
     * A customer must not choose their own commercial terms. The server writes
     * those from constants and does not read them from the request — this is
     * the client half of the same statement, so a "helpful" addition here has
     * to be deleted from two places.
     */
    const body = registrationBody(complete()) as Record<string, unknown>;
    for (const forbidden of ['creditLimit', 'paymentTermsDays', 'defaultDiscount', 'priceListId']) {
      expect(body, forbidden).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(RegisterShopSchema.shape)).not.toContain('creditLimit');
  });
});
