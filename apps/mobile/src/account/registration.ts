import { apiClient } from '../api/client';

/**
 * A pharmacy registering itself from the phone.
 *
 * The checks here mirror `RegisterShopSchema` field for field and no more. A
 * client that is stricter than the server invents a rule nobody wrote down; a
 * client that is looser sends a form somebody has finished filling in and gets
 * back a list of paths. Neither is acceptable on a nine-field form typed with a
 * thumb, which is why the order of the checks — and therefore which single
 * message somebody sees — is the whole content of this module.
 */

export interface RegistrationDraft {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  shopName: string;
  primaryPhone: string;
  drugLicenceNumber: string;
  line1: string;
  city: string;
  district: string;
}

export const emptyRegistration = (): RegistrationDraft => ({
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  shopName: '',
  primaryPhone: '',
  drugLicenceNumber: '',
  line1: '',
  city: '',
  district: '',
});

/**
 * The same expression `bdPhone` uses in `@medsupply/validation`.
 *
 * Copied rather than imported on purpose: the shared package is the authority
 * and this is a courtesy, and the two are checked against each other by
 * `registration.test.ts` so the copy cannot quietly drift into a different rule.
 */
const BD_PHONE = /^(\+8801|01)[3-9]\d{8}$/;

/** The minimum `RegisterShopSchema` sets, which a deployment may raise. */
export const REGISTRATION_PASSWORD_MINIMUM = 8;

export type RegistrationField = keyof RegistrationDraft;

export interface RegistrationProblem {
  field: RegistrationField;
  key: string;
  values?: Record<string, string | number>;
}

/**
 * The first thing wrong with the form, in the order the fields are on screen.
 *
 * Reporting the *first* problem rather than all of them is deliberate on a
 * phone: a list of five messages does not fit above the fold, and the field it
 * names can be scrolled to and focused. Reporting them out of screen order
 * would send somebody up and down the form.
 */
export function registrationProblem(draft: RegistrationDraft): RegistrationProblem | null {
  if (draft.firstName.trim().length < 2) {
    return { field: 'firstName', key: 'register.nameTooShort' };
  }
  if (draft.lastName.trim().length < 2) {
    return { field: 'lastName', key: 'register.nameTooShort' };
  }
  // Deliberately loose, and the same shape the server's `z.string().email()`
  // accepts in practice: something, an @, something with a dot in it.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
    return { field: 'email', key: 'register.emailInvalid' };
  }
  if (draft.password.length < REGISTRATION_PASSWORD_MINIMUM) {
    return {
      field: 'password',
      key: 'auth.passwordTooShort',
      values: { minimum: REGISTRATION_PASSWORD_MINIMUM },
    };
  }
  if (draft.shopName.trim().length < 3) {
    return { field: 'shopName', key: 'register.shopNameTooShort' };
  }
  if (!BD_PHONE.test(draft.primaryPhone.trim())) {
    return { field: 'primaryPhone', key: 'register.phoneInvalid' };
  }
  if (draft.drugLicenceNumber.trim().length < 3) {
    return { field: 'drugLicenceNumber', key: 'register.licenceRequired' };
  }
  if (draft.line1.trim().length < 5) {
    return { field: 'line1', key: 'addresses.line1TooShort' };
  }
  if (draft.city.trim().length < 2) return { field: 'city', key: 'addresses.cityTooShort' };
  if (draft.district.trim().length < 2) {
    return { field: 'district', key: 'addresses.districtTooShort' };
  }
  return null;
}

/**
 * The draft as the API takes it.
 *
 * The password is **not** trimmed — a space is a character in a password, and
 * trimming here would store one thing and sign in with another. Everything else
 * is, because a trailing space in a shop name is a trailing space on every
 * invoice.
 */
export function registrationBody(draft: RegistrationDraft) {
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    email: draft.email.trim().toLowerCase(),
    password: draft.password,
    shopName: draft.shopName.trim(),
    primaryPhone: draft.primaryPhone.trim(),
    drugLicenceNumber: draft.drugLicenceNumber.trim(),
    address: {
      label: draft.shopName.trim(),
      line1: draft.line1.trim(),
      city: draft.city.trim(),
      district: draft.district.trim(),
    },
  };
}

export interface Registered {
  shop: { reference: string; name: string };
  email: string;
}

export async function registerShop(draft: RegistrationDraft): Promise<Registered> {
  const response = await apiClient.post<{ data: Registered }>(
    '/auth/register',
    registrationBody(draft),
  );
  return response.data.data;
}
