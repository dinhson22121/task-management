import fs from 'fs';
import path from 'path';

const dir = import.meta.dirname;
const sizes = [16, 32, 48, 64, 128, 256];
const pngPaths = {
  16: 'icon.iconset/icon_16x16.png',
  32: 'icon.iconset/icon_32x32.png',
  48: 'icon.iconset/icon_48x48.png',
  64: 'icon.iconset/icon_32x32@2x.png',
  128: 'icon.iconset/icon_128x128.png',
  256: 'icon.iconset/icon_256x256.png',
};

const buffers = sizes.map((size) => {
  const p = pngPaths[size];
  if (!p) return null;
  return fs.readFileSync(path.join(dir, p));
});

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;
const headerSize = ICONDIR_SIZE + ICONDIRENTRY_SIZE * buffers.filter(Boolean).length;

const validEntries = sizes.map((size, i) => ({ size, buf: buffers[i] })).filter((e) => e.buf);

const iconDir = Buffer.alloc(ICONDIR_SIZE);
iconDir.writeUInt16LE(0, 0); // reserved
iconDir.writeUInt16LE(1, 2); // type: 1 = icon
iconDir.writeUInt16LE(validEntries.length, 4);

let offset = headerSize;
const dirEntries = [];
const dataChunks = [];
for (const { size, buf } of validEntries) {
  const entry = Buffer.alloc(ICONDIRENTRY_SIZE);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
  entry.writeUInt8(0, 2); // color palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(buf.length, 8); // size of image data
  entry.writeUInt32LE(offset, 12); // offset of image data
  dirEntries.push(entry);
  dataChunks.push(buf);
  offset += buf.length;
}

const ico = Buffer.concat([iconDir, ...dirEntries, ...dataChunks]);
fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
console.log(`Wrote icon.ico with sizes: ${validEntries.map((e) => e.size).join(', ')}`);
