'use strict';

function isWebP(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  if (!['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return false;
  let offset = 12, hasImage = false;
  // RIFF chunks include a padding byte after odd-sized payloads.
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return false;
    const kind = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end + size % 2 > bytes.length) return false;
    if (['VP8 ', 'VP8L', 'ANMF'].includes(kind) && size > 0) hasImage = true;
    offset = end + size % 2;
  }
  return hasImage;
}

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (isWebP(bytes)) return 'image/webp';
  throw new Error('图片只支持经文件头核实的 PNG/JPEG/WebP');
}

module.exports = { imageMime };
