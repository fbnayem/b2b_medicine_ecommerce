import { describe, expect, it } from 'vitest';
import { normaliseCollection } from './query';

/**
 * The API answers a list four different ways, and a page must not have to know
 * which one it is talking to.
 *
 * The fourth shape — `{ data: { items, … } }`, which every purchasing endpoint
 * uses — fell through every branch of the original normaliser and produced an
 * empty list with a total of zero. That does not look like a failure: it looks
 * like a working screen with nothing on it, which is the hardest kind of defect
 * to notice and the reason this is tested rather than assumed.
 */

interface Row {
  _id: string;
}

const rows: Row[] = [{ _id: 'a' }, { _id: 'b' }];

describe('normalising a list response', () => {
  it('reads a flat envelope', () => {
    expect(normaliseCollection<Row>({ items: rows, total: 9, page: 2, limit: 2 })).toEqual({
      items: rows,
      total: 9,
      page: 2,
      limit: 2,
    });
  });

  it('reads a bare data array, and counts what it was given', () => {
    expect(normaliseCollection<Row>({ data: rows })).toEqual({
      items: rows,
      total: 2,
      page: 1,
      limit: 2,
    });
  });

  it('reads a data array with its meta beside it', () => {
    expect(
      normaliseCollection<Row>({ data: rows, meta: { total: 40, page: 3, limit: 2 } }),
    ).toEqual({ items: rows, total: 40, page: 3, limit: 2 });
  });

  it('reads the purchasing endpoints, which nest the whole page under data', () => {
    // Suppliers, purchase orders — `res.json({ data: { items, total, … } })`.
    expect(
      normaliseCollection<Row>({ data: { items: rows, total: 7, page: 1, limit: 50 } }),
    ).toEqual({ items: rows, total: 7, page: 1, limit: 50 });
  });

  it('does not mistake a single record for a page of results', () => {
    // `{ data: { _id: … } }` is one document, not a list. It must not be read
    // as a page, and it must not throw.
    expect(normaliseCollection<Row>({ data: { _id: 'a' } })).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 0,
    });
  });

  it('survives an empty or unexpected payload rather than throwing', () => {
    expect(normaliseCollection<Row>({})).toEqual({ items: [], total: 0, page: 1, limit: 0 });
    expect(normaliseCollection<Row>({ data: null as unknown as never })).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 0,
    });
  });
});
