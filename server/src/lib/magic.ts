import fs from 'node:fs';

export type MagicType = { ext: string; mime: string };

function ascii(buf: Uint8Array, start: number, end: number): string {
  return Buffer.from(buf.subarray(start, end)).toString('ascii');
}

function starts(buf: Uint8Array, bytes: number[]): boolean {
  return bytes.every((value, index) => buf[index] === value);
}

/**
 * Bounded, non-decompressing magic-byte detection for AlphaStudio's supported
 * formats. It deliberately avoids archive/container parsing, so malformed user
 * files cannot trigger unbounded parser loops or ZIP decompression bombs.
 */
export async function fileTypeFromBuffer(input: Uint8Array): Promise<MagicType | undefined> {
  const buf = input instanceof Buffer ? input : Buffer.from(input);
  if (buf.length < 2) return undefined;

  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (starts(buf, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' };
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') {
    return { ext: 'gif', mime: 'image/gif' };
  }
  if (starts(buf, [0x49, 0x49, 0x2a, 0x00]) || starts(buf, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { ext: 'tif', mime: 'image/tiff' };
  }
  if (ascii(buf, 0, 2) === 'BM') return { ext: 'bmp', mime: 'image/bmp' };
  if (starts(buf, [0x00, 0x00, 0x01, 0x00])) return { ext: 'ico', mime: 'image/x-icon' };
  if (ascii(buf, 0, 5) === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };

  if (
    starts(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    starts(buf, [0x50, 0x4b, 0x05, 0x06]) ||
    starts(buf, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return { ext: 'zip', mime: 'application/zip' };
  }
  if (starts(buf, [0x1f, 0x8b, 0x08])) return { ext: 'gz', mime: 'application/gzip' };
  if (ascii(buf, 0, 3) === 'BZh') return { ext: 'bz2', mime: 'application/x-bzip2' };
  if (starts(buf, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) {
    return { ext: 'xz', mime: 'application/x-xz' };
  }
  if (starts(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { ext: '7z', mime: 'application/x-7z-compressed' };
  }

  if (ascii(buf, 0, 4) === 'RIFF' && buf.length >= 12) {
    const kind = ascii(buf, 8, 12);
    if (kind === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
    if (kind === 'WAVE') return { ext: 'wav', mime: 'audio/wav' };
    if (kind === 'AVI ') return { ext: 'avi', mime: 'video/x-msvideo' };
  }
  if (ascii(buf, 0, 4) === 'fLaC') return { ext: 'flac', mime: 'audio/flac' };
  if (ascii(buf, 0, 4) === 'OggS') {
    const sample = ascii(buf, 0, Math.min(buf.length, 128));
    if (sample.includes('OpusHead')) return { ext: 'opus', mime: 'audio/opus' };
    return { ext: 'ogg', mime: 'audio/ogg' };
  }
  if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  if (ascii(buf, 0, 4) === 'MThd') return { ext: 'mid', mime: 'audio/midi' };
  if (ascii(buf, 0, 4) === 'FLV\x01') return { ext: 'flv', mime: 'video/x-flv' };
  if (starts(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    const sample = ascii(buf, 0, Math.min(buf.length, 4096)).toLowerCase();
    if (sample.includes('webm')) return { ext: 'webm', mime: 'video/webm' };
    return { ext: 'mkv', mime: 'video/x-matroska' };
  }
  if (starts(buf, [0x00, 0x00, 0x01, 0xba]) || starts(buf, [0x00, 0x00, 0x01, 0xb3])) {
    return { ext: 'mpg', mime: 'video/mpeg' };
  }

  // ISO BMFF (MP4/MOV/M4A/AVIF/HEIF). Brand inspection is fixed-offset only.
  if (buf.length >= 12 && ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return { ext: 'avif', mime: 'image/avif' };
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) {
      return { ext: brand === 'mif1' || brand === 'msf1' ? 'heif' : 'heic', mime: 'image/heic' };
    }
    if (brand.startsWith('qt')) return { ext: 'mov', mime: 'video/quicktime' };
    if (/^(m4a|m4b|f4a)/.test(brand)) return { ext: 'm4a', mime: 'audio/mp4' };
    return { ext: 'mp4', mime: 'video/mp4' };
  }

  // AAC ADTS frame sync. Check after MP3 because both use an FF-prefixed sync.
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return { ext: 'aac', mime: 'audio/aac' };

  return undefined;
}

export async function fileTypeFromFile(filePath: string): Promise<MagicType | undefined> {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const out = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    if (out.length) fs.readSync(fd, out, 0, out.length, 0);
    return fileTypeFromBuffer(out);
  } finally {
    fs.closeSync(fd);
  }
}
