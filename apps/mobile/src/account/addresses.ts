import { apiClient } from '../api/client';

/**
 * A shop's delivery addresses, from the phone.
 *
 * The screen this serves is the answer to a question with real consequences: a
 * shop with no delivery address cannot submit an order, because
 * `POST /orders/submit` requires a `deliveryAddressId`. Until this phase the
 * only way to get one was to telephone the distributor and have an
 * administrator type it in.
 *
 * The validation below is a **courtesy copy** of the server's, not a second
 * authority. It exists so somebody typing on a phone with one thumb finds out
 * that the street is too short before a round trip tells them, and it is
 * deliberately no stricter than `DeliveryAddressSchema` — a client that refuses
 * what the server accepts is a client that has quietly invented a rule.
 */

export interface DeliveryAddress {
  _id: string;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  district: string;
  postalCode?: string;
  isDefault: boolean;
}

/** What a person has typed so far. Every field is a string, because inputs are. */
export interface AddressDraft {
  label: string;
  line1: string;
  line2: string;
  city: string;
  district: string;
  postalCode: string;
}

export const emptyDraft = (): AddressDraft => ({
  label: '',
  line1: '',
  line2: '',
  city: '',
  district: '',
  postalCode: '',
});

export const draftFrom = (address: DeliveryAddress): AddressDraft => ({
  label: address.label,
  line1: address.line1,
  line2: address.line2 ?? '',
  city: address.city,
  district: address.district,
  postalCode: address.postalCode ?? '',
});

/**
 * Which field is wrong, as a catalogue key rather than a sentence.
 *
 * Returning finished English from a rule is how the one message somebody reads
 * while standing at a counter ends up being the only untranslated thing on the
 * screen — `dispositionProblem` in the returns module records the same mistake
 * being corrected.
 */
export type AddressProblem =
  | { field: 'label'; key: 'addresses.labelRequired' }
  | { field: 'line1'; key: 'addresses.line1TooShort' }
  | { field: 'city'; key: 'addresses.cityTooShort' }
  | { field: 'district'; key: 'addresses.districtTooShort' };

/**
 * The first thing wrong with a draft, or `null`.
 *
 * The minimums mirror `AddressSchema`: `line1` at five characters and `city`
 * and `district` at two. Five is not arbitrary — it is roughly the shortest
 * string that could name a place a rider can find.
 */
export function addressProblem(draft: AddressDraft): AddressProblem | null {
  if (draft.label.trim().length < 1) return { field: 'label', key: 'addresses.labelRequired' };
  if (draft.line1.trim().length < 5) return { field: 'line1', key: 'addresses.line1TooShort' };
  if (draft.city.trim().length < 2) return { field: 'city', key: 'addresses.cityTooShort' };
  if (draft.district.trim().length < 2) {
    return { field: 'district', key: 'addresses.districtTooShort' };
  }
  return null;
}

/** The draft as the API takes it: trimmed, and with the blanks left out. */
export function addressBody(draft: AddressDraft): Record<string, string> {
  const body: Record<string, string> = {
    label: draft.label.trim(),
    line1: draft.line1.trim(),
    city: draft.city.trim(),
    district: draft.district.trim(),
  };
  // `''` is not "no second line" to a schema expecting an optional string; it
  // is an empty second line, and it would be stored and then rendered as a
  // blank row under the street.
  if (draft.line2.trim()) body.line2 = draft.line2.trim();
  if (draft.postalCode.trim()) body.postalCode = draft.postalCode.trim();
  return body;
}

/**
 * Which address a screen should preselect.
 *
 * Checkout used `deliveryAddresses[0]` — the first in document order, which is
 * the order they were typed in, and has nothing to do with which one the shop
 * marked. A pharmacy whose default is their second branch was offered the first
 * one every time and had to notice.
 */
export function defaultAddress<T extends { isDefault?: boolean }>(
  addresses: readonly T[],
): T | undefined {
  return addresses.find((address) => address.isDefault) ?? addresses[0];
}

/** One line, for a picker or a summary row. */
export function oneLine(address: DeliveryAddress): string {
  return [address.line1, address.line2, address.city, address.district]
    .filter((part) => part && String(part).trim())
    .join(', ');
}

type Envelope<T> = { data: T };

export async function getMyAddresses(): Promise<DeliveryAddress[]> {
  const response =
    await apiClient.get<Envelope<Array<{ deliveryAddresses?: DeliveryAddress[] }>>>('/shops/my');
  return response.data.data[0]?.deliveryAddresses ?? [];
}

export async function addAddress(draft: AddressDraft, isDefault: boolean) {
  const response = await apiClient.post<Envelope<DeliveryAddress[]>>('/shops/my/addresses', {
    ...addressBody(draft),
    isDefault,
  });
  return response.data.data;
}

export async function editAddress(id: string, draft: AddressDraft) {
  const response = await apiClient.patch<Envelope<DeliveryAddress[]>>(
    `/shops/my/addresses/${id}`,
    addressBody(draft),
  );
  return response.data.data;
}

export async function makeDefaultAddress(id: string) {
  const response = await apiClient.patch<Envelope<DeliveryAddress[]>>(`/shops/my/addresses/${id}`, {
    isDefault: true,
  });
  return response.data.data;
}

export async function deleteAddress(id: string) {
  const response = await apiClient.delete<Envelope<DeliveryAddress[]>>(`/shops/my/addresses/${id}`);
  return response.data.data;
}
