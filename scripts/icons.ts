/**
 * Dependency-free icon generator: rasterizes the Anti-Judol shield (same design as
 * assets/icon.svg) with 4×4 supersampling and writes PNGs via node:zlib.
 * Run: bun run icons   (PNGs are committed; only needed when the design changes)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

type Pt = [number, number];
type RGBA = [number, number, number, number];

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Shield outline in a 128-unit box; `inset` shrinks it for the inner highlight. */
function shield(i: number): Pt[] {
  const top: Pt = [64, 6 + i], r: Pt = [112 - i, 22 + i * 0.7], rm: Pt = [112 - i, 60], bot: Pt = [64, 122 - i];
  const lm: Pt = [16 + i, 60], l: Pt = [16 + i, 22 + i * 0.7];
  return [top, r, rm, ...cubic(rm, [112 - i, 90 - i * 0.6], [92 - i * 0.6, 112 - i], bot), ...cubic(bot, [36 + i * 0.6, 112 - i], [16 + i, 90 - i * 0.6], lm), l];
}

function inPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

const OUTER = shield(0);
const INNER = shield(10);
const SEVEN: Pt[] = [[47, 40], [81, 40], [81, 49], [63, 88], [52, 88], [70, 49], [47, 49]];
const RED: RGBA = [198, 40, 40, 255];
const LIGHT: RGBA = [229, 57, 53, 255];
const WHITE: RGBA = [255, 255, 255, 255];

/** Topmost color at a point in 128-unit space, or null for transparent. */
function sample(x: number, y: number, size: number): RGBA | null {
  // At tiny sizes, thicken strokes so the symbol stays legible.
  const stroke = size <= 16 ? 7 : size <= 32 ? 5.5 : 4.5;
  if (!inPoly(x, y, OUTER)) return null;
  const d = Math.hypot(x - 64, y - 63);
  if (Math.abs(d - 34) <= stroke) return WHITE;
  if (segDist(x, y, [40, 39], [88, 87]) <= stroke) return WHITE;
  if (d < 34 && inPoly(x, y, SEVEN)) return WHITE;
  return inPoly(x, y, INNER) ? LIGHT : RED;
}

function render(size: number): Buffer {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++)
    for (let pxX = 0; pxX < size; pxX++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(((pxX + (sx + 0.5) / SS) * 128) / size, ((py + (sy + 0.5) / SS) * 128) / size, size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      const o = (py * size + pxX) * 4;
      const n = a / 255;
      if (n > 0) {
        px[o] = Math.round(r / n); px[o + 1] = Math.round(g / n); px[o + 2] = Math.round(b / n);
      }
      px[o + 3] = Math.round(a / (SS * SS));
    }
  return png(size, size, px);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir("static/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(`static/icons/icon-${size}.png`, render(size));
  console.log(`static/icons/icon-${size}.png`);
}
