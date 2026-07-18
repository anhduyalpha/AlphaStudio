/**
 * Streaming-friendly fingerprints and checksums for the upload hot path.
 * Quick fingerprint is NOT a full-file hash — use streamChecksum for that.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Bytes from head and tail used for quick fingerprint. */
export const FINGERPRINT_WINDOW = 64 * 1024;

/** Bytes typically sufficient for file-type magic sniffing. */
export const MAGIC_HEAD_BYTES = 4100;

/**
 * Read only the first `nBytes` of a file (for magic / MIME sniffing).
 * Does not load the full file into memory.
 */
export function readFileHead(filePath: string, nBytes: number = MAGIC_HEAD_BYTES): Buffer {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const size = fs.statSync(filePath).size;
  const len = Math.min(Math.max(0, nBytes), size);
  if (len <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, len, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Quick content fingerprint: size + first/last N bytes (SHA-256 hex).
 * Suitable for early dedupe hints — not a cryptographic full-file checksum.
 */
export function quickFingerprint(filePath: string, size?: number): string {
  const fileSize = size ?? fs.statSync(filePath).size;
  const window = FINGERPRINT_WINDOW;
  const fd = fs.openSync(filePath, 'r');
  try {
    const headLen = Math.min(window, fileSize);
    const head = Buffer.alloc(headLen);
    if (headLen > 0) fs.readSync(fd, head, 0, headLen, 0);

    let tail = Buffer.alloc(0);
    if (fileSize > headLen) {
      // Non-overlapping tail region only (avoid double-counting small files)
      const tailLen = Math.min(window, fileSize - headLen);
      const offset = fileSize - tailLen;
      if (tailLen > 0 && offset >= headLen) {
        tail = Buffer.alloc(tailLen);
        fs.readSync(fd, tail, 0, tailLen, offset);
      } else if (fileSize > headLen) {
        const from = headLen;
        const len = fileSize - from;
        if (len > 0) {
          tail = Buffer.alloc(len);
          fs.readSync(fd, tail, 0, len, from);
        }
      }
    }

    const hash = createHash('sha256');
    hash.update(`size:${fileSize}|`);
    hash.update(head);
    hash.update('|');
    hash.update(tail);
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Full-file SHA-256 via streaming — never buffers the entire file in memory.
 */
export function streamChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Sync full-file SHA-256 in chunks (no single giant Buffer allocation).
 * Prefer streamChecksum on async hot paths.
 */
export function checksumFileChunked(filePath: string, chunkSize = 1024 * 1024): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(chunkSize, Math.max(size, 1)));
    let offset = 0;
    while (offset < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - offset), offset);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
      offset += n;
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

/** Stable key for early fingerprint-based cache lookups. */
export function fingerprintKey(size: number, fingerprint: string): string {
  return `${size}:${fingerprint}`;
}
