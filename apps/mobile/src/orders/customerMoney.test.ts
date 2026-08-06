import { describe, expect, it } from 'vitest';

/**
 * **No screen may work out for itself what a customer will pay.**
 *
 * The basket did, for the whole life of this application: it multiplied
 * `medicine.defaultSellingPriceMinor` by the quantity and called the result a
 * subtotal. That is the *list* price — before this shop's own discount, before
 * whichever price list they are assigned, before any free-goods offer, and
 * before the delivery charge. `POST /orders/submit` reprices from
 * `resolvePriceFrom` on the way in, so the customer was shown one total and
 * charged another.
 *
 * Nothing caught it. Every test passed and the arithmetic was correct; the
 * number was wrong because the *inputs* were wrong. A test asserting the
 * multiplication would have agreed with the defect.
 *
 * So there are two rules, and they are different claims:
 *
 *   1. **A catalogue price is never arithmetic.** Multiplying or summing one is
 *      the defect itself, wherever it happens. `POST /orders/quote` is the only
 *      thing entitled to do that sum, because it is the only thing that knows
 *      the discount, the list, the offers and the delivery charge.
 *   2. **A catalogue price is always labelled as one.** Showing it is fine —
 *      a shop may reasonably want to know the catalogue price of a product —
 *      but a bare figure under a medicine reads as "what I pay". Two screens
 *      were doing exactly that, one of them under the words "Unit price".
 *
 * Both waiver lists are empty and are meant to stay that way.
 *
 * Read through Vite rather than `node:fs`, as `tokenDiscipline.test.ts` and
 * `catalogueKeys.test.ts` do and for the same reason: code that ships to Hermes
 * must not be able to reach a filesystem.
 */
const RAW = import.meta.glob(['../../app/**/*.tsx', '../**/*.ts', '../**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * The source with its comments and string literals removed.
 *
 * Necessary, not fastidious: the first version of this rule failed on three
 * files whose **doc comments explain the defect**, including this feature's own
 * `quote.ts`. A rule that cannot be described in a comment is a rule nobody
 * will understand well enough to keep.
 *
 * Tracks the four states that matter — line comment, block comment, quoted
 * string, template literal — and leaves everything else alone. Regular
 * expressions are not tracked; a `/` in an expression simply survives, which is
 * harmless here because nothing below cares about division.
 */
export function code(source: string): string {
  let out = '';
  let state: 'code' | 'line' | 'block' | 'quote' | 'template' = 'code';
  let quote = '';
  /*
   * One entry per open `${…}`, holding the brace depth reached inside it.
   *
   * Without this the scanner never goes back into the template: the `}` that
   * closes an interpolation looked like ordinary code, so the closing backtick
   * *opened* a new template and every line after it in the file was skipped.
   * That is how the first version of this rule read every screen as containing
   * no code at all — and passed.
   */
  const interpolations: number[] = [];

  for (let i = 0; i < source.length; i += 1) {
    const character = source[i]!;
    const next = source[i + 1];

    if (state === 'line') {
      if (character === '\n') {
        state = 'code';
        out += character;
      }
      continue;
    }
    if (state === 'block') {
      if (character === '*' && next === '/') {
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state === 'quote') {
      if (character === '\\') {
        i += 1;
        continue;
      }
      if (character === quote) state = 'code';
      continue;
    }
    if (state === 'template') {
      if (character === '\\') {
        i += 1;
        continue;
      }
      if (character === '`') {
        state = 'code';
        continue;
      }
      if (character === '$' && next === '{') {
        interpolations.push(0);
        state = 'code';
        i += 1;
        out += ' ';
      }
      continue;
    }

    // Code.
    if (character === '/' && next === '/') {
      state = 'line';
      i += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      state = 'block';
      i += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      state = 'quote';
      quote = character;
      continue;
    }
    if (character === '`') {
      state = 'template';
      continue;
    }
    if (interpolations.length > 0) {
      const open = interpolations.length - 1;
      if (character === '{') interpolations[open] += 1;
      else if (character === '}') {
        if (interpolations[open] === 0) {
          interpolations.pop();
          state = 'template';
          continue;
        }
        interpolations[open] -= 1;
      }
    }
    out += character;
  }
  return out;
}

const CATALOGUE_PRICE = /\b(defaultSellingPriceMinor|costPriceMinor|mrpMinor)\b/;

/**
 * A catalogue price with an operator on either side of it.
 *
 * `a.defaultSellingPriceMinor * quantity` and `total + line.mrpMinor` both
 * match; `formatMoneyMinor(item.defaultSellingPriceMinor)` does not, because
 * showing one is allowed and adding one up is not.
 */
const ARITHMETIC = new RegExp(
  String.raw`(?:[*+\-/]\s*[\w.?[\]]*\b(?:defaultSellingPriceMinor|costPriceMinor|mrpMinor)\b` +
    String.raw`|\b(?:defaultSellingPriceMinor|costPriceMinor|mrpMinor)\b\s*[*+\-/])`,
);

/** The label that says a figure is the catalogue's and not this customer's. */
const LIST_PRICE_LABEL = 'catalogue.listPrice';

function sources(): Array<[string, string]> {
  return Object.entries(RAW)
    .map(
      ([path, raw]) =>
        [
          path
            .replace(/^\.\.\/\.\.\//, '')
            .replace(/^\.\.\//, 'src/')
            .replace(/^\.\//, 'src/orders/'),
          String(raw),
        ] as [string, string],
    )
    .filter(([file]) => !file.includes('.test.'));
}

describe('what a customer is told they will pay', () => {
  it('found the source to search, so a clean run is not an empty one', () => {
    // A glob matching nothing satisfies every rule below in silence.
    expect(sources().length).toBeGreaterThan(40);
    expect(sources().filter(([, raw]) => CATALOGUE_PRICE.test(code(raw))).length).toBeGreaterThan(
      0,
    );
  });

  it('never adds up a catalogue price', () => {
    const offenders = sources()
      .filter(([, raw]) => ARITHMETIC.test(code(raw)))
      .map(([file]) => file)
      .sort();

    expect(
      offenders,
      'These do arithmetic on a catalogue price. What this shop actually pays comes from ' +
        'POST /orders/quote — the only thing that applies their discount, their price list, ' +
        'free goods and the delivery charge. A total worked out here is a total the invoice ' +
        'will disagree with, and the customer will have read this one.',
    ).toEqual([]);
  });

  it('never shows a catalogue price without saying that is what it is', () => {
    const unlabelled = sources()
      .filter(([, raw]) => CATALOGUE_PRICE.test(code(raw)))
      .filter(([, raw]) => !raw.includes(LIST_PRICE_LABEL))
      .map(([file]) => file)
      .sort();

    expect(
      unlabelled,
      `These render a catalogue price with no '${LIST_PRICE_LABEL}' label beside it. A bare ` +
        'figure under a medicine reads as the price this shop pays, and it is not.',
    ).toEqual([]);
  });

  it('the basket asks the server, rather than being merely silent about prices', () => {
    /*
     * The rules above are satisfied by a basket that shows no money at all,
     * which is not the fix. This is the positive half: the screen that had the
     * defect must reach the endpoint that answers it.
     */
    const find = (file: string) => sources().find(([path]) => path === file)?.[1];

    const basket = find('app/(protected)/(tabs)/cart.tsx');
    expect(basket, 'the basket screen moved; this rule now checks nothing').toBeDefined();
    expect(basket).toContain('useQuote');

    const checkout = find('app/(protected)/checkout.tsx');
    expect(checkout, 'the checkout screen moved').toBeDefined();
    expect(checkout).toContain('useQuote');

    expect(find('src/orders/quote.ts')).toContain('/orders/quote');
  });

  it('the comment stripper does what the rules depend on', () => {
    /*
     * The self-proof. If `code()` ever returned its input unchanged, rule one
     * would fail on this file's own prose, and if it swallowed too much both
     * rules would pass by finding nothing — the shape of a gate that has
     * quietly stopped working.
     */
    expect(code('// a * b\nc')).toBe('\nc');
    expect(code('/* x.mrpMinor * 2 */ y')).toBe(' y');
    expect(code("const s = 'a.mrpMinor * 2';")).toBe('const s = ;');
    expect(code('`text ${a.mrpMinor * 2} more`')).toContain('a.mrpMinor * 2');
    // And the file does not end inside the template: what follows is code again.
    expect(code('`${a}` + b.mrpMinor * 2')).toContain('b.mrpMinor * 2');
    expect(ARITHMETIC.test(code('const t = m.defaultSellingPriceMinor * q;'))).toBe(true);
    expect(ARITHMETIC.test(code('formatMoneyMinor(m.defaultSellingPriceMinor)'))).toBe(false);
  });
});
