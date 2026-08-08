import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  ContentLanguage,
  MedicineClassification,
  MedicineContentGroup,
  SafetyAdviceTag,
  SafetyAdviceType,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { Medicine } from '../models/Medicine';
import { MedicineContent } from '../models/MedicineContent';
import { User } from '../models/User';
import { searchContent } from '../services/medicineContentService';

/**
 * The monograph, and the ways a monograph quietly goes wrong.
 *
 * The supplier publishes sections in whatever order their export interleaved;
 * the display order is ours, and it is fixed — brief facts open, the safety
 * panel is never buried under merchandising copy. The previous import also cut
 * every description at 2,000 characters, which removed the middle of
 * monographs with nobody watching; the longest legitimate body in the bundle
 * is 29,431 characters, so "not truncated" is a claim worth a fixture longer
 * than the old cap.
 *
 * Language is the other quiet failure. 26,896 products carry English copy and
 * only 24,554 carry Bengali, so a Bangla-first pharmacy that asks for `bn` on
 * one product in eleven must receive the English sibling — marked as such —
 * rather than a blank page. And safety advice is a verdict with a type and a
 * tag, not a paragraph a screen would have to parse to colour a panel.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };

/** Ciprofloxacin — a drug whose indication genuinely names a condition. */
const ciprocin = new Types.ObjectId();
/** English copy only. The fallback exists for this product's 2,342 real peers. */
const gastro = new Types.ObjectId();
/** No copy in any language, which is true of every hand-entered medicine. */
const plain = new Types.ObjectId();

/*
 * Longer than the old 2,000-character cap on purpose: an equality assertion on
 * a body this size fails on the first character the serving path drops, and
 * the length guard inside the test keeps the fixture honest if someone trims
 * the sentence.
 */
const LONG_BODY = (
  'Ciprofloxacin is a broad-spectrum fluoroquinolone antibacterial; the full ' +
  'pharmacology section of a monograph runs to pages, and the previous import ' +
  'kept only the first two thousand characters of it. '
).repeat(16);

const BN_BRIEF = 'সিপ্রোসিন একটি ব্রড-স্পেকট্রাম অ্যান্টিবায়োটিক ট্যাবলেট।';

function headers(user: { _id: Types.ObjectId }) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET!)}`,
  };
}

interface Section {
  title?: string;
  body: string;
  safety?: { type?: string; tag?: string };
}

interface Group {
  group: string;
  sections: Section[];
}

interface Monograph {
  lang: string;
  requested: string;
  groups: Group[];
}

async function content(id: Types.ObjectId, lang?: string) {
  const query = lang ? `?lang=${lang}` : '';
  const response = await fetch(`${base}/api/v1/inventory/medicines/${id}/content${query}`, {
    headers: headers(manager),
  });
  const text = await response.text();
  const body = text.startsWith('{') ? (JSON.parse(text) as { data?: Monograph | null }) : {};
  return { status: response.status, data: body.data };
}

const groupOf = (monograph: Monograph | null | undefined, group: string) =>
  monograph?.groups.find((candidate) => candidate.group === group);

function line(_id: Types.ObjectId, brandName: string): Record<string, unknown> {
  const slug = brandName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    _id,
    reference: `MED-CNT-${slug.slice(0, 8)}`,
    sku: `CNT-${slug.slice(0, 12)}`,
    brandName,
    manufacturer: 'A Manufacturer',
    packSize: '10s',
    unit: 'box',
    category: 'Antibiotic',
    classification: MedicineClassification.OTC,
    costPriceMinor: 800,
    defaultSellingPriceMinor: 1000,
    mrpMinor: 1200,
    isActive: true,
    createdBy: manager._id,
  };
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_content'));
  await mongoose.connection.dropDatabase();
  // `MedicineContent.init()` builds the text index the search below depends on.
  await Promise.all([Medicine.init(), MedicineContent.init(), User.init()]);

  await User.create({
    _id: manager._id,
    email: 'content-manager@test.local',
    passwordHash: 'x',
    firstName: 'Branch',
    lastName: 'Manager',
    role: manager.role,
    status: UserStatus.ACTIVE,
  });

  await Medicine.create([
    line(ciprocin, 'Ciprocin'),
    line(gastro, 'Gastrocare'),
    line(plain, 'Plain Syrup'),
  ]);

  /*
   * `position` is the supplier's publication order: the safety panel first,
   * the prose after — deliberately nothing like the display order, so the
   * ordering assertions below cannot pass by coincidence. The array itself is
   * stored shuffled against `position`, so "sections keep their order" can
   * only pass if something actually sorts by the stored ordinal rather than
   * trusting whatever order the array happened to arrive in.
   */
  await MedicineContent.create([
    {
      medicineId: ciprocin,
      lang: ContentLanguage.EN,
      sections: [
        {
          group: MedicineContentGroup.QUICK_TIP,
          body: 'Complete the full course even after the fever settles.',
          position: 5,
        },
        {
          group: MedicineContentGroup.SAFETY,
          title: 'Pregnancy',
          body: 'Consult a physician before use during pregnancy.',
          position: 0,
          safety: { type: SafetyAdviceType.PREGNANCY, tag: SafetyAdviceTag.SAFE_IF_PRESCRIBED },
        },
        {
          group: MedicineContentGroup.OVERVIEW,
          title: 'Indications',
          body: 'Indicated for typhoid fever, urinary tract infection and enteric infections.',
          position: 3,
        },
        {
          group: MedicineContentGroup.FEATURE,
          title: 'Key Features',
          body: 'Blister of 10 tablets.',
          position: 7,
        },
        {
          group: MedicineContentGroup.BRIEF,
          title: 'Ciprocin 500 mg',
          body: 'A broad-spectrum antibiotic tablet.',
          position: 2,
        },
        { group: MedicineContentGroup.BODY, body: LONG_BODY, position: 6 },
        {
          group: MedicineContentGroup.SAFETY,
          title: 'Alcohol',
          body: 'Avoid alcohol while on this course.',
          position: 1,
          safety: { type: SafetyAdviceType.ALCOHOL, tag: SafetyAdviceTag.UNSAFE },
        },
        {
          group: MedicineContentGroup.QUICK_TIP,
          body: 'Take with a full glass of water.',
          position: 4,
        },
      ],
    },
    {
      medicineId: ciprocin,
      lang: ContentLanguage.BN,
      sections: [
        {
          group: MedicineContentGroup.BRIEF,
          title: 'সিপ্রোসিন 500 মি.গ্রা.',
          body: BN_BRIEF,
          position: 0,
        },
        {
          group: MedicineContentGroup.OVERVIEW,
          title: 'নির্দেশনা',
          // The Latin term rides along, as it does in the real Bengali copy —
          // and it is what makes the search dedupe assertion below sharp.
          body: 'টাইফয়েড জ্বর (typhoid fever) ও মূত্রনালির সংক্রমণে নির্দেশিত।',
          position: 1,
        },
      ],
    },
    {
      medicineId: gastro,
      lang: ContentLanguage.EN,
      sections: [
        { group: MedicineContentGroup.BRIEF, body: 'An antacid suspension.', position: 0 },
        {
          group: MedicineContentGroup.OVERVIEW,
          title: 'Indications',
          body: 'Indicated for heartburn and acid reflux.',
          position: 1,
        },
      ],
    },
  ]);

  await new Promise<void>((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => {
      const address = running.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server = running;
  });
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

test('the monograph arrives grouped, in the display order, not the publication order', async () => {
  const { status, data } = await content(ciprocin);
  assert.equal(status, 200);
  assert.ok(data, 'a product with copy must answer with a monograph');
  // The fixture publishes the safety panel first. The screen must not.
  assert.deepEqual(
    data.groups.map((group) => group.group),
    ['BRIEF', 'OVERVIEW', 'QUICK_TIP', 'SAFETY', 'BODY', 'FEATURE'],
    'the running order is the product decision, whatever order the supplier published in',
  );
});

test('sections within a group keep the supplier order, not the storage order', async () => {
  const { data } = await content(ciprocin);
  // Stored with the second tip physically first in the array; `position` is
  // the only thing that knows which one the supplier said first.
  assert.deepEqual(
    groupOf(data, 'QUICK_TIP')!.sections.map((section) => section.body),
    ['Take with a full glass of water.', 'Complete the full course even after the fever settles.'],
    'within a group, the stored ordinal decides the order — the array must not',
  );
});

test('a product with Bangla copy answers in Bangla when asked', async () => {
  const { status, data } = await content(ciprocin, 'bn');
  assert.equal(status, 200);
  assert.ok(data);
  assert.equal(data.lang, 'bn');
  assert.equal(data.requested, 'bn');
  assert.equal(groupOf(data, 'BRIEF')!.sections[0]!.body, BN_BRIEF);
});

/*
 * 24,554 of 26,896 monographs carry Bengali. The other 2,342 are real products
 * a Bangla-first pharmacy will open, and before the fallback each of them was
 * a blank page. `requested` travels with the answer so the screen can say
 * "only available in English" instead of pretending nothing happened.
 */
test('a product without Bangla falls back to English rather than to nothing', async () => {
  const { status, data } = await content(gastro, 'bn');
  assert.equal(status, 200);
  assert.ok(data, 'a missing translation is a fallback, never a blank page');
  assert.equal(data.lang, 'en', 'the English sibling is what there is');
  assert.equal(data.requested, 'bn', 'the answer must admit which language was asked for');
  assert.ok(data.groups.length > 0);
});

test('safety advice is a verdict with fields, not a paragraph to parse', async () => {
  const { data } = await content(ciprocin);
  const safety = groupOf(data, 'SAFETY')!;
  // A screen colours the pregnancy panel from `tag`; if the verdict only
  // existed inside prose, every client would grow its own regex to find it.
  assert.deepEqual(safety.sections[0]!.safety, {
    type: SafetyAdviceType.PREGNANCY,
    tag: SafetyAdviceTag.SAFE_IF_PRESCRIBED,
  });
  assert.deepEqual(safety.sections[1]!.safety, {
    type: SafetyAdviceType.ALCOHOL,
    tag: SafetyAdviceTag.UNSAFE,
  });
  // And only safety rows carry one — an empty verdict on every paragraph would
  // make every screen re-check what the service already knows.
  assert.ok(
    !('safety' in groupOf(data, 'BRIEF')!.sections[0]!),
    'a non-safety section must not carry an empty verdict object',
  );
});

test('a monograph body is never cut at two thousand characters', async () => {
  // Guard the fixture first: if this shrinks below the old cap, the assertion
  // below stops testing anything.
  assert.ok(LONG_BODY.length > 2000, 'fixture must be longer than the cap it disproves');
  const { data } = await content(ciprocin);
  assert.equal(
    groupOf(data, 'BODY')!.sections[0]!.body,
    LONG_BODY,
    'the previous import cut bodies at 2,000 characters; every character must survive',
  );
});

/*
 * What a drug treats lives in its monograph, not on its catalogue row —
 * `Ciprocin` says nothing about typhoid, its indication section does. The
 * catalogue's own text index (brand, generic, manufacturer, SKU) structurally
 * cannot answer this question.
 */
test('search over the copy finds a medicine by its indication, not its name', async () => {
  const found = await searchContent('typhoid');
  const hits = found.filter((id) => id.equals(ciprocin));
  assert.equal(hits.length, 1, 'both language documents match — the medicine must appear once');
  assert.ok(
    !found.some((id) => id.equals(gastro)),
    'an antacid does not treat typhoid and must not be found for it',
  );
});

test('a medicine with no copy answers null, not an error', async () => {
  const { status, data } = await content(plain);
  assert.equal(status, 200, 'the medicine exists; having no monograph is a fact about it');
  assert.equal(data, null);
});

/*
 * The service above was written, indexed and tested for a whole phase without
 * a single route calling it, so `typhoid` still returned an empty catalogue on
 * every client. These four tests are about the wiring rather than the search:
 * that the fallback fires when the catalogue matched nothing, that it does not
 * fire when the catalogue matched something, that the result says which
 * question was answered, and that a page of it is still a page.
 */
async function listMedicines(query: string) {
  const response = await fetch(`${base}/api/v1/inventory/medicines?${query}`, {
    headers: headers(manager),
  });
  const body = (await response.json()) as {
    data: { _id: string; brandName: string }[];
    meta: { total: number; page: number; pages: number; matchedIn?: string };
  };
  return { status: response.status, ...body };
}

test('a term that names no product falls back to the product information', async () => {
  const { status, data, meta } = await listMedicines('search=typhoid');
  assert.equal(status, 200);
  assert.equal(
    meta.matchedIn,
    'productInformation',
    'nothing is called "typhoid", so the only honest answer comes from the monograph',
  );
  assert.deepEqual(
    data.map((row) => row.brandName),
    ['Ciprocin'],
    'the indication section names typhoid; the antacid and the plain syrup do not',
  );
  assert.equal(
    meta.total,
    1,
    'the total must count the fallback result, not the empty name search',
  );
});

test('a term that does name a product never reaches the monograph', async () => {
  const { data, meta } = await listMedicines('search=Gastrocare');
  assert.equal(
    meta.matchedIn,
    'name',
    'the catalogue answered, so the 451–1,568 ms monograph search must not run',
  );
  assert.deepEqual(
    data.map((row) => row.brandName),
    ['Gastrocare'],
  );
});

test('a term nothing knows about stays empty rather than inventing a fallback', async () => {
  const { data, meta } = await listMedicines('search=zzzznotathing');
  assert.deepEqual(data, []);
  assert.equal(meta.total, 0);
  assert.equal(
    meta.matchedIn,
    'name',
    'the fallback found nothing either, so the answer is still about the name — ' +
      'claiming otherwise would blame the monograph for an empty screen',
  );
});

test('a list with no search term carries no matchedIn at all', async () => {
  const { meta } = await listMedicines('limit=2');
  assert.equal(
    meta.matchedIn,
    undefined,
    'browsing is not searching; a permanent "matched by name" would be noise',
  );
});
