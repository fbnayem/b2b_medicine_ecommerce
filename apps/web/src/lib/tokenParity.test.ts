import { describe, expect, it } from 'vitest';
import { semanticDark, semanticLight, tokens } from '@medsupply/design-tokens';
// `?raw` rather than `node:fs`: this package's tsconfig declares
// `types: ["vite/client"]`, so Node's built-ins are deliberately not in scope —
// a browser bundle should not be able to reach the filesystem by accident.
import themeCss from '../../../../packages/design-tokens/theme.css?raw';

/**
 * Keeps the two halves of the token package in step.
 *
 * `index.ts` and `theme.css` are both hand-written — codegen was rejected
 * because CI does not run turbo and `apps/web` has no prebuild hook, so a
 * generator would add coupling to a build graph that has already broken this
 * project once. Hand-written means they can drift, and a drifted token is
 * invisible: the CSS keeps working, the TypeScript keeps compiling, and the
 * mobile app quietly renders a different green from the web app. This is the
 * thing that notices.
 *
 * It lives in the web suite rather than in the package because **CI runs no
 * package tests**, so a test in the package would be a test nothing runs —
 * which is the exact class of defect phase 2 was about.
 */

/** Pulls `--name: value;` declarations out of one CSS block. */
function declarationsIn(block: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found[match[1].slice(2)] = match[2].trim();
  }
  return found;
}

function blockFor(selector: string): string {
  // Deliberately not a CSS parser: the file is ours and its shape is stable,
  // and a parser dependency here would be more machinery than the job needs.
  const start = themeCss.indexOf(`${selector} {`);
  expect(start, `theme.css has no \`${selector}\` block`).toBeGreaterThan(-1);
  const end = themeCss.indexOf('\n}', start);
  return themeCss.slice(start, end);
}

describe('the design tokens agree across TypeScript and CSS', () => {
  it('every light token has the same value in both', () => {
    const css = declarationsIn(blockFor(':root'));
    const mismatched: string[] = [];

    for (const [name, value] of Object.entries(semanticLight)) {
      if (css[name] === undefined) mismatched.push(`${name}: missing from theme.css`);
      else if (css[name].toLowerCase() !== value.toLowerCase()) {
        mismatched.push(`${name}: index.ts says ${value}, theme.css says ${css[name]}`);
      }
    }

    expect(mismatched, mismatched.join('\n')).toEqual([]);
  });

  it('every dark token has the same value in both', () => {
    const css = declarationsIn(blockFor('.dark'));
    const mismatched: string[] = [];

    for (const [name, value] of Object.entries(semanticDark)) {
      if (css[name] === undefined) mismatched.push(`${name}: missing from the .dark block`);
      else if (css[name].toLowerCase() !== value.toLowerCase()) {
        mismatched.push(`${name}: index.ts says ${value}, theme.css says ${css[name]}`);
      }
    }

    expect(mismatched, mismatched.join('\n')).toEqual([]);
  });

  it('theme.css declares no semantic token that TypeScript does not', () => {
    const css = declarationsIn(blockFor(':root'));
    const known = new Set(Object.keys(semanticLight));
    const extra = Object.keys(css).filter((name) => name.startsWith('color-') && !known.has(name));
    expect(extra, `theme.css declares tokens index.ts has never heard of: ${extra}`).toEqual([]);
  });

  it('light and dark declare exactly the same token names', () => {
    // `semanticDark` is typed `Record<keyof typeof semanticLight, string>`, so
    // TypeScript already enforces this half. The CSS has no such help.
    const light = Object.keys(declarationsIn(blockFor(':root'))).sort();
    const dark = Object.keys(declarationsIn(blockFor('.dark'))).sort();
    expect(dark).toEqual(light);
  });

  it('exposes the semantic layer to Tailwind with `@theme inline`', () => {
    // Without `inline`, Tailwind resolves each var() once at :root, so
    // `bg-surface` compiles to the light value and every element inside .dark
    // inherits it — a dark shell with light cards, and no obvious cause.
    expect(themeCss).toContain('@theme inline');
    expect(themeCss).not.toMatch(/@theme\s*\{/);
  });

  it('keeps the raw ramps out of Tailwind so a fourth brand green cannot return', () => {
    const themeBlock = blockFor('@theme inline');
    expect(themeBlock).not.toMatch(/--color-green-/);
    expect(themeBlock).not.toMatch(/--color-neutral-/);
  });
});

describe('the palette meets the contrast it claims', () => {
  function relativeLuminance(hex: string): number {
    const channels = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrast(a: string, b: string): number {
    const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  }

  /**
   * The pairs that must clear WCAG AA for body text. This is the assertion the
   * project needed and did not have: two greys shipped at 2.47:1 and 3.62:1,
   * and nothing noticed until a browser did.
   */
  const PAIRS: Array<[string, keyof typeof semanticLight, keyof typeof semanticLight]> = [
    ['body text on surface', 'color-text', 'color-surface'],
    ['muted text on surface', 'color-text-muted', 'color-surface'],
    ['muted text on canvas', 'color-text-muted', 'color-canvas'],
    ['brand text on surface', 'color-brand', 'color-surface'],
    ['text on brand', 'color-on-brand', 'color-brand'],
    ['danger on surface', 'color-danger', 'color-surface'],
    ['warning on surface', 'color-warning', 'color-surface'],
    ['info on surface', 'color-info', 'color-surface'],
  ];

  for (const [label, foreground, background] of PAIRS) {
    it(`${label} clears 4.5:1 in light`, () => {
      const ratio = contrast(semanticLight[foreground], semanticLight[background]);
      expect(ratio, `${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${label} clears 4.5:1 in dark`, () => {
      const ratio = contrast(semanticDark[foreground], semanticDark[background]);
      expect(ratio, `${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('every chart series is distinguishable from the surface behind it', () => {
    // Both surfaces, because a single palette cannot serve both — which is what
    // this assertion caught on its first run.
    for (const series of tokens.chartLight) {
      const ratio = contrast(series, semanticLight['color-surface']);
      expect(ratio, `${series} is ${ratio.toFixed(2)}:1 on the light surface`).toBeGreaterThan(3);
    }
    for (const series of tokens.chartDark) {
      const ratio = contrast(series, semanticDark['color-surface']);
      expect(ratio, `${series} is ${ratio.toFixed(2)}:1 on the dark surface`).toBeGreaterThan(3);
    }
  });

  it('the chart series in theme.css match the TypeScript palettes', () => {
    const light = declarationsIn(blockFor(':root'));
    const dark = declarationsIn(blockFor('.dark'));
    tokens.chartLight.forEach((value, index) => {
      expect(light[`chart-${index + 1}`], `--chart-${index + 1} in :root`).toBe(value);
    });
    tokens.chartDark.forEach((value, index) => {
      expect(dark[`chart-${index + 1}`], `--chart-${index + 1} in .dark`).toBe(value);
    });
  });
});
