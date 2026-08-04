import { describe, expect, it } from 'vitest';
import {
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
  ReturnStatus,
  ShopStatus,
  UserRole,
} from '@medsupply/shared-types';
import { LANGUAGES, bn, catalogueKeys, en, interpolate, resolveLanguage } from '@medsupply/i18n';
import { apiFailure, errorMessage } from '@medsupply/api-client';

/**
 * The catalogue's own guarantees, and the ones the type system cannot make.
 *
 * `bn` is typed `Catalogue`, so a missing or extra key is already a compile
 * error. What TypeScript cannot check is whether anybody actually *translated*
 * a value, or whether a status enum grew a member that both catalogues then
 * spelled out — so those are here.
 */

describe('the Bangla catalogue', () => {
  it('has exactly the keys English has', () => {
    // Belt and braces: the type enforces this, and this catches the case where
    // somebody widens the type to make a build pass.
    expect(catalogueKeys(bn).sort()).toEqual(catalogueKeys(en).sort());
  });

  it('actually translates the words a user reads', () => {
    // A Bangla catalogue that is a copy of the English one type-checks
    // perfectly and helps nobody. Proper nouns and the app name legitimately
    // stay the same; nothing else should.
    /*
     * A string with no letters in it has nothing to translate. `1–30`, `90+`
     * and `—` are the same in every language, and listing each one by hand
     * would turn a real rule into a growing list of exceptions nobody reads.
     * Anything carrying a letter still has to be translated or waived below.
     */
    const hasLetters = (value: string) => /\p{L}/u.test(value);

    const untranslated = catalogueKeys(en).filter((path) => {
      const read = (catalogue: object) =>
        path.split('.').reduce<unknown>((node, key) => (node as never)?.[key], catalogue);
      const english = read(en);
      const bangla = read(bn);
      return typeof english === 'string' && english === bangla && hasLetters(english);
    });

    expect(untranslated, `these are still in English: ${untranslated.join(', ')}`).toEqual([
      'common.appName',
      // A worked example of a document reference. References are ASCII with
      // Western digits by rule — `AGENTS.md` fixes the `RET-2026-000001` shape
      // — so translating this placeholder would show somebody a pattern they
      // will never see on a real document.
      'returns.referenceHint',
      'delivery.searchHint',
      // A paper size and a file format. Neither is a word in either language,
      // and a storekeeper looking for the A4 button is looking for "A4".
      'picking.a4Pdf',
    ]);
  });

  it('leaves numbers in Western digits', () => {
    // Deliberate: money here is reconciled against printed invoices, bank slips
    // and bKash messages, all in Western digits, and both money parsers accept
    // only [0-9] — so Bengali display without Bengali input would give a form
    // that refuses what it just showed you.
    const bengaliDigits = /[০-৯]/;
    const offenders = catalogueKeys(bn).filter((path) => {
      const value = path.split('.').reduce<unknown>((node, key) => (node as never)?.[key], bn);
      return typeof value === 'string' && bengaliDigits.test(value);
    });
    expect(offenders).toEqual([]);
  });
});

describe('status wording', () => {
  const cases: Array<[string, Record<string, string>, readonly string[]]> = [
    ['order', en.orderStatus, Object.values(OrderStatus)],
    ['delivery', en.deliveryStatus, Object.values(DeliveryStatus)],
    ['payment', en.paymentStatus, Object.values(PaymentStatus)],
    ['return', en.returnStatus, Object.values(ReturnStatus)],
    ['shop', en.shopStatus, Object.values(ShopStatus)],
    ['role', en.roles, Object.values(UserRole)],
  ];

  for (const [name, map, members] of cases) {
    it(`covers every ${name} value in both languages`, () => {
      for (const member of members) {
        expect(map[member], `English is missing ${member}`).toBeTruthy();
      }
    });
  }

  it('never shouts an enum at the reader', () => {
    // Statuses were rendered by about forty ad-hoc `replaceAll('_', ' ')` calls,
    // producing SHOUTING text like "READY FOR DELIVERY" with the casing
    // differing between pages.
    for (const map of [en.orderStatus, en.deliveryStatus, en.paymentStatus, en.returnStatus]) {
      for (const label of Object.values(map)) {
        expect(label, `"${label}" looks like a raw enum`).not.toMatch(/^[A-Z_]+$/);
        expect(label).not.toContain('_');
      }
    }
  });

  it('uses no jargon a shop owner would have to look up', () => {
    const jargon = /\b(FEFO|poisha|idempoten\w*|immutable|basis points?|quarantine)\b/i;
    const offenders = catalogueKeys(en).filter((path) => {
      const value = path.split('.').reduce<unknown>((node, key) => (node as never)?.[key], en);
      return typeof value === 'string' && jargon.test(value);
    });
    expect(offenders, `jargon at: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('choosing a language', () => {
  it('prefers the user, then the tenant, then the device', () => {
    expect(resolveLanguage({ chosen: 'bn', tenantDefault: 'en', device: 'en-GB' })).toBe('bn');
    // The tenant beats the device deliberately: this is a business tool on
    // shared terminals, and the operator's choice should beat a handset that
    // came with its language already set.
    expect(resolveLanguage({ tenantDefault: 'bn', device: 'en-GB' })).toBe('bn');
    expect(resolveLanguage({ device: 'bn-BD' })).toBe('bn');
    expect(resolveLanguage({})).toBe('en');
  });

  it('ignores a language it does not have', () => {
    expect(resolveLanguage({ chosen: 'fr', device: 'de-DE' })).toBe('en');
  });

  it('offers every language it can actually serve', () => {
    for (const language of LANGUAGES) {
      expect(catalogueKeys(en).length).toBeGreaterThan(0);
      expect(resolveLanguage({ chosen: language })).toBe(language);
    }
  });
});

describe('interpolation', () => {
  it('substitutes what it has', () => {
    expect(interpolate('Use at least {{minimum}} characters.', { minimum: 12 })).toBe(
      'Use at least 12 characters.',
    );
  });

  it('leaves an unknown placeholder alone rather than writing undefined', () => {
    // "Use at least undefined characters" is how this goes wrong in front of a
    // user, and it is worse than showing the placeholder.
    expect(interpolate('Use at least {{minimum}} characters.')).toBe(
      'Use at least {{minimum}} characters.',
    );
  });
});

describe('reading a failure', () => {
  const serverRefusal = {
    response: {
      status: 409,
      data: {
        error: {
          code: 'CREDIT_LIMIT',
          message: 'Projected exposure exceeds the credit limit',
          correlationId: 'req-123',
        },
      },
    },
  };

  it('turns a server code into something a shop owner can act on', () => {
    // This code was rendered verbatim at a shop owner.
    expect(errorMessage(serverRefusal)).toBe(
      'This order would take the shop past its credit limit.',
    );
    expect(errorMessage(serverRefusal, 'bn')).toContain('বাকির সীমা');
  });

  it('surfaces the correlation identifier the backend has always emitted', () => {
    // Emitted on every failure since phase 12 and reaching no user, so a support
    // call could name the time something failed but never the request.
    expect(apiFailure(serverRefusal).reference).toBe('req-123');
  });

  it('distinguishes not reaching the server from being refused by it', () => {
    expect(apiFailure({ message: 'Network Error' }).code).toBe('NETWORK');
    expect(apiFailure({ code: 'ECONNABORTED', message: 'timeout of 60000ms' }).code).toBe(
      'TIMEOUT',
    );
    expect(errorMessage({ message: 'Network Error' })).toContain('Could not reach the server');
  });

  it('falls back to the server’s own words before giving up entirely', () => {
    const unknown = {
      response: { status: 400, data: { error: { code: 'SOMETHING_NEW', message: 'Be specific' } } },
    };
    expect(errorMessage(unknown)).toBe('Be specific');
  });
});
