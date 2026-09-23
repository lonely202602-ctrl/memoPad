// 纯 Node 生成 memoPad 应用图标（无第三方依赖），输出 1024x1024 PNG
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const S = 1024;
const rgba = new Uint8Array(S * S * 4);

function put(x, y, r, g, b, a) {
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

// 圆角方形遮罩（带 2px 抗锯齿）
const R = 200;
function roundRectCoverage(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - cx, dy = y - cy;
  const d = Math.hypot(dx, dy) - r;
  return smooth(0.5 - d);
}

function barCoverage(x, y, bx0, by0, bx1, by1, br) {
  const cx = Math.max(bx0 + br, Math.min(x, bx1 - br));
  const cy = Math.max(by0 + br, Math.min(y, by1 - br));
  const d = Math.hypot(x - cx, y - cy) - br;
  return smooth(0.5 - d);
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cov = roundRectCoverage(x + 0.5, y + 0.5, 0, 0, S, S, R);
    if (cov <= 0) continue;
    // 便签纸琥珀色渐变
    const t = y / S;
    let r = Math.round(255 + (242 - 255) * t);
    let g = Math.round(215 + (158 - 215) * t);
    let b = Math.round(94 + (28 - 94) * t);
    // 顶部高光
    if (y < 300) {
      const hl = smooth((300 - y) / 300) * 0.10;
      r = Math.round(r + (255 - r) * hl);
      g = Math.round(g + (255 - g) * hl);
      b = Math.round(b + (255 - b) * hl);
    }
    put(x, y, r, g, b, cov * 255);
  }
}

// 三条“待办”横线（白），第二条带勾选感：前段为深色圆点
const bars = [
  [250, 400, 790, 62, 255, 255, 255, 235],
  [250, 545, 560, 62, 255, 255, 255, 235],
  [250, 690, 700, 62, 255, 255, 255, 210],
];
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    for (const [bx0, by0, bx1, h, r, g, b, a] of bars) {
      const c = barCoverage(x + 0.5, y + 0.5, bx0, by0, bx1, by0 + h, h / 2);
      if (c > 0) put(x, y, r, g, b, c * a);
    }
  }
}
// 第一条前的勾选圆点
for (let y = 330; y < 500; y++) {
  for (let x = 60; x < 240; x++) {
    const c = barCoverage(x + 0.5, y + 0.5, 80, 370, 200, 490, 60);
    if (c > 0) put(x, y, 255, 255, 255, c * 235);
  }
}

// ---- PNG 编码 ----
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
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter none
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
