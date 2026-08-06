import { apiClient } from '../api/client';

/**
 * Changing your own password, from the phone.
 *
 * `POST /api/v1/auth/change-password` has existed since the security phase and
 * **had no mobile caller**. On the device most likely to be lost, handed over or
 * shoulder-surfed, the only way to change a password was to find a desktop.
 *
 * The words come from the `auth` section of the catalogue — the same keys the
 * web form uses. Two screens doing one job must not have two vocabularies for
 * it: "New password again" and "Confirm password" are the same field, and a
 * person who meets both wonders which one they got wrong.
 */

/** The floor `ChangePasswordSchema` enforces. */
export const PASSWORD_MINIMUM = 8;

/**
 * What is wrong, as a catalogue key and whatever its sentence interpolates.
 *
 * `sameAsCurrent` mirrors the server's `PASSWORD_UNCHANGED`, and it is checked
 * here as well because a round trip to be told you typed the same word twice is
 * a round trip on a shop's connection.
 */
export type PasswordProblem =
  | { field: 'current'; key: 'auth.currentPasswordRequired'; values?: undefined }
  | { field: 'next'; key: 'auth.passwordTooShort'; values: { minimum: number } }
  | { field: 'next'; key: 'auth.sameAsCurrent'; values?: undefined }
  | { field: 'confirm'; key: 'auth.passwordsDoNotMatch'; values?: undefined };

export interface PasswordDraft {
  current: string;
  next: string;
  confirm: string;
}

/**
 * The first problem with a draft, or `null`.
 *
 * Order matters: the confirmation is checked **last**, so somebody who has
 * typed a too-short password twice is told it is too short rather than that it
 * matches — which would be true and useless.
 */
export function passwordProblem(draft: PasswordDraft): PasswordProblem | null {
  if (draft.current.length === 0) {
    return { field: 'current', key: 'auth.currentPasswordRequired' };
  }
  if (draft.next.length < PASSWORD_MINIMUM) {
    return { field: 'next', key: 'auth.passwordTooShort', values: { minimum: PASSWORD_MINIMUM } };
  }
  if (draft.next === draft.current) return { field: 'next', key: 'auth.sameAsCurrent' };
  if (draft.next !== draft.confirm) return { field: 'confirm', key: 'auth.passwordsDoNotMatch' };
  return null;
}

/**
 * How many other sessions the change ended.
 *
 * The server answers with this number and the screen says it out loud, because
 * "you are now signed out on three other devices" is the consequence somebody
 * needs to hear — silently ending a colleague's session reads as a fault.
 */
export async function changePassword(draft: PasswordDraft): Promise<number> {
  const response = await apiClient.post<{ data: { otherSessionsRevoked: number } }>(
    '/auth/change-password',
    { currentPassword: draft.current, newPassword: draft.next },
  );
  return response.data.data.otherSessionsRevoked ?? 0;
}
