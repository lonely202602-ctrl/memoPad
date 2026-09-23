// 生成 LonelyCat × memoPad 应用图标（纯 Node，无第三方依赖）
// 设计：琥珀渐变圆角便签 = 猫脸；顶部双耳、眯眯眼、鼻嘴、三条待办线条
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const S = 1024;
const rgba = new Uint8Array(S * S * 4);

function put(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const na = a / 255, oa = rgba[i + 3] / 255;
  const outA = na + oa * (1 - na);
  if (outA <= 0) return;
  rgba[i] = Math.round((r * na + rgba[i] * oa * (1 - na)) / outA);
  rgba[i + 1] = Math.round((g * na + rgba[i + 1] * oa * (1 - na)) / outA);
  rgba[i + 2] = Math.round((b * na + rgba[i + 2] * oa * (1 - na)) / outA);
  rgba[i + 3] = Math.round(outA * 255);
}

const smooth = (t) => Math.max(0, Math.min(1, t));

function roundRectCoverage(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const d = Math.hypot(x - cx, y - cy) - r;
  return smooth(0.5 - d);
}

function barCoverage(x, y, bx0, by0, bx1, by1, br) {
  const cx = Math.max(bx0 + br, Math.min(x, bx1 - br));
  const cy = Math.max(by0 + br, Math.min(y, by1 - br));
  const d = Math.hypot(x - cx, y - cy) - br;
  return smooth(0.5 - d);
}

function circleCoverage(x, y, cx, cy, r) {
  return smooth(0.5 - (Math.hypot(x - cx, y - cy) - r));
}

// 点是否在三角形内（含边），统一绕向判断
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

const SUB = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

function triangleCoverage(x, y, ax, ay, bx, by, cx, cy) {
  let hit = 0;
  for (const [ox, oy] of SUB) if (inTriangle(x + ox, y + oy, ax, ay, bx, by, cx, cy)) hit++;
  return hit / SUB.length;
}

// ===== 1. 耳朵（画在最底层，脸部会盖住耳根） =====
const ears = [
  // [ax,ay, bx,by, cx,cy, r,g,b,a]
  [260, 150, 500, 150, 330, 15, 242, 183, 60, 255],
  [300, 140, 460, 140, 352, 50, 201, 128, 30, 235], // 内耳
  [524, 150, 764, 150, 694, 15, 242, 183, 60, 255],
  [564, 140, 724, 140, 672, 50, 201, 128, 30, 235],
];
for (let y = 0; y < 170; y++) {
  for (let x = 0; x < S; x++) {
    for (const [ax, ay, bx, by, cx, cy, r, g, b, a] of ears) {
      const c = triangleCoverage(x + 0.5, y + 0.5, ax, ay, bx, by, cx, cy);
      if (c > 0) put(x, y, r, g, b, c * a);
    }
  }
}

// ===== 2. 脸：圆角方形便签 + 琥珀渐变 + 顶部高光 =====
const FR = 140;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cov = roundRectCoverage(x + 0.5, y + 0.5, 90, 120, 934, 964, FR);
    if (cov <= 0) continue;
    const t = (y - 120) / 844;
    let r = Math.round(255 + (240 - 255) * t);
    let g = Math.round(215 + (165 - 215) * t);
    let b = Math.round(94 + (42 - 94) * t);
    if (y < 320) {
      const hl = smooth((320 - y) / 320) * 0.1;
      r = Math.round(r + (255 - r) * hl);
      g = Math.round(g + (255 - g) * hl);
      b = Math.round(b + (255 - b) * hl);
    }
    put(x, y, r, g, b, cov * 255);
  }
}

// ===== 3. 眯眯眼（描边弧线，用圆点沿贝塞尔采样） =====
function stampCircle(x, y, r, cr, cg, cb, ca) {
  const x0 = Math.max(0, Math.floor(x - r) - 1), x1 = Math.min(S - 1, Math.ceil(x + r) + 1);
  const y0 = Math.max(0, Math.floor(y - r) - 1), y1 = Math.min(S - 1, Math.ceil(y + r) + 1);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const c = circleCoverage(xx + 0.5, yy + 0.5, x, y, r);
      if (c > 0) put(xx, yy, cr, cg, cb, c * ca);
    }
  }
}

function strokeQuad(p0, p1, p2, width, cr, cg, cb, ca) {
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    stampCircle(x, y, width, cr, cg, cb, ca);
  }
}

const DARK = [92, 58, 0];
strokeQuad([300, 468], [372, 398], [444, 468], 17, ...DARK, 255);
strokeQuad([580, 468], [652, 398], [724, 468], 17, ...DARK, 255);

// ===== 4. 鼻子 + 嘴 =====
for (let y = 560; y < 660; y++) {
  for (let x = 440; x < 584; x++) {
    const c = triangleCoverage(x + 0.5, y + 0.5, 466, 588, 558, 588, 512, 655);
    if (c > 0) put(x, y, ...DARK, c * 255);
  }
}
strokeQuad([512, 655], [474, 706], [452, 668], 13, ...DARK, 255);
strokeQuad([512, 655], [550, 706], [572, 668], 13, ...DARK, 255);

// ===== 5. 三条待办线条（白） =====
const bars = [
  [300, 742, 724, 50, 255, 255, 255, 235],
  [300, 826, 620, 50, 255, 255, 255, 228],
  [300, 910, 672, 50, 255, 255, 255, 205],
];
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    for (const [bx0, by0, bx1, h, r, g, b, a] of bars) {
      const c = barCoverage(x + 0.5, y + 0.5, bx0, by0, bx1, by0 + h, h / 2);
      if (c > 0) put(x, y, r, g, b, c * a);
    }
  }
}

// ===== PNG 编码 =====
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(rgba.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "app-icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log("icon written:", out, png.length, "bytes");
