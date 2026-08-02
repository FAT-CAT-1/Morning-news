/**
 * gen-icons.cjs — 朝ニュースのアイコンを生成する（依存ライブラリなし）
 *
 * 使い方:  node news/gen-icons.cjs
 * 出力:    news/icon-180.png / icon-192.png / icon-512.png
 *
 * ルートの gen-icons.cjs（夏休みダイヤ＝縦帯）と同じ描画エンジンを使い、
 * デザイン定義だけを差し替えている。
 * 朝ニュースは「見出しが並んでいる」形にしたいので横帯にした。
 * ホーム画面に2つ並んだとき、縦帯か横帯かで一目で見分けられる。
 */

"use strict";
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

/* ================== デザイン定義 ================== */
const BG = [0x0e, 0x13, 0x19];                    // 背景 #0E1319（夏休みダイヤと共通）
const BARS = [                                     // 横帯＝見出しの行。色は分野色に対応
  { color: [0x6e, 0xe0, 0x7a], w: 1.00 },          // ドローン   #6EE07A
  { color: [0xb0, 0x88, 0xf7], w: 0.70 },          // AI技術     #B088F7
  { color: [0x4b, 0xa6, 0xf0], w: 0.88 },          // 世界情勢   #4BA6F0
  { color: [0xff, 0xb1, 0x3d], w: 0.55 },          // 国内政治   #FFB13D
  { color: [0xf5, 0xd7, 0x6e], w: 0.78 },          // 物価・株価 #F5D76E
];
const SAFE = 0.70;   // セーフゾーン比率（maskable のトリミング対策）
const SIZES = [[180, "icon-180.png"], [192, "icon-192.png"], [512, "icon-512.png"]];
const SS = 4;        // スーパーサンプリング倍率

/* ================== 描画 ================== */
function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r + 1e-9;
}

function layout(size) {
  const pad = size * (1 - SAFE) / 2;
  const cx0 = pad, cy0 = pad, cw = size - pad * 2, ch = size - pad * 2;
  const n = BARS.length;
  const bh = ch / (n * 2 - 1);          // 帯の高さ＝隙間の高さ
  const radius = bh * 0.42;
  return BARS.map((b, i) => {
    const y0 = cy0 + i * bh * 2;
    return { x0: cx0, x1: cx0 + cw * b.w, y0: y0, y1: y0 + bh, r: radius, c: b.color };
  });
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = BG[0]; buf[i * 4 + 1] = BG[1]; buf[i * 4 + 2] = BG[2]; buf[i * 4 + 3] = 255;
  }
  const rects = layout(size);
  const step = 1 / SS, off = step / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      for (let k = 0; k < rects.length; k++) {
        const R = rects[k];
        if (px + 1 < R.x0 || px > R.x1 || py + 1 < R.y0 || py > R.y1) continue;
        let hit = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const x = px + off + sx * step, y = py + off + sy * step;
            if (insideRoundRect(x, y, R.x0, R.y0, R.x1, R.y1, R.r)) hit++;
          }
        }
        if (!hit) continue;
        const a = hit / (SS * SS);
        const o = (py * size + px) * 4;
        for (let c = 0; c < 3; c++) {
          buf[o + c] = Math.round(buf[o + c] * (1 - a) + R.c[c] * a);
        }
      }
    }
  }
  return buf;
}

/* ================== PNGエンコード ================== */
const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ================== SVG（マスター） ================== */
function writeSvg() {
  const S = 512;
  const rects = layout(S).map((R, i) =>
    `  <rect x="${R.x0.toFixed(1)}" y="${R.y0.toFixed(1)}" width="${(R.x1 - R.x0).toFixed(1)}" height="${(R.y1 - R.y0).toFixed(1)}" rx="${R.r.toFixed(1)}" fill="${"#" + BARS[i].color.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase()}"/>`
  ).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="朝ニュース">
  <rect width="512" height="512" fill="#0E1319"/>
  <g>
${rects}
  </g>
</svg>
`;
  fs.writeFileSync(path.join(__dirname, "icon.svg"), svg, "utf8");
  console.log("生成: icon.svg");
}

/* ================== 実行 ================== */
SIZES.forEach(function (s) {
  const size = s[0], name = s[1];
  const png = encodePNG(render(size), size);
  fs.writeFileSync(path.join(__dirname, name), png);
  console.log("生成: " + name + "  " + size + "x" + size + "  " + png.length + " bytes");
});
writeSvg();
console.log("完了。デザインを変えるときは上部の BARS を編集して再実行する。");
