'use strict';

// Pure (no Electron dependency) generator for the app's sticky-note-stack icon,
// shared by main.js (tray/window icons at runtime) and scripts/build-icon.js
// (a build-time PNG asset for electron-builder to convert into .ico/.icns).
//
// Electron's nativeImage only decodes raster formats (PNG/JPEG/BMP) — it
// cannot rasterize an <svg> data URL, so the icon has to be real pixels. We
// draw it as simple geometric tests on a 32x32 logical grid and encode a PNG
// buffer with Node's built-in zlib (no image-processing dependency needed).

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// A little stack of sticky notes with a folded corner and a couple of
// "text" lines. Shapes are defined on a 32x32 logical grid and rasterized
// directly at the requested pixel size, so it stays crisp both as a small
// tray icon and as a large taskbar/window/app icon.
const NOTE_COLORS = {
  back: [0xff, 0xe2, 0x7a, 0xff],
  front: [0xff, 0xd9, 0x4a, 0xff],
  fold: [0xe8, 0xbe, 0x2f, 0xff],
  line: [0xb5, 0x8e, 0x00, 0xff]
};

function noteColorAt(lx, ly) {
  // Folded corner (dog-ear) cut from the front note's bottom-right corner.
  if (lx >= 16 && lx <= 24 && ly >= 22 && ly <= 30 && (lx + ly) >= 46) return NOTE_COLORS.fold;
  // "Text" lines on the front note.
  if (lx >= 6 && lx <= 20 && ((ly >= 15.2 && ly <= 16.8) || (ly >= 19.2 && ly <= 20.8))) return NOTE_COLORS.line;
  // Front note (drawn after the fold/line tests so those sit "on top").
  if (lx >= 2 && lx <= 24 && ly >= 8 && ly <= 30) return NOTE_COLORS.front;
  // Back note, offset up-right to read as a small stack.
  if (lx >= 8 && lx <= 30 && ly >= 2 && ly <= 24) return NOTE_COLORS.back;
  return null;
}

function noteIconPNG(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = 32 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const color = noteColorAt((px + 0.5) * scale, (py + 0.5) * scale);
      const i = (py * size + px) * 4;
      if (color) {
        rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = color[3];
      } else {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
      }
    }
  }
  return encodePNG(size, size, rgba);
}

module.exports = { noteIconPNG };
