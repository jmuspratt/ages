#!/usr/bin/env node
// Generates app/icon-192.png and app/icon-512.png from scratch — three bars of
// increasing height, one per kid, on a dark ground. Written as a raw RGBA
// buffer and encoded with Node's built-in zlib so the project keeps its
// zero-dependency promise (no canvas, no sharp, no SVG rasterizer).
// Usage: npm run icons

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "app");

const BG = [17, 24, 39, 255]; // #111827
const BAR = [243, 244, 246, 255]; // #f3f4f6
const BAR_TALL = [10, 132, 255, 255]; // #0a84ff — the accent, on the eldest bar

// Bar heights as a fraction of the icon, shortest to tallest.
const BAR_HEIGHTS = [0.3, 0.44, 0.58];
const BAR_WIDTH = 0.13;
const BAR_GAP = 0.075;
const BASELINE = 0.76;

function crcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // bytes 10-12 stay zero: deflate compression, adaptive filtering, no interlace

  // Each scanline is prefixed with its filter byte (0 = none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    pixels.set(BG, i * 4);
  }

  const barW = Math.round(size * BAR_WIDTH);
  const gap = Math.round(size * BAR_GAP);
  const groupW = BAR_HEIGHTS.length * barW + (BAR_HEIGHTS.length - 1) * gap;
  const left = Math.round((size - groupW) / 2);
  const baseline = Math.round(size * BASELINE);
  const radius = Math.round(barW / 2);

  BAR_HEIGHTS.forEach((h, i) => {
    const color = i === BAR_HEIGHTS.length - 1 ? BAR_TALL : BAR;
    const x0 = left + i * (barW + gap);
    const top = baseline - Math.round(size * h);

    for (let y = top; y < baseline; y++) {
      for (let x = x0; x < x0 + barW; x++) {
        // Round off the top corners so the bars read as capsules, not blocks.
        const dy = top + radius - y;
        if (dy > 0) {
          const dx = Math.abs(x - (x0 + barW / 2 - 0.5));
          if (dx * dx + dy * dy > radius * radius) continue;
        }
        pixels.set(color, (y * size + x) * 4);
      }
    }
  });

  return pixels;
}

for (const size of [192, 512]) {
  const out = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(out, encodePNG(size, drawIcon(size)));
  console.log(`Wrote ${out}`);
}
