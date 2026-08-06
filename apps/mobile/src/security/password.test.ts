import { describe, expect, it, vi } from 'vitest';
import { catalogueKeys, en } from '@medsupply/i18n';

// `password.ts` reaches the API client, and through it `react-native`, whose
// Flow-typed source esbuild cannot parse. Same mock as `orders/quote.test.ts`.
vi.mock('../api/client', () => ({ apiClient: {}, baseURL: '' }));

const { PASSWORD_MINIMUM, passwordProblem } = await import('./password');

/**
 * The order the problems are reported in is the whole content of this rule.
 *
 * A form that reports the *last* thing wrong sends somebody round a loop: fix
 * the mismatch, be told it is too short, lengthen both, be told it matches the
 * old one. Each of these tests pins one step of that loop shut.
 */

const KNOWN = new Set(catalogueKeys(en));

const draft = (over: Partial<{ current: string; next: string; confirm: string }> = {}) => ({
  current: 'Old-Password-1',
  next: 'New-Password-2',
  confirm: 'New-Password-2',
  ...over,
});

describe('what is wrong with a password change', () => {
  it('accepts a change that is genuinely a change', () => {
    expect(passwordProblem(draft())).toBeNull();
  });

  it('asks for the current password first, because nothing else can be judged without it', () => {
    expect(passwordProblem(draft({ current: '' }))?.field).toBe('current');
  });

  it('reports a short password before a mismatched one', () => {
    /*
     * Both are true of `{ next: 'short', confirm: 'other' }`, and only one is
     * worth acting on: lengthening the password requires retyping the
     * confirmation anyway, so reporting the mismatch first sends somebody round
     * the loop twice.
     */
    expect(passwordProblem(draft({ next: 'short', confirm: 'other' }))?.key).toBe(
      'auth.passwordTooShort',
    );
  });

  it('carries the minimum into the message rather than hard-coding “8” in a sentence', () => {
    // `auth.passwordTooShort` is 'Use at least {{minimum}} characters.' — a
    // number written into the translation would have to be found in two
    // catalogues the day the policy changes.
    const problem = passwordProblem(draft({ next: 'short', confirm: 'short' }));
    expect(problem?.values).toEqual({ minimum: PASSWORD_MINIMUM });
  });

  it('reports reuse before mismatch, matching the server’s own order', () => {
    // The server answers `PASSWORD_UNCHANGED` for this, and being told the same
    // thing by two different messages is how somebody decides one of them is a
    // bug.
    expect(passwordProblem(draft({ next: 'Old-Password-1', confirm: 'Something-Else' }))?.key).toBe(
      'auth.sameAsCurrent',
    );
  });

  it('catches the confirmation last, and names the confirmation field', () => {
    const problem = passwordProblem(draft({ confirm: 'New-Password-3' }));
    expect(problem?.field).toBe('confirm');
    expect(problem?.key).toBe('auth.passwordsDoNotMatch');
  });

  it('holds the same floor the API does', () => {
    /*
     * Eight is `ChangePasswordSchema`'s minimum. A deployment may raise it
     * through `securitySettings().passwordMinLength` and the server enforces
     * that; refusing anything below the floor here only saves a round trip on
     * an obviously-too-short password.
     */
    expect(PASSWORD_MINIMUM).toBe(8);
    expect(passwordProblem(draft({ next: 'a'.repeat(7), confirm: 'a'.repeat(7) }))?.key).toBe(
      'auth.passwordTooShort',
    );
    expect(passwordProblem(draft({ next: 'a'.repeat(8), confirm: 'a'.repeat(8) }))).toBeNull();
  });

  it('does not trim, because a space is a character in a password', () => {
    // Trimming here would accept a password the server then stores untrimmed,
    // and the next sign-in would fail for a reason nobody could see.
    expect(passwordProblem(draft({ next: ' pass 12 ', confirm: ' pass 12 ' }))).toBeNull();
    expect(passwordProblem(draft({ next: ' pass 12 ', confirm: 'pass 12' }))?.field).toBe(
      'confirm',
    );
  });

  it('every key it can return is a key the catalogue holds', () => {
    /*
     * `catalogueKeys.test.ts` finds keys by reading literal `t('…')` call
     * sites, and these reach the screen as `t(problem.key)` — a variable, and
     * therefore invisible to it. Without this they would render as the dotted
     * path `auth.sameAsCurrent` on the one screen somebody uses when they think
     * their account has been compromised.
     */
    const keys = [
      passwordProblem(draft({ current: '' })),
      passwordProblem(draft({ next: 'x', confirm: 'x' })),
      passwordProblem(draft({ next: 'Old-Password-1' })),
      passwordProblem(draft({ confirm: 'different' })),
    ].map((problem) => problem?.key);

    expect(keys.filter(Boolean)).toHaveLength(4);
    expect(keys.filter((key) => key && !KNOWN.has(key))).toEqual([]);
  });
});
