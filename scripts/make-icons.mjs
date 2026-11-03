// Old generator: rasterised the original SVG favicon into the PWA icons. The icons now come from the brand artwork (public/brand, public/icons); do not re-run it unless you want the old icon back.
// No dependencies: the logo is a few circles and strokes, drawn here with signed distances and
// 4x4 supersampling, then written as PNG with node:zlib. Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

const BG = [0x0c, 0x10, 0x1c], YELLOW = [0xff, 0xd2, 0x3f], BLUE = [0x3c, 0xc8, 0xff];

// Shapes in the favicon's 64x64 coordinate space, painted in order.
const rings = [{ cx: 18, cy: 42, r: 9, w: 5 }, { cx: 46, cy: 42, r: 9, w: 5 }];
const segs = [[18, 42, 30, 24], [30, 24, 42, 24], [42, 24, 46, 42], [26, 30, 40, 30]];

function segDist(px, py, [ax, ay, bx, by]) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function roundRectInside(px, py, size, rad) {
  const qx = Math.abs(px - size / 2) - (size / 2 - rad), qy = Math.abs(py - size / 2) - (size / 2 - rad);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad <= 0;
}

/** Colour of one sample at logo coordinates (x, y); null = transparent. */
function sample(x, y, rounded, fullBleed) {
  let c = fullBleed ? BG : rounded && roundRectInside(x, y, 64, 14) ? BG : !rounded && x >= 0 && y >= 0 && x <= 64 && y <= 64 ? BG : null;
  for (const r of rings) if (Math.abs(Math.hypot(x - r.cx, y - r.cy) - r.r) <= r.w / 2) c = YELLOW;
  for (const s of segs) if (segDist(x, y, s) <= 2.5) c = BLUE;
  return c;
}

/** size px; maskable = full-bleed background with the logo inside the 80 % safe zone. */
function render(size, { maskable = false, rounded = true } = {}) {
  const scale = maskable ? 0.72 : 1, off = (64 - 64 / scale) / 2; // logo units per pixel mapping
  const px = Buffer.alloc(size * size * 4), S = 4;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const lx = off + ((x + (sx + 0.5) / S) / size) * (64 / scale), ly = off + ((y + (sy + 0.5) / S) / size) * (64 / scale);
          const c = sample(lx, ly, rounded && !maskable, maskable);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      const i = (y * size + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = (a / (S * S)) * 255; }
    }
  return png(size, size, px);
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = ~0; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), t = Buffer.from(type, 'ascii');
  out.writeUInt32BE(data.length, 0);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), 8 + data.length);
  return out;
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', render(192));
writeFileSync('public/icons/icon-512.png', render(512));
writeFileSync('public/icons/maskable-512.png', render(512, { maskable: true }));
writeFileSync('public/icons/apple-touch-icon.png', render(180, { rounded: false })); // iOS rounds the corners itself
console.log('icons written to public/icons/');
