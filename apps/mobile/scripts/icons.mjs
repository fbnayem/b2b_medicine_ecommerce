import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `node scripts/icons.mjs` → the launcher icons for all three applications.
 *
 * ## Why a script and not three image files
 *
 * The three applications shipped with the Expo template's own icon — the same
 * purple mark on all three, which is not a placeholder problem so much as a
 * **shipping** problem: a pharmacy owner, a warehouse storekeeper and a rider
 * can all have two of these installed, and an operator picking the wrong one on
 * a home screen is a person taking an order into the rider's application.
 *
 * They have to be told apart at 48 pixels, in daylight, by somebody who is not
 * looking carefully. Colour alone will not do it — the accents already differ
 * and the icons were still identical — so each has a **different silhouette**:
 * a carton, a clipboard, a pin. Those survive greyscale, the common forms of
 * colour blindness, and the monochrome themed-icon treatment Android applies on
 * top of everything.
 *
 * Generated rather than drawn because the output is a handful of rectangles and
 * circles, and a script keeps the three in step: change the safe-zone margin
 * once and all nine files are correct, where nine exported PNGs drift the first
 * time somebody re-exports one of them. `iconAssets.test.ts` checks the files
 * this writes are the files `app.config.ts` asks for.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, '..', 'assets');

// ─── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, tail]);
}

/** 8-bit RGBA, no interlacing — the one shape every consumer of these reads. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Shapes, in a 100 × 100 design space ─────────────────────────────────────

const roundedRect = (x, y, w, h, r) => (px, py) => {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

const circle = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

const triangle = (ax, ay, bx, by, cx, cy) => (px, py) => {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/** A pharmaceutical cross: two bars, equal, meeting in the middle. */
const cross = (cx, cy, arm, thickness) => {
  const across = roundedRect(cx - arm, cy - thickness / 2, arm * 2, thickness, thickness / 4);
  const down = roundedRect(cx - thickness / 2, cy - arm, thickness, arm * 2, thickness / 4);
  return (px, py) => across(px, py) || down(px, py);
};

/**
 * Three silhouettes, one per application.
 *
 * `draw` is filled; `cut` is taken back out of it. The cut is what makes each
 * mark readable rather than a solid blob — and on the Android foreground, where
 * the surrounding pixels are transparent, a cut is a genuine hole with the
 * launcher's own background showing through.
 */
const GLYPHS = {
  // A carton with a medicine cross on it: what arrives at the pharmacy.
  shop: {
    draw: [roundedRect(17, 27, 66, 56, 8)],
    cut: [roundedRect(17, 40, 66, 4, 0), cross(50, 63, 12, 9)],
  },
  // A clipboard: the work list a manager and a storekeeper both read from.
  staff: {
    draw: [roundedRect(23, 25, 54, 62, 7), roundedRect(39, 15, 22, 14, 5)],
    /*
     * No slot across the clip. There was one, and at 48 pixels the sliver it
     * left between clip and board read as a rendering fault rather than as a
     * clipboard. A solid tab is the stronger silhouette.
     */
    cut: [
      roundedRect(33, 45, 34, 6, 3),
      roundedRect(33, 58, 34, 6, 3),
      roundedRect(33, 71, 22, 6, 3),
    ],
  },
  // A map pin: the one thing a rider's day is actually about.
  rider: {
    /*
     * The triangle's top edge sits *inside* the circle rather than level with
     * its widest point. Drawn flush it stuck out on both sides, giving the pin
     * two small wings where the shapes met — invisible at 1024 pixels in a
     * preview and obvious at 48 on a home screen.
     */
    draw: [circle(50, 41, 23), triangle(33, 52, 67, 52, 50, 86)],
    cut: [circle(50, 41, 9.5)],
  },
};

const ACCENT = {
  // The same three values `app.config.ts` gives each application, and
  // `iconAssets.test.ts` fails if they ever stop matching.
  shop: '#126b45',
  staff: '#1f5fa8',
  rider: '#8a5300',
};

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Renders one glyph.
 *
 * `scale` is the fraction of the canvas the 100-unit design space occupies.
 * Android masks an adaptive icon down to its central 66/108 of the canvas, so
 * a foreground drawn edge to edge loses its corners; passing 0.84 there keeps
 * the whole mark inside the safe circle whatever mask a launcher applies.
 *
 * Four samples per pixel. Not a real anti-aliasing pass, but enough that a
 * circle at 48 pixels does not have a staircase on it, which is where these are
 * actually looked at.
 */
function render({ size, glyph, background, foreground, scale = 1 }) {
  const [fr, fg, fb] = rgb(foreground);
  const pixels = Buffer.alloc(size * size * 4);
  const { draw, cut } = GLYPHS[glyph];
  const span = size * scale;
  const offset = (size - span) / 2;
  const OFFSETS = [0.25, 0.75];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (const dy of OFFSETS) {
        for (const dx of OFFSETS) {
          const ux = ((x + dx - offset) / span) * 100;
          const uy = ((y + dy - offset) / span) * 100;
          if (draw.some((shape) => shape(ux, uy)) && !cut.some((shape) => shape(ux, uy))) hits += 1;
        }
      }
      const coverage = hits / 4;
      const index = (y * size + x) * 4;

      if (background) {
        const [br, bg, bb] = rgb(background);
        pixels[index] = Math.round(br + (fr - br) * coverage);
        pixels[index + 1] = Math.round(bg + (fg - bg) * coverage);
        pixels[index + 2] = Math.round(bb + (fb - bb) * coverage);
        pixels[index + 3] = 255;
      } else {
        // Transparent surround: the colour is constant and the coverage is the
        // alpha, so a hole in the glyph is a hole rather than a white patch.
        pixels[index] = fr;
        pixels[index + 1] = fg;
        pixels[index + 2] = fb;
        pixels[index + 3] = Math.round(coverage * 255);
      }
    }
  }
  return encodePng(size, size, pixels);
}

function flat(size, colour) {
  const [r, g, b] = rgb(colour);
  const pixels = Buffer.alloc(size * size * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = r;
    pixels[index + 1] = g;
    pixels[index + 2] = b;
    pixels[index + 3] = 255;
  }
  return encodePng(size, size, pixels);
}

mkdirSync(ASSETS, { recursive: true });
const written = [];
function write(name, buffer) {
  writeFileSync(join(ASSETS, name), buffer);
  written.push(`${name} (${buffer.length.toLocaleString()} bytes)`);
}

for (const variant of ['shop', 'staff', 'rider']) {
  const accent = ACCENT[variant];
  // iOS and the store listing: full bleed, no transparency anywhere — an alpha
  // channel in an App Store icon is rejected at upload, so this one is opaque.
  write(
    `icon-${variant}.png`,
    render({ size: 1024, glyph: variant, background: accent, foreground: '#ffffff' }),
  );
  // Android adaptive: three layers, because a launcher may mask, shadow and
  // animate them independently.
  write(`android-icon-background-${variant}.png`, flat(512, accent));
  write(
    `android-icon-foreground-${variant}.png`,
    render({ size: 512, glyph: variant, foreground: '#ffffff', scale: 0.84 }),
  );
  // Themed icons: the launcher supplies both colours, so this is a stencil.
  write(
    `android-icon-monochrome-${variant}.png`,
    render({ size: 432, glyph: variant, foreground: '#ffffff', scale: 0.84 }),
  );
  write(
    `splash-icon-${variant}.png`,
    render({ size: 1024, glyph: variant, background: accent, foreground: '#ffffff', scale: 0.6 }),
  );
}

// One favicon, for `expo start --web`, which is a development tool rather than
// a product: the staff mark, because that is the variant `pnpm web` runs.
write(
  'favicon.png',
  render({ size: 48, glyph: 'staff', background: ACCENT.staff, foreground: '#ffffff' }),
);

console.log(`Wrote ${written.length} files to assets/:\n  ${written.join('\n  ')}`);
