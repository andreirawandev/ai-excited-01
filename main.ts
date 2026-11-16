// ai-excited-01 entry — "I DREW THIS."
// An image drawn entirely in code (no image model, no prompt, no asset):
// a small robot rides a giant pencil like a rocket across a blazing sky,
// the pencil tip drawing its own glowing comet trail. The twist is the
// point: an AI agent literally drew this with code, pixel by pixel.
// Node 22, standard library only. Deterministic: fixed-seed RNG, no clock,
// no network. Writes one PNG to /output/entry.png (MAKEFUN_OUTPUT_DIR
// stands in for /output outside the grader's container).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const buf = new Uint8ClampedArray(W * H * 4);

// ---- deterministic RNG (mulberry32, fixed seed) ----
let seed = 0xC0FFEE;
function rnd(): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- colour helpers ----
type RGB = [number, number, number];
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Blend src colour over the pixel at (x, y) with alpha 0..1.
function set(x: number, y: number, c: RGB, a = 1): void {
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 4;
  const inv = 1 - a;
  buf[i] = c[0] * a + buf[i] * inv;
  buf[i + 1] = c[1] * a + buf[i + 1] * inv;
  buf[i + 2] = c[2] * a + buf[i + 2] * inv;
  buf[i + 3] = 255;
}

// ---- PNG encoder (RGBA, filter 0, zlib) ----
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: none
    Buffer.from(buf.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- shape primitives ----
function rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(H, Math.ceil(y + h)); yy++)
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(W, Math.ceil(x + w)); xx++) set(xx, yy, c, a);
}
function circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const r2 = r * r;
  for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++)
    for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
      const dx = xx - cx + 0.5, dy = yy - cy + 0.5;
      if (dx * dx + dy * dy <= r2) set(xx, yy, c, a);
    }
}
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  for (let yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy++)
    for (let xx = Math.floor(cx - rx); xx <= Math.ceil(cx + rx); xx++) {
      const dx = (xx - cx + 0.5) / rx, dy = (yy - cy + 0.5) / ry;
      if (dx * dx + dy * dy <= 1) set(xx, yy, c, a);
    }
}
// Thick line: stamp circles along the segment.
function line(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB, a = 1): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, w / 3)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    circle(x1 + dx * t, y1 + dy * t, w / 2, c, a);
  }
}
// Scanline polygon fill.
function poly(pts: [number, number][], c: RGB, a = 1): void {
  let minY = H, maxY = 0;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) set(x, y, c, a);
  }
}
// Rotate a point around (cx, cy) by angle radians.
function rot(x: number, y: number, cx: number, cy: number, ang: number): [number, number] {
  const dx = x - cx, dy = y - cy, co = Math.cos(ang), si = Math.sin(ang);
  return [cx + dx * co - dy * si, cy + dx * si + dy * co];
}

// ---- sky: vertical gradient + sun glow + stars ----
function paintSky(): void {
  const stops: [number, RGB][] = [
    [0.00, [26, 11, 46]],
    [0.30, [74, 28, 110]],
    [0.52, [168, 46, 140]],
    [0.72, [232, 84, 90]],
    [0.88, [255, 140, 40]],
    [1.00, [255, 201, 60]],
  ];
  const sunX = 820, sunY = 170, sunR = 420;
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const [t0, c0] = stops[s], [t1, c1] = stops[s + 1];
    const base = mix(c0, c1, (t - t0) / (t1 - t0));
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - sunX, y - sunY) / sunR;
      const glow = d < 1 ? Math.pow(1 - d, 2.2) : 0;
      const c: RGB = [
        Math.min(255, base[0] + glow * 160),
        Math.min(255, base[1] + glow * 110),
        Math.min(255, base[2] + glow * 40),
      ];
      set(x, y, c);
    }
  }
  // Sun disc.
  circle(sunX, sunY, 92, [255, 236, 170]);
  circle(sunX, sunY, 70, [255, 248, 220]);
  // Stars in the darker upper sky.
  for (let i = 0; i < 150; i++) {
    const x = rnd() * W, y = rnd() * 560;
    const b = 0.35 + rnd() * 0.65;
    const r = rnd() < 0.12 ? 2.2 : 1.2;
    circle(x, y, r, [255, 250, 235], b);
    if (rnd() < 0.08) { // four-point sparkle
      line(x - 7, y, x + 7, y, 1.4, [255, 250, 235], b);
      line(x, y - 7, x, y + 7, 1.4, [255, 250, 235], b);
    }
  }
}

// ---- bitmap font (my own 5x7 blocky capitals) ----
const FONT: Record<string, string[]> = {
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  '.': ['.....', '.....', '.....', '.....', '.....', '..#..', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}
function drawText(s: string, x: number, y: number, scale: number, fill: RGB, outline: RGB): void {
  // Outline: render the mask shifted in 8 directions first.
  const offs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [ox, oy] of offs) drawTextMask(s, x + ox * scale * 0.45, y + oy * scale * 0.45, scale, outline);
  drawTextMask(s, x, y, scale, fill);
}
function drawTextMask(s: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 7; r++)
      for (let col = 0; col < 5; col++)
        if (g[r][col] === '#') rect(cx + col * scale, y + r * scale, scale, scale, c);
    cx += 6 * scale;
  }
}

// ---- the pencil (axis frame) ----
const PC: [number, number] = [510, 560];           // pencil centre
const AX: [number, number] = [0.732, -0.678];      // axis: tail -> tip (up-right)
const N1: [number, number] = [0.678, 0.732];       // normal: trail side (down-right)
function axisPoint(u: number, v: number): [number, number] {
  return [PC[0] + AX[0] * u + N1[0] * v, PC[1] + AX[1] * u + N1[1] * v];
}
function bar(u1: number, u2: number, v1: number, v2: number, c: RGB, a = 1): void {
  poly([axisPoint(u1, v1), axisPoint(u2, v1), axisPoint(u2, v2), axisPoint(u1, v2)], c, a);
}
function atri(u1: number, v1: number, u2: number, v2: number, u3: number, v3: number, c: RGB, a = 1): void {
  poly([axisPoint(u1, v1), axisPoint(u2, v2), axisPoint(u3, v3)], c, a);
}
function paintPencil(): void {
  bar(-460, -405, -34, 34, [232, 90, 122]);          // eraser
  bar(-405, -365, -34, 34, [200, 204, 212]);         // ferrule
  bar(-402, -392, -34, 34, [150, 155, 165]);
  bar(-378, -368, -34, 34, [150, 155, 165]);
  bar(-365, 300, -34, 34, [255, 197, 49]);           // body
  bar(-365, 300, -26, -19, [224, 161, 0]);           // edge stripes
  bar(-365, 300, 19, 26, [224, 161, 0]);
  bar(-365, 300, -8, 8, [255, 214, 110], 0.55);      // centre highlight
  atri(300, -34, 300, 34, 415, 0, [242, 201, 138]);  // wood cone
  atri(395, -10, 395, 10, 460, 0, [43, 43, 58]);     // graphite
}
const TIP = axisPoint(460, 0);

// ---- the comet trail (quadratic Bezier from the tip) ----
function trailPoint(t: number): [number, number] {
  const p0: [number, number] = [847, 248], p1: [number, number] = [520, 700], p2: [number, number] = [140, 860];
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
function trailColor(t: number): RGB {
  const stops: [number, RGB][] = [
    [0, [255, 240, 180]], [0.25, [255, 180, 60]], [0.5, [255, 90, 120]],
    [0.75, [180, 80, 255]], [1, [80, 220, 255]],
  ];
  let s = 0;
  while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
  const [t0, c0] = stops[s], [t1, c1] = stops[s + 1];
  return mix(c0, c1, (t - t0) / (t1 - t0));
}
function paintTrail(): void {
  const N = 46;
  for (let pass = 0; pass < 2; pass++) { // 0: soft glow, 1: bright core
    for (let i = N - 1; i >= 0; i--) {
      const t = i / (N - 1);
      const [x, y] = trailPoint(t);
      const r = pass === 0 ? lerp(96, 22, t) : lerp(40, 9, t);
      circle(x, y, r, trailColor(t), pass === 0 ? 0.16 : 1);
    }
  }
  // Sparks and binary flecks riding the trail.
  for (let i = 0; i < 26; i++) {
    const t = rnd();
    const [x, y] = trailPoint(t);
    const ox = (rnd() - 0.5) * 110, oy = (rnd() - 0.5) * 110;
    const s = 6 + rnd() * 10;
    const c: RGB = rnd() < 0.5 ? [255, 250, 235] : [255, 210, 90];
    line(x + ox - s, y + oy, x + ox + s, y + oy, 2, c, 0.9);
    line(x + ox, y + oy - s, x + ox, y + oy + s, 2, c, 0.9);
  }
  // (No letter-like marks: stray glyphs would read as garbled text.)
}
function paintStarburst(): void {
  const [x, y] = TIP;
  circle(x, y, 64, [255, 210, 90], 0.28);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + 0.2;
    line(x + Math.cos(a) * 18, y + Math.sin(a) * 18, x + Math.cos(a) * 62, y + Math.sin(a) * 62, 5, [255, 220, 120], 0.9);
  }
  circle(x, y, 26, [255, 240, 180], 0.95);
  circle(x, y, 15, [255, 255, 255]);
}

// ---- the robot (local frame: f = forward along pencil, u = out from pencil) ----
const RO = axisPoint(230, -34); // robot origin, on the pencil's far edge (up-left side)
const RF: [number, number] = AX;                    // forward (up-left)
const RU: [number, number] = [-N1[0], -N1[1]];     // outward from the pencil
function rPt(lf: number, lu: number): [number, number] {
  return [RO[0] + RF[0] * lf + RU[0] * lu, RO[1] + RF[1] * lf + RU[1] * lu];
}
function rRect(lf: number, lu: number, w: number, h: number, c: RGB, a = 1): void {
  poly([rPt(lf - w / 2, lu - h / 2), rPt(lf + w / 2, lu - h / 2), rPt(lf + w / 2, lu + h / 2), rPt(lf - w / 2, lu + h / 2)], c, a);
}
function rLine(lf1: number, lu1: number, lf2: number, lu2: number, w: number, c: RGB, a = 1): void {
  const [x1, y1] = rPt(lf1, lu1), [x2, y2] = rPt(lf2, lu2);
  line(x1, y1, x2, y2, w, c, a);
}
function rCircle(lf: number, lu: number, r: number, c: RGB, a = 1): void {
  const [x, y] = rPt(lf, lu);
  circle(x, y, r, c, a);
}
function paintRobot(): void {
  // Scarf trailing behind (against the flight direction).
  rLine(0, 100, -48, 116, 17, [232, 56, 79]);
  rLine(-48, 116, -88, 98, 15, [232, 56, 79]);
  rLine(-88, 98, -122, 116, 13, [232, 56, 79]);
  rCircle(0, 102, 11, [180, 30, 55]);
  // Boots on the pencil.
  rRect(-26, 8, 26, 18, [30, 30, 48]);
  rRect(10, 8, 26, 18, [30, 30, 48]);
  // Body (dark outline, then teal).
  rRect(0, 56, 92, 100, [18, 14, 52]);
  rRect(0, 56, 84, 92, [20, 184, 196]);
  rRect(0, 62, 52, 46, [63, 210, 221]);
  rCircle(0, 80, 8, [255, 210, 90]);
  // Arms: one gripping the pencil, one waving.
  rLine(38, 62, 76, 12, 14, [20, 184, 196]);
  rCircle(78, 10, 9, [20, 184, 196]);
  rLine(-38, 62, -70, 96, 14, [20, 184, 196]);
  rCircle(-72, 98, 9, [20, 184, 196]);
  // Head (dark outline, then teal), face plate, glowing eyes.
  rCircle(0, 142, 48, [18, 14, 52]);
  rCircle(0, 142, 44, [20, 184, 196]);
  rRect(0, 142, 66, 40, [215, 250, 255]);
  rCircle(-16, 144, 12, [255, 255, 255]);
  rCircle(18, 144, 12, [255, 255, 255]);
  rCircle(-13, 144, 5.5, [20, 20, 40]);
  rCircle(21, 144, 5.5, [20, 20, 40]);
  rCircle(-13, 144, 2, [120, 230, 255]);
  rCircle(21, 144, 2, [120, 230, 255]);
  // Antenna with glowing ball.
  rLine(0, 184, 0, 212, 5, [18, 14, 52]);
  rCircle(0, 220, 15, [255, 210, 90], 0.4);
  rCircle(0, 220, 9, [255, 210, 90]);
}

// ---- clouds, paper planes, text ----
function paintClouds(): void {
  const clouds: [number, number, number, number][] = [
    [300, 770, 130, 26], [560, 830, 160, 30], [830, 710, 110, 22], [680, 950, 150, 24],
  ];
  for (const [x, y, rx, ry] of clouds) {
    ellipse(x, y, rx, ry, [255, 150, 180], 0.20);
    ellipse(x - rx * 0.4, y - ry * 0.5, rx * 0.55, ry * 0.7, [255, 170, 200], 0.16);
  }
}
function paintPlanes(): void {
  const planes: [number, number, number][] = [[200, 230, 24], [330, 180, 18], [120, 360, 14]];
  for (const [x, y, s] of planes) {
    const p1 = rot(x + s, y, x, y, -0.7), p2 = rot(x - s * 0.7, y - s * 0.55, x, y, -0.7), p3 = rot(x - s * 0.4, y, x, y, -0.7), p4 = rot(x - s * 0.7, y + s * 0.55, x, y, -0.7);
    poly([p1, p2, p3, p4], [255, 255, 255], 0.95);
    line(x - s * 2.2, y + s * 0.5, x - s * 0.9, y + s * 0.2, 2, [255, 255, 255], 0.35);
  }
}
function paintText(): void {
  const head = 'I DREW THIS';
  drawText(head, 40, 64, 10, [255, 255, 255], [26, 10, 48]);
  rect(0, 905, W, 119, [26, 10, 48], 0.55);
  const foot = 'NO PROMPT. JUST CODE.';
  drawText(foot, (W - textWidth(foot, 5)) / 2, 928, 5, [255, 255, 255], [26, 10, 48]);
}

// ---- main ----
function main(): void {
  paintSky();
  paintClouds();
  paintTrail();
  paintPencil();
  paintStarburst();
  paintRobot();
  paintPlanes();
  paintText();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), encodePNG());
}
main();
