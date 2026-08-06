import { describe, expect, it } from 'vitest';
import { catalogueKeys, en } from '@medsupply/i18n';
import { documentFileName, extensionFor, type SaveProblem } from './names';

/**
 * **A document reference is not a file name.**
 *
 * Every one of these files is named from a string the *server* chose, and the
 * name is then joined onto a directory path. The distributor's own API sends
 * `INV-2026-000001`, and that is the case the happy path covers; the rest of
 * this file is about what happens when it does not.
 */
describe('naming a file that came off the network', () => {
  it('keeps an ordinary reference recognisable', () => {
    // The whole point: a pharmacy opening its downloads should see which
    // invoice this is without opening it.
    expect(documentFileName('INV-2026-000001', 'pdf')).toBe('INV-2026-000001.pdf');
    expect(documentFileName('CRN-2026-000042', 'pdf')).toBe('CRN-2026-000042.pdf');
  });

  it('cannot be talked into writing outside the directory it was given', () => {
    expect(documentFileName('../../../etc/passwd', 'pdf')).toBe('etc-passwd.pdf');
    expect(documentFileName('..', 'pdf')).toBe('document.pdf');
    expect(documentFileName('/absolute', 'pdf')).toBe('absolute.pdf');
    // A backslash is a separator on the platform this repository is developed
    // on, and the sanitiser must not care which platform it is running on.
    expect(documentFileName('..\\..\\windows', 'pdf')).toBe('windows.pdf');
  });

  it('does not write a file the owner cannot see to delete', () => {
    expect(documentFileName('.hidden', 'pdf')).toBe('hidden.pdf');
  });

  it('always produces a name, even from nothing', () => {
    expect(documentFileName('', 'pdf')).toBe('document.pdf');
    expect(documentFileName('   ', 'pdf')).toBe('document.pdf');
    expect(documentFileName('!!!', 'pdf')).toBe('document.pdf');
  });

  it('stays inside the length a filesystem will accept', () => {
    expect(documentFileName('A'.repeat(400), 'pdf')).toHaveLength(84);
  });
});

/**
 * The extension decides which applications the share sheet offers. Both
 * platforms read the name, not the bytes, so getting this wrong means a
 * photograph of a signature that nothing on the phone will open.
 */
describe('the extension for a content type', () => {
  it('names the four things this API actually sends', () => {
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
    // `.jpeg` is correct and `.jpg` is what every gallery on earth shows.
    expect(extensionFor('image/jpeg')).toBe('jpg');
  });

  it('ignores the parameters a server may append', () => {
    expect(extensionFor('application/pdf; charset=binary')).toBe('pdf');
    expect(extensionFor('IMAGE/JPEG')).toBe('jpg');
  });

  it('falls back rather than inventing an extension', () => {
    expect(extensionFor(undefined)).toBe('bin');
    expect(extensionFor('')).toBe('bin');
    expect(extensionFor('application/octet-stream')).toBe('octetstream');
  });
});

/**
 * `catalogueKeys.test.ts` reads literal `t('…')` call sites and nothing else,
 * so a key that only ever reaches `t()` through a variable — which is exactly
 * how every problem here is rendered — is invisible to it. Without this, a
 * misspelt `documents.couldNotFecth` would ship as the dotted path itself,
 * printed to a pharmacy in place of the sentence explaining what went wrong.
 */
describe('every problem this module reports can be said out loud', () => {
  const KNOWN = new Set(catalogueKeys(en));
  const PROBLEMS: SaveProblem[] = [
    'documents.couldNotFetch',
    'documents.couldNotWrite',
    'documents.cannotShare',
  ];

  it.each(PROBLEMS)('%s is in the catalogue', (key) => {
    expect(KNOWN.has(key)).toBe(true);
  });
});
