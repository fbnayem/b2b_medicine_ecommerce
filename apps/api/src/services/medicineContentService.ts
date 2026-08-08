import { Types } from 'mongoose';
import {
  ContentLanguage,
  MedicineContentGroup,
  SafetyAdviceTag,
  SafetyAdviceType,
} from '@medsupply/shared-types';
import { MedicineContent } from '../models/MedicineContent';

/**
 * The supplier's product copy, served the way a screen reads it.
 *
 * The collection stores one document per (medicine, language) with sections in
 * the supplier's publication order — the shape the importer writes and the
 * unique index finds. A screen wants something slightly different: the passages
 * bucketed by group, the groups in a fixed running order, and an answer even
 * when the language it asked for was never shipped. That reshaping is this
 * service, so neither the model nor the controller has to know about it.
 */

/**
 * The order the groups are shown in, which is the product's decision and not
 * the supplier's. Stored order is whatever the export happened to interleave;
 * the display contract is that the brief facts open, the prose follows, the
 * safety panel is never buried below merchandising copy, and `BODY` and
 * `FEATURE` — the non-drug description and the "Key Features" sales copy —
 * close. Groups a product does not carry are simply absent, not empty.
 */
const DISPLAY_ORDER: MedicineContentGroup[] = [
  MedicineContentGroup.BRIEF,
  MedicineContentGroup.OVERVIEW,
  MedicineContentGroup.QUICK_TIP,
  MedicineContentGroup.SAFETY,
  MedicineContentGroup.BODY,
  MedicineContentGroup.FEATURE,
];

export interface MonographSection {
  /** The supplier's own heading. Absent where a group is a single passage. */
  title?: string;
  body: string;
  /** `SAFETY` sections only: which question this answers, and their verdict. */
  safety?: { type?: SafetyAdviceType; tag?: SafetyAdviceTag };
}

export interface MonographGroup {
  group: MedicineContentGroup;
  /** In the supplier's publication order within the group. */
  sections: MonographSection[];
}

export interface Monograph {
  /** The language actually being returned — not necessarily the one asked for. */
  lang: ContentLanguage;
  /**
   * What the caller asked for. Carried so a Bangla screen that received English
   * can say "only available in English" instead of presenting the fallback as
   * if nothing happened — the missing sibling is a fact to state, not to hide.
   */
  requested: ContentLanguage;
  groups: MonographGroup[];
  /** Which export this copy came from, and when it was scraped. */
  source?: { name?: string; scrapedAt?: Date };
}

/** The shape `MedicineContent.find().lean()` yields, as this service reads it. */
interface StoredSection {
  group: MedicineContentGroup;
  title?: string;
  body: string;
  position: number;
  safety?: { type?: SafetyAdviceType; tag?: SafetyAdviceTag };
}

/**
 * The monograph for one product in one language.
 *
 * Falls back to English when the requested language has no document. That is
 * not a theoretical courtesy: 26,896 products carry English copy and only
 * 24,554 carry Bengali, so a Bangla-first pharmacy would otherwise open a
 * blank page on one product in eleven. Both languages are fetched in the one
 * query — the unique index on `(medicineId, lang)` serves an `$in` over two
 * languages as cheaply as two point reads, without the second round trip.
 *
 * `null` means the product has no copy in any language, which is true of every
 * hand-entered medicine and is an answer, not an error.
 */
export async function contentFor(
  medicineId: Types.ObjectId | string,
  lang: ContentLanguage,
): Promise<Monograph | null> {
  const languages = lang === ContentLanguage.EN ? [ContentLanguage.EN] : [lang, ContentLanguage.EN];
  const documents = await MedicineContent.find({ medicineId, lang: { $in: languages } }).lean();

  const document =
    documents.find((candidate) => candidate.lang === lang) ??
    documents.find((candidate) => candidate.lang === ContentLanguage.EN);
  if (!document) return null;

  /*
   * Sorted by the stored ordinal rather than trusted to array order: the array
   * does arrive in publication order today, but `position` exists precisely so
   * that ordering survives anything that filters or regroups the sections —
   * which is what happens next.
   */
  const ordered = ([...document.sections] as StoredSection[]).sort(
    (left, right) => left.position - right.position,
  );

  const byGroup = new Map<MedicineContentGroup, MonographSection[]>();
  for (const section of ordered) {
    const sections = byGroup.get(section.group) ?? [];
    if (!byGroup.has(section.group)) byGroup.set(section.group, sections);
    sections.push({
      ...(section.title ? { title: section.title } : {}),
      body: section.body,
      // Mongoose materialises the empty `safety` sub-object on non-safety
      // rows; an empty object is not a verdict, so it is dropped rather than
      // passed on for every screen to re-check.
      ...(section.safety?.type || section.safety?.tag ? { safety: section.safety } : {}),
    });
  }

  // Rebuilt field by field rather than spread: the lean document's optional
  // paths are `null`-able the way Mongoose types them, and a `null` name is
  // not provenance worth passing on.
  const source = {
    ...(document.source?.name ? { name: document.source.name } : {}),
    ...(document.source?.scrapedAt ? { scrapedAt: document.source.scrapedAt } : {}),
  };

  return {
    lang: document.lang as ContentLanguage,
    requested: lang,
    groups: DISPLAY_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
      group,
      sections: byGroup.get(group)!,
    })),
    ...(Object.keys(source).length ? { source } : {}),
  };
}

/**
 * The medicines whose copy mentions a term.
 *
 * What a drug treats lives in the monograph passages, not on the `Medicine`
 * row, so the catalogue's own text index cannot answer "typhoid" — this one
 * can, via the text index `MedicineContent` declares over section bodies and
 * titles. A real `$text` match rather than a regex: the index is the only
 * thing that makes searching 236 MB of prose answerable per keystroke, and
 * `$text` gets stemming and phrase quoting with it.
 *
 * Grouped to the medicine because one product can match twice — its English
 * and Bengali documents are siblings — and twelve slots filled with six
 * products listed in both languages is half an answer. The best-scoring
 * language decides the product's place in the ranking.
 */
export async function searchContent(term: string, limit = 50): Promise<Types.ObjectId[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];

  // Bounded the way the list endpoints bound their pages, so a caller cannot
  // ask the database to rank the entire catalogue in one request.
  const cap = Math.min(200, Math.max(1, Math.floor(limit)));

  const rows = (await MedicineContent.aggregate([
    { $match: { $text: { $search: trimmed } } },
    // `$meta` is only addressable in a stage of its own; `$group` cannot read
    // it directly inside an accumulator.
    { $set: { score: { $meta: 'textScore' } } },
    { $group: { _id: '$medicineId', score: { $max: '$score' } } },
    { $sort: { score: -1, _id: 1 } },
    { $limit: cap },
  ])) as { _id: Types.ObjectId }[];

  return rows.map((row) => row._id);
}
