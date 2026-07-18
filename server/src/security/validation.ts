import fs from 'node:fs';
import path from 'node:path';
import { fileTypeFromBuffer } from '../lib/magic.js';
import { config } from '../config.js';
import { badRequest, payloadTooLarge, unsupported } from '../lib/errors.js';
import { readFileHead } from '../lib/fingerprint.js';

const EXT_MIME: Record<string, string[]> = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.avif': ['image/avif'],
  '.gif': ['image/gif'],
  '.tif': ['image/tiff'],
  '.tiff': ['image/tiff'],
  '.bmp': ['image/bmp', 'image/x-ms-bmp'],
  '.ico': ['image/x-icon', 'image/vnd.microsoft.icon'],
  '.heic': ['image/heic', 'image/heif'],
  '.heif': ['image/heif', 'image/heic'],
  '.pdf': ['application/pdf'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
  '.tar': ['application/x-tar'],
  '.gz': ['application/gzip', 'application/x-gzip'],
  '.tgz': ['application/gzip', 'application/x-gzip'],
  '.bz2': ['application/x-bzip2'],
  '.xz': ['application/x-xz'],
  '.7z': ['application/x-7z-compressed'],
  '.mp3': ['audio/mpeg', 'audio/mp3'],
  '.wav': ['audio/wav', 'audio/wave', 'audio/x-wav'],
  '.flac': ['audio/flac', 'audio/x-flac'],
  '.ogg': ['audio/ogg', 'application/ogg'],
  '.opus': ['audio/opus', 'audio/ogg'],
  '.m4a': ['audio/mp4', 'audio/m4a', 'audio/x-m4a'],
  '.aac': ['audio/aac'],
  '.wma': ['audio/x-ms-wma'],
  '.mp4': ['video/mp4'],
  '.webm': ['video/webm'],
  '.mkv': ['video/x-matroska'],
  '.mov': ['video/quicktime'],
  '.avi': ['video/x-msvideo'],
  '.mpeg': ['video/mpeg'],
  '.mpg': ['video/mpeg'],
  '.wmv': ['video/x-ms-wmv'],
  '.m4v': ['video/x-m4v', 'video/mp4'],
  '.flv': ['video/x-flv'],
  '.json': ['application/json', 'text/json'],
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/plain'],
  '.html': ['text/html'],
  '.htm': ['text/html'],
  '.csv': ['text/csv', 'text/plain'],
  '.tsv': ['text/tab-separated-values', 'text/plain'],
  '.svg': ['image/svg+xml'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  '.odt': ['application/vnd.oasis.opendocument.text', 'application/zip'],
  '.rtf': ['application/rtf', 'text/rtf'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  '.ods': ['application/vnd.oasis.opendocument.spreadsheet', 'application/zip'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
  '.odp': ['application/vnd.oasis.opendocument.presentation', 'application/zip'],
  '.epub': ['application/epub+zip', 'application/zip'],
};

// Magic-byte signatures we accept without file-type (text-like / office without magic)
const TEXT_EXTS = new Set([
  '.txt', '.json', '.csv', '.tsv', '.md', '.svg', '.html', '.htm', '.rtf',
  '.css', '.js', '.ts',
]);
const OFFICE_EXTS = new Set([
  '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.epub',
]);

export type ValidatedFile = {
  originalName: string;
  ext: string;
  mime: string;
  size: number;
  path: string;
};

export function getExt(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function assertSize(size: number, max = config.maxUploadBytes): void {
  if (size > max) {
    throw payloadTooLarge(`File exceeds limit of ${max} bytes`);
  }
}

/**
 * Fast path validation using only extension + head magic bytes.
 * Never reads the full file body.
 */
export async function validateStoredFileQuick(
  filePath: string,
  originalName: string,
  declaredMime?: string,
  opts?: { size?: number; head?: Buffer },
): Promise<ValidatedFile & { head: Buffer }> {
  const size = opts?.size ?? fs.statSync(filePath).size;
  assertSize(size);
  if (size === 0) throw badRequest('Empty file rejected');

  const ext = getExt(originalName);
  if (!ext || (!EXT_MIME[ext] && !TEXT_EXTS.has(ext))) {
    if (!EXT_MIME[ext]) {
      throw unsupported(`Unsupported file extension: ${ext || '(none)'}`);
    }
  }

  const head = opts?.head ?? readFileHead(filePath, 4100);

  let detectedMime: string | undefined;
  try {
    const ft = await fileTypeFromBuffer(head);
    detectedMime = ft?.mime;
  } catch {
    detectedMime = undefined;
  }

  if (TEXT_EXTS.has(ext) && !detectedMime) {
    const sample = head.subarray(0, Math.min(512, head.length));
    if (sample.includes(0)) {
      throw unsupported('File content does not match text extension');
    }
    detectedMime = declaredMime || EXT_MIME[ext]?.[0] || 'text/plain';
  }

  const allowed = EXT_MIME[ext] || [];
  if (detectedMime && allowed.length && !allowed.includes(detectedMime)) {
    const looseOk =
      ((ext === '.jpg' || ext === '.jpeg') && detectedMime === 'image/jpeg') ||
      (ext === '.mp3' && detectedMime.startsWith('audio/')) ||
      (ext === '.m4a' && (detectedMime === 'audio/mp4' || detectedMime === 'video/mp4')) ||
      (OFFICE_EXTS.has(ext) &&
        (detectedMime === 'application/zip' ||
          detectedMime === 'application/x-zip-compressed' ||
          detectedMime.includes('openxmlformats') ||
          detectedMime.includes('opendocument'))) ||
      (ext === '.svg' && detectedMime.startsWith('image/'));
    if (!looseOk) {
      throw unsupported(
        `MIME/magic mismatch for ${ext}: detected ${detectedMime}`,
        { declaredMime, detectedMime, ext },
      );
    }
  }

  if (OFFICE_EXTS.has(ext) && !detectedMime) {
    detectedMime = declaredMime || EXT_MIME[ext]?.[0] || 'application/octet-stream';
  }

  if (ext === '.pdf') {
    if (head.length < 5 || head.subarray(0, 5).toString('utf8') !== '%PDF-') {
      throw unsupported('Corrupted or invalid PDF (bad magic bytes)');
    }
  }

  if (ext === '.zip') {
    if (!(head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b)) {
      throw unsupported('Corrupted or invalid ZIP (bad magic bytes)');
    }
  }

  return {
    originalName,
    ext,
    mime: detectedMime || declaredMime || allowed[0] || 'application/octet-stream',
    size,
    path: filePath,
    head,
  };
}

/** Full validation (still magic-from-file; used when quick path is unavailable). */
export async function validateStoredFile(
  filePath: string,
  originalName: string,
  declaredMime?: string,
): Promise<ValidatedFile> {
  const quick = await validateStoredFileQuick(filePath, originalName, declaredMime);
  // Drop head from public validated shape
  const { head: _head, ...rest } = quick;
  return rest;
}

export async function validateBufferMagic(buf: Buffer, _ext: string): Promise<string | undefined> {
  const ft = await fileTypeFromBuffer(buf);
  return ft?.mime;
}

/** Zip-slip safe path check for archive members */
export function assertSafeArchiveEntry(destRoot: string, entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.includes('\0') || path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw badRequest(`Unsafe archive entry rejected: ${entryName}`);
  }
  const target = path.resolve(destRoot, normalized);
  const root = path.resolve(destRoot) + path.sep;
  if (!target.startsWith(root) && target !== path.resolve(destRoot)) {
    throw badRequest(`Zip-slip path rejected: ${entryName}`);
  }
  return target;
}
