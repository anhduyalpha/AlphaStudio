/**
 * Checksum + file-identity helpers for tool download / cache verification.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

/** @param {string} filePath @param {'sha256'|'sha1'|'md5'} [algo] */
export function hashFile(filePath, algo = 'sha256') {
  const hash = crypto.createHash(algo);
  // Stream for large binaries (ffmpeg/LO-related can be multi-MB)
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Cheap file identity: size + mtime. Used to skip re-hash / re-probe when unchanged.
 * @returns {{ size: number, mtimeMs: number } | null}
 */
export function fileIdentity(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    if (!st.isFile()) return null;
    return { size: st.size, mtimeMs: Math.trunc(st.mtimeMs) };
  } catch {
    return null;
  }
}

/**
 * True when on-disk file still matches stored size+mtime (and optional checksum).
 * @param {string} filePath
 * @param {{ size?: number, mtimeMs?: number, checksum?: string }} stored
 * @param {{ verifyChecksum?: boolean, algo?: string }} [opts]
 */
export function matchesIdentity(filePath, stored, opts = {}) {
  if (!stored) return false;
  const id = fileIdentity(filePath);
  if (!id) return false;
  if (stored.size != null && Number(stored.size) !== id.size) return false;
  if (stored.mtimeMs != null && Number(stored.mtimeMs) !== id.mtimeMs) return false;
  if (opts.verifyChecksum && stored.checksum) {
    const v = verifyChecksum(filePath, stored.checksum, opts.algo || 'sha256');
    return v.ok;
  }
  return true;
}

/**
 * Verify file against expected hex digest (case-insensitive).
 * Accepts bare hex or `sha256:<hex>` prefix.
 * @returns {{ ok: boolean, actual: string, expected: string, skipped?: boolean }}
 */
export function verifyChecksum(filePath, expected, algo = 'sha256') {
  if (!expected) {
    return { ok: true, actual: '', expected: '', skipped: true };
  }
  const actual = hashFile(filePath, algo);
  const ok = actual.toLowerCase() === String(expected).toLowerCase().replace(/^sha256:/i, '');
  return { ok, actual, expected: String(expected) };
}

export function hashString(s, algo = 'sha256') {
  return crypto.createHash(algo).update(String(s)).digest('hex');
}
