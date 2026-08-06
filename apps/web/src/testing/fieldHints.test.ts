import { describe, expect, it } from 'vitest';
import { NO_FIELD_HINT } from './uiWaivers';

/**
 * Every box tells you what goes in it.
 *
 * The request was blunt: *"a lot of boxes still don't have the description …
 * so a non tech person can read and use this without asking any questions."*
 * When that was measured, 143 fields across the pages carried 27 hints between
 * them — the medicine form had one on nineteen controls, and the sign-in page,
 * which is the first thing anybody meets, had none on either box.
 *
 * A hint is the always-visible line under a control. It is not the same thing
 * as the `HelpTip` beside a label: **if leaving a field out causes an error it
 * belongs in the hint, and if it causes a wrong-but-valid value it belongs in
 * the tip.** Nobody should have to open a popover to learn a required format,
 * which is why this gate is on `hint` and not on either.
 */

const RAW = {
  ...(import.meta.glob('../pages/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob('../components/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
};

const SOURCES = Object.entries(RAW).filter(([path]) => !path.includes('.test.'));

/**
 * The opening tag of each `<Field …>`.
 *
 * A regular expression cannot do this. Props hold JSX and object literals full
 * of `>` — `onChange={(e) => …}` alone defeats `/<Field[^>]*>/` — so the scan
 * tracks brace depth and quoting and stops at the first `>` outside both.
 */
export function fieldTags(code: string): string[] {
  const tags: string[] = [];
  for (let i = code.indexOf('<Field'); i !== -1; i = code.indexOf('<Field', i + 1)) {
    // `<FieldSet` and friends are different elements.
    if (/[A-Za-z]/.test(code[i + 6] ?? '')) continue;
    let depth = 0;
    let quote: string | null = null;
    for (let j = i + 6; j < code.length; j += 1) {
      const c = code[j]!;
      if (quote) {
        if (c === quote && code[j - 1] !== '\\') quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = c;
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) {
        tags.push(code.slice(i, j + 1));
        break;
      }
    }
  }
  return tags;
}

/**
 * Files where a bare `<Field>` is right.
 *
 * These are the primitives that *take* a hint from whoever renders them and
 * hand it on — `SearchPicker`, `PickOrCreate`, the confirm dialog, and `Field`
 * itself. Requiring a literal hint inside them would mean hard-coding one
 * sentence for every caller, which is the opposite of the point.
 */
const PASSES_HINT_THROUGH = /\/(Field|SearchPicker|PickOrCreate|ask)\.tsx$/;

function offenders(): string[] {
  const found: string[] = [];
  for (const [path, code] of SOURCES) {
    if (PASSES_HINT_THROUGH.test(path)) continue;
    const name = path.split('/').pop() ?? path;
    fieldTags(code).forEach((tag, index) => {
      if (!/\bhint=/.test(tag)) found.push(`${name}#${index}`);
    });
  }
  return found.sort();
}

describe('every field says what goes in it', () => {
  it('no unwaived field is without a hint', () => {
    const unwaived = offenders().filter((entry) => !NO_FIELD_HINT.includes(entry));
    expect(
      unwaived,
      "Add hint={t('hints.…')}. A box with only a label is a question the reader has to ask somebody.",
    ).toEqual([]);
  });

  it('the waiver list has no stale entries', () => {
    const current = new Set(offenders());
    const stale = NO_FIELD_HINT.filter((entry) => !current.has(entry));
    expect(stale, 'These fields now have a hint. Strike them off uiWaivers.ts.').toEqual([]);
  });

  it('the scan reads real files, so a clean run is not an empty one', () => {
    // A glob that matched nothing would satisfy the rule above in silence.
    const total = SOURCES.reduce((sum, [, code]) => sum + fieldTags(code).length, 0);
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(total).toBeGreaterThan(140);
  });

  it('the parser survives the props that defeat a regular expression', () => {
    /*
     * Each of these is a shape that appears in the application and would break
     * a naive `/<Field[^>]*>/`: an arrow function, a comparison, a nested
     * element, and a `>` inside a string.
     */
    expect(fieldTags('<Field label={x} onChange={(e) => go(e)}>child</Field>')).toEqual([
      '<Field label={x} onChange={(e) => go(e)}>',
    ]);
    expect(fieldTags('<Field label={a > b ? c : d}>x</Field>')).toEqual([
      '<Field label={a > b ? c : d}>',
    ]);
    expect(fieldTags('<Field label={<b>hi</b>}>x</Field>')).toEqual(['<Field label={<b>hi</b>}>']);
    expect(fieldTags('<Field label="a > b">x</Field>')).toEqual(['<Field label="a > b">']);

    // It finds every tag, not only the first.
    expect(fieldTags('<Field label={a}>x</Field><Field label={b} hint={h}>y</Field>')).toHaveLength(
      2,
    );
    // And does not mistake a different element for this one.
    expect(fieldTags('<FieldSet label={a}>x</FieldSet>')).toEqual([]);

    // The rule really fires on a hintless tag and really passes a hinted one.
    expect(/\bhint=/.test('<Field label={x}>')).toBe(false);
    expect(/\bhint=/.test("<Field label={x} hint={t('hints.city')}>")).toBe(true);
  });
});
