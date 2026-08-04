// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSavedFilter, writeSavedFilter } from './savedFilter';

describe('a remembered queue filter', () => {
  beforeEach(() => window.localStorage.clear());

  it('gives back the fallback until something is chosen', () => {
    expect(readSavedFilter('fulfilment', 'PENDING')).toBe('PENDING');
  });

  it('remembers a choice, including the choice to see everything', () => {
    writeSavedFilter('fulfilment', 'PICKING');
    expect(readSavedFilter('fulfilment', 'PENDING')).toBe('PICKING');

    // The empty string means "all", and it is a real answer rather than an
    // absent one — reading it back as the fallback would make "show me
    // everything" the one choice that never sticks.
    writeSavedFilter('fulfilment', '');
    expect(readSavedFilter('fulfilment', 'PENDING')).toBe('');
  });

  it('keeps queues apart', () => {
    writeSavedFilter('fulfilment', 'PICKING');
    expect(readSavedFilter('approvals', 'SUBMITTED')).toBe('SUBMITTED');
  });

  it('falls back rather than throwing when storage is unavailable', () => {
    /*
     * A locked-down warehouse terminal, private browsing, or a full quota. A
     * remembered filter is a convenience; it must never be the reason a queue
     * fails to render.
     */
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readSavedFilter('fulfilment', 'PENDING')).toBe('PENDING');
    expect(() => writeSavedFilter('fulfilment', 'PICKING')).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
