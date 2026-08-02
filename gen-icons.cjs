/**
 * gen-icons.cjs — マスターデザイン1点から全サイズのPNGを生成する（依存ライブラリなし）
 *
 * 使い方:  node gen-icons.cjs
 * 出力:    icon-180.png / icon-192.png / icon-512.png（同ディレクトリ）
 *
 * 仕様（モバイルアプリ技術要件定義書 5.3 準拠）
 *  - 座標はすべて size 比例で算出する（固定座標を使い回さない）
 *  - モチーフは中央70%のセーフゾーン内に収める（maskable のトリミング対策）
 *  - 標準モジュール zlib のみ使用。PNGエンコード・CRC32・描画は自前実装
 */

"use strict";
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

/* ================== デザイン定義（ここだけ差し替えれば別アプリに流用可） ================== */
const BG = [0x0e, 0x13, 0x19];               // 背景 #0E1319
const BARS = [                                // 時刻表の縦帯 = このアプリのシグネチャ
  { color: [0x4b, 0xa6, 0xf0], h: 0.86 },     // 英語   #4BA6F0
  { color: [0xb0, 0x88, 0xf7], h: 0.62 },     // 資格   #B088F7
  { color: [0xff, 0x6b, 0x7c], h: 1.00 },     // 身体   #FF6B7C
  { color: [0xff, 0xb1, 0x3d], h: 0.44 }      // 読書   #FFB13D
];
const SAFE = 0.70;   // セーフゾーン比率（中央70%にモチーフを収める）
const SIZES = [[180, "icon-180.png"], [192, "icon-192.png"], [512, "icon-512.png"]];
const SS = 4;        // スーパーサンプリング倍率（アンチエイリアス用）

/* ================== 描画 ================== */
function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r + 1e-9;
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  // 背景を不透明で塗る（ストア掲載・maskable ともに透過は避ける）
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = BG[0]; buf[i * 4 + 1] = BG[1]; buf[i * 4 + 2] = BG[2]; buf[i * 4 + 3] = 255;
  }

  // セーフゾーン（コンテンツ領域）を size 比例で算出
  const pad = size * (1 - SAFE) / 2;
  const cx0 = pad, cy0 = pad, cw = size - pad * 2, ch = size - pad * 2;
  const n = BARS.length;
  const bw = cw / (n * 2 - 1);          // 帯幅＝隙間幅
  const radius = bw * 0.42;

  const rects = BARS.map((b, i) => {
    const x0 = cx0 + i * bw * 2;
    const h = ch * b.h;
    const y1 = cy0 + ch;
    return { x0: x0, x1: x0 + bw, y0: y1 - h, y1: y1, r: radius, c: b.color };
  });

  const step = 1 / SS, off = step / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      for (let k = 0; k < rects.length; k++) {
        const R = rects[k];
        // バウンディングで早期スキップ
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
        for (let ch2 = 0; ch2 < 3; ch2++) {
          buf[o + ch2] = Math.round(buf[o + ch2] * (1 - a) + R.c[ch2] * a);
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
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // 各スキャンラインの先頭にフィルタバイト0を付与
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ================== 実行 ================== */
SIZES.forEach(function (s) {
  const size = s[0], name = s[1];
  const png = encodePNG(render(size), size);
  fs.writeFileSync(path.join(__dirname, name), png);
  console.log("生成: " + name + "  " + size + "x" + size + "  " + png.length + " bytes");
});
console.log("完了。マスターは icon.svg、PNGは本スクリプトで再生成できます。");
