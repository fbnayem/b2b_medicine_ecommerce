import { describe, expect, it, vi } from 'vitest';
import { LANGUAGES } from '@medsupply/i18n';
import { ContentLanguage, SafetyAdviceTag } from '@medsupply/shared-types';

/*
 * `content.ts` reaches the API client, which reaches `react-native` — whose
 * source is Flow-typed and which this runner cannot parse. Mocked so the pure
 * part can be tested on a workstation, exactly as `orders/quote.test.ts` does.
 */
vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() }, baseURL: '' }));

const {
  BODY_PREVIEW,
  BODY_SHOWN_WHOLE,
  SAFETY_TONE,
  bodyPreview,
  contentLanguageFor,
  shownInFallback,
} = await import('./content');

/**
 * The decisions behind the monograph on the medicine screen.
 *
 * None of this is rendering: which language is asked for, when a passage is
 * folded, and what a safety verdict looks like are all choices a screen would
 * otherwise make silently — and a silent choice about "unsafe in pregnancy"
 * is the one this screen cannot afford to get wrong.
 */

describe('which language the catalogue is asked for', () => {
  it('asks for Bangla when the screen is in Bangla', () => {
    expect(contentLanguageFor('bn')).toBe(ContentLanguage.BN);
    expect(contentLanguageFor('en')).toBe(ContentLanguage.EN);
  });

  it('answers something the supplier ships for every language the UI can be in', () => {
    // A third UI language added to `@medsupply/i18n` must still map to a
    // content language the server recognises, not pass through as itself.
    const shipped = new Set<string>(Object.values(ContentLanguage));
    for (const language of LANGUAGES) {
      expect(shipped.has(contentLanguageFor(language)), language).toBe(true);
    }
  });
});

describe('saying when the copy is a stand-in', () => {
  it('notices English answering a Bangla request', () => {
    expect(shownInFallback({ lang: ContentLanguage.EN, requested: ContentLanguage.BN })).toBe(true);
  });

  it('stays quiet when the language asked for is the language served', () => {
    expect(shownInFallback({ lang: ContentLanguage.BN, requested: ContentLanguage.BN })).toBe(
      false,
    );
    expect(shownInFallback({ lang: ContentLanguage.EN, requested: ContentLanguage.EN })).toBe(
      false,
    );
  });
});

describe('the colour behind a safety verdict', () => {
  it('gives every verdict a tone, so a new tag cannot arrive colourless', () => {
    for (const tag of Object.values(SafetyAdviceTag)) {
      expect(SAFETY_TONE[tag], tag).toBeTruthy();
    }
  });

  it('keeps the verdicts a pharmacist acts on apart', () => {
    expect(SAFETY_TONE[SafetyAdviceTag.UNSAFE]).toBe('danger');
    expect(SAFETY_TONE[SafetyAdviceTag.CAUTION]).toBe('warning');
    expect(SAFETY_TONE[SafetyAdviceTag.SAFE]).toBe('success');
    // A condition, not a celebration: the same green as an unconditional
    // "safe" would flatten the distinction the supplier drew.
    expect(SAFETY_TONE[SafetyAdviceTag.SAFE_IF_PRESCRIBED]).toBe('info');
  });
});

describe('folding a long body', () => {
  /*
   * Six-letter words on purpose. The first draft used four-letter ones, whose
   * five-character period divides the preview limit exactly — so a planted
   * cut-anywhere defect landed on a word boundary by arithmetic accident and
   * the test stayed green. A period of seven cannot divide 320, so a cut that
   * ignores boundaries must land mid-word and be seen.
   */
  const words = (count: number) => Array.from({ length: count }, () => 'letter').join(' ');

  it('leaves a body that fits alone, offering no control', () => {
    expect(bodyPreview('Take with a full glass of water.')).toBeNull();
    // The boundary itself is shown whole — folding starts strictly beyond it.
    expect(bodyPreview('x'.repeat(BODY_SHOWN_WHOLE))).toBeNull();
  });

  it('cuts a long body at a word, not through one', () => {
    const body = words(200);
    const preview = bodyPreview(body);
    expect(preview).not.toBeNull();
    expect(preview!.endsWith('…')).toBe(true);

    const shown = preview!.slice(0, -1);
    expect(shown.length).toBeLessThanOrEqual(BODY_PREVIEW);
    // The preview is a prefix of the body and the next character is the space
    // it was cut at — an ellipsis mid-word reads as a rendering fault.
    expect(body.startsWith(shown)).toBe(true);
    expect(body[shown.length]).toBe(' ');
  });

  it('never folds only to reveal a mouthful', () => {
    // One character over the limit: the gap between the two thresholds is the
    // guarantee that "Show more" always uncovers a real amount of text.
    const body = words(200).slice(0, BODY_SHOWN_WHOLE + 1);
    const preview = bodyPreview(body);
    expect(preview).not.toBeNull();
    expect(body.length - preview!.slice(0, -1).length).toBeGreaterThanOrEqual(
      BODY_SHOWN_WHOLE - BODY_PREVIEW,
    );
  });

  it('still cuts a body with nowhere to break', () => {
    // An unbroken token — a long URL — must not be folded to almost nothing
    // because the only space sits near the start.
    const preview = bodyPreview(`a ${'x'.repeat(600)}`);
    expect(preview).not.toBeNull();
    expect(preview!.length).toBe(BODY_PREVIEW + 1);
    expect(preview!.endsWith('…')).toBe(true);
  });
});
