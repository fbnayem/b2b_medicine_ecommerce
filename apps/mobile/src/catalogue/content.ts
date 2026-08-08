import type { Language } from '@medsupply/i18n';
import {
  ContentLanguage,
  SafetyAdviceTag,
  type MedicineContentGroup,
  type SafetyAdviceType,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import type { BadgeTone } from '../components';

/**
 * The supplier's product copy, as the medicine screen reads it.
 *
 * Everything the screen must *decide* about the monograph lives here — which
 * language to ask for, what a safety verdict looks like, when a passage is long
 * enough to fold — so the component is left with rendering and the decisions
 * can be tested without mounting anything.
 */

/**
 * One titled passage. `safety` is present on rows of the safety panel only:
 * which question the row answers and the supplier's verdict on it.
 */
export interface MonographSection {
  title?: string;
  body: string;
  safety?: { type?: SafetyAdviceType; tag?: SafetyAdviceTag };
}

export interface MonographGroup {
  group: MedicineContentGroup;
  /** In the supplier's publication order within the group. */
  sections: MonographSection[];
}

/**
 * What `GET /inventory/medicines/{id}/content` answers.
 *
 * Deliberately not the `MedicineContent` interface in `@medsupply/shared-types`:
 * that is the *stored* shape — one flat run of sections per language — and this
 * is the *served* one, already bucketed by group with the groups in display
 * order. The reshaping is `medicineContentService.ts` on the API, and this type
 * mirrors its `Monograph` with one wire difference: `scrapedAt` arrives as the
 * string JSON makes of a date.
 */
export interface Monograph {
  /** The language actually returned — not necessarily the one asked for. */
  lang: ContentLanguage;
  /** What was asked for, so a Bangla screen given English can say so. */
  requested: ContentLanguage;
  groups: MonographGroup[];
  /** Which export the copy came from, and when it was scraped. */
  source?: { name?: string; scrapedAt?: string };
}

/**
 * The monograph for one medicine, or `null` when the product has no copy in
 * any language — true of every hand-entered medicine, and an answer rather
 * than an error.
 *
 * Writes its own literal path, as `documents/files.ts` and `delivery/actions.ts`
 * do and for the same reason: `api/callers.test.ts` reads the HTTP method
 * sitting immediately before a path *literal*, and a path assembled from a
 * variable would quietly exempt this endpoint from the one gate that notices
 * when a capability loses its caller.
 */
export async function getMedicineContent(
  id: string,
  lang: ContentLanguage,
): Promise<Monograph | null> {
  const response = await apiClient.get<{ data: Monograph | null }>(
    `/inventory/medicines/${id}/content`,
    { params: { lang } },
  );
  return response.data.data;
}

/**
 * Which language to ask the catalogue for, given the language the screen is in.
 *
 * The UI language and the content language are two decisions, not one — the
 * supplier ships copy in exactly English and Bengali, while the application's
 * own languages may grow. Mapping by name rather than passing the UI language
 * through means a third UI language later still asks for something the
 * supplier can answer, instead of sending a code the server reads as English
 * by accident.
 */
export function contentLanguageFor(language: Language): ContentLanguage {
  return language === 'bn' ? ContentLanguage.BN : ContentLanguage.EN;
}

/**
 * Whether the copy on screen is a stand-in for the language that was asked for.
 * The server falls back to English rather than answering a blank page — one
 * Bengali product in eleven has no Bengali copy — and the screen's half of that
 * bargain is to say it happened rather than present English as if nothing did.
 */
export function shownInFallback(content: Pick<Monograph, 'lang' | 'requested'>): boolean {
  return content.lang !== content.requested;
}

/**
 * The colour behind each safety verdict.
 *
 * Colour is the *second* channel, never the only one: the badge always carries
 * the verdict's words from the catalogue, so the difference between "safe" and
 * "unsafe" survives a monochrome screen and a screen reader. The same split as
 * `components/Status.tsx` — colour lives in a `Record`, words live in i18n —
 * and the `Record` is what makes a new tag in `@medsupply/shared-types` a
 * compile error here until it has a colour.
 *
 * SAFE_IF_PRESCRIBED is `info`, not `success`: it is a condition, and painting
 * it the same green as an unconditional "safe" would flatten exactly the
 * distinction the supplier bothered to draw.
 *
 * CONSULT_YOUR_DOCTOR shares `warning` with CAUTION because both mean "do not
 * hand this over on your own judgement", and the badge's own words — "Ask your
 * doctor" against "Use with caution" — carry the difference. It is also the
 * commonest verdict in the catalogue at 56,447 rows, so it is the one this map
 * could least afford to be missing: it went in late, after the enum was
 * widened, and until it did every one of those badges rendered tone-less.
 *
 * Kept identical to the web map in `MedicineDetail.tsx`. A shop owner who uses
 * both should not learn two colour languages for one fact.
 */
export const SAFETY_TONE: Record<SafetyAdviceTag, BadgeTone> = {
  [SafetyAdviceTag.SAFE]: 'success',
  [SafetyAdviceTag.SAFE_IF_PRESCRIBED]: 'info',
  [SafetyAdviceTag.CONSULT_YOUR_DOCTOR]: 'warning',
  [SafetyAdviceTag.CAUTION]: 'warning',
  [SafetyAdviceTag.UNSAFE]: 'danger',
  [SafetyAdviceTag.NOT_RELEVANT]: 'neutral',
};

/**
 * A body at most this long is shown whole. Monograph passages run to 29,431
 * characters — the longest legitimate body in the bundle — and a phone screen
 * showing forty of them uncollapsed buries the safety panel, the alternatives
 * and the order button under a wall of prose.
 */
export const BODY_SHOWN_WHOLE = 400;

/** Where a folded body is cut. */
export const BODY_PREVIEW = 320;

/**
 * The folded form of a long body, or `null` when the body should be shown
 * whole and no control offered.
 *
 * The gap between `BODY_SHOWN_WHOLE` and `BODY_PREVIEW` is deliberate: it
 * guarantees "Show more" always reveals a real amount of text. Folding a
 * 330-character body down to 320 would put a button on screen that reveals ten
 * characters, which is a control that does nothing worth pressing.
 *
 * Cut at a word boundary, because an ellipsis mid-word reads as a rendering
 * fault. The boundary search gives up below half the preview — a body that is
 * one unbroken token, a long URL for instance, is cut cleanly at the limit
 * rather than folded to almost nothing.
 */
export function bodyPreview(body: string): string | null {
  if (body.length <= BODY_SHOWN_WHOLE) return null;
  const breakAt = body.lastIndexOf(' ', BODY_PREVIEW);
  const cut = breakAt > BODY_PREVIEW / 2 ? breakAt : BODY_PREVIEW;
  return `${body.slice(0, cut).trimEnd()}…`;
}
