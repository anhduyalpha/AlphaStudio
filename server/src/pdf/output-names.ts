/**
 * User-facing download names derived from original file + operation.
 * Internal storage still uses randomServerName; only outputName is for Content-Disposition.
 *
 * Pattern: <base>-<action-suffix><ext>
 * e.g. abc.pdf → abc-merged.pdf ; report.final.v2.pdf → report.final.v2-merged.pdf
 */
import path from 'node:path';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const UNSAFE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_BASE = 120;
const MAX_TOTAL = 180;

function truncateCodePoints(value: string, maxLen: number): string {
  return Array.from(value).slice(0, Math.max(0, maxLen)).join('');
}

function replaceUnpairedSurrogates(value: string): string {
  return Array.from(value, (character) => {
    if (character.length !== 1) return character;
    const unit = character.charCodeAt(0);
    return unit >= 0xd800 && unit <= 0xdfff ? '_' : character;
  }).join('');
}

/** Known action suffixes — stripped from base to avoid double-suffix on re-process */
const KNOWN_ACTION_SUFFIXES = [
  'merged',
  'split',
  'rotated',
  'reordered',
  'pages-deleted',
  'pages-duplicated',
  'optimized',
  'compressed',
  'repaired',
  'decrypted',
  'ocr',
  'text',
  'inspection',
  'to-pdf',
  'deleted-pages', // legacy
  'duplicated', // legacy
  'inspect', // legacy
  'pages', // legacy zip
];

export type OutputNameOptions = {
  /** Original client filename (may include path-like noise) */
  originalName?: string;
  /** Operation suffix without extension, e.g. "merged", "pages-1-5" */
  suffix: string;
  /** Extension including dot, e.g. ".pdf", ".zip", ".txt" */
  ext: string;
  /** Fallback base when original is missing */
  fallbackBase?: string;
};

/**
 * Sanitize a single path segment for safe cross-platform download names.
 * Preserves Unicode letters/numbers when present; strips Windows-forbidden chars.
 * Preserves normal spaces (collapsed).
 */
export function sanitizeFilenameSegment(raw: string, maxLen = MAX_BASE): string {
  let s = String(raw || '')
    .normalize('NFC')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || '';
  s = s.replace(UNSAFE_CHARS, '_').replace(/\s+/g, ' ').trim();
  // Strip trailing dots/spaces (Windows)
  s = s.replace(/[. ]+$/g, '');
  if (!s || WINDOWS_RESERVED.test(s)) s = 'document';
  if (Array.from(s).length > maxLen) s = truncateCodePoints(s, maxLen).replace(/[. ]+$/g, '');
  return s || 'document';
}

/**
 * Remove only the final extension; preserve dots inside the base
 * (report.final.v2.pdf → report.final.v2).
 */
export function stripFinalExtension(filename: string): string {
  const base = path.basename(String(filename || ''));
  const ext = path.extname(base);
  if (!ext) return base;
  return base.slice(0, base.length - ext.length);
}

/** Strip a trailing known action suffix from a base to avoid double-suffix. */
export function stripKnownActionSuffix(base: string): string {
  let b = base;
  for (const suf of KNOWN_ACTION_SUFFIXES) {
    const re = new RegExp(`-${suf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (re.test(b)) {
      b = b.replace(re, '');
      break;
    }
  }
  // Also strip pages-<range> style
  b = b.replace(/-pages-[a-zA-Z0-9_,\-]+$/i, '');
  b = b.replace(/-page-\d+$/i, '');
  return b || base;
}

/** Base name without final extension, sanitized, double-suffix avoided. */
export function baseFromOriginal(originalName?: string, fallback = 'document'): string {
  const name = originalName && originalName.trim() ? originalName : fallback;
  const withoutExt = stripFinalExtension(name);
  const stripped = stripKnownActionSuffix(withoutExt);
  return sanitizeFilenameSegment(stripped || fallback);
}

/**
 * Build a user-facing output name like `report-merged.pdf` or `report-pages-1-5.pdf`.
 */
export function buildOutputName(opts: OutputNameOptions): string {
  const base = baseFromOriginal(opts.originalName, opts.fallbackBase || 'document');
  const rawSuffix = String(opts.suffix || '').replace(/^\-+/, '').trim();
  const suffix = rawSuffix ? sanitizeFilenameSegment(rawSuffix, 60) : '';
  let ext = opts.ext.startsWith('.') ? opts.ext.toLowerCase() : `.${opts.ext.toLowerCase()}`;
  // normalize jpeg
  if (ext === '.jpeg') ext = '.jpg';
  let name = suffix ? `${base}-${suffix}${ext}` : `${base}${ext}`;
  if (Array.from(name).length > MAX_TOTAL) {
    const suffixLength = Math.min(Array.from(suffix).length, 40);
    const keep = MAX_TOTAL - Array.from(ext).length - 1 - suffixLength;
    const shortBase = truncateCodePoints(base, Math.max(8, keep));
    name = suffix ? `${shortBase}-${truncateCodePoints(suffix, 40)}${ext}` : `${shortBase}${ext}`;
  }
  // Final path-traversal / absolute path rejection
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return `document-${suffix || 'output'}${ext}`;
  }
  return name;
}

/**
 * RFC 5987 Content-Disposition value: ASCII fallback + UTF-8 filename*.
 */
export function contentDispositionAttachment(outputName: string): string {
  const raw = replaceUnpairedSurrogates(String(outputName || 'download').replace(/[\r\n"]/g, ''));
  const ascii = raw.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(raw)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Convenience builders — suffixes match product OBJECTIVE table */
export const OutputNames = {
  merged: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'merged', ext: '.pdf' }),
  splitZip: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'split', ext: '.zip' }),
  rotated: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'rotated', ext: '.pdf' }),
  reordered: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'reordered', ext: '.pdf' }),
  extracted: (original: string | undefined, rangeLabel: string) =>
    buildOutputName({
      originalName: original,
      suffix: `pages-${sanitizeFilenameSegment(rangeLabel, 40)}`,
      ext: '.pdf',
    }),
  deleted: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'pages-deleted', ext: '.pdf' }),
  duplicated: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'pages-duplicated', ext: '.pdf' }),
  compressed: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'compressed', ext: '.pdf' }),
  optimized: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'optimized', ext: '.pdf' }),
  repaired: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'repaired', ext: '.pdf' }),
  decrypted: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'decrypted', ext: '.pdf' }),
  /** Images → PDF: use first image original name */
  imagesToPdf: (original?: string) =>
    buildOutputName({
      originalName: original || 'images',
      suffix: 'to-pdf',
      ext: '.pdf',
      fallbackBase: 'images',
    }),
  text: (original?: string) => {
    return buildOutputName({ originalName: original, suffix: 'text', ext: '.txt' });
  },
  ocrText: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'ocr', ext: '.txt' }),
  ocrPdf: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'ocr', ext: '.pdf' }),
  inspect: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'inspection', ext: '.json' }),
  pageImage: (original: string | undefined, pageNo: number, ext: string) =>
    buildOutputName({
      originalName: original,
      suffix: `page-${Math.max(1, Math.floor(pageNo))}`,
      ext,
    }),
  pageImagesZip: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'pages', ext: '.zip' }),
};
