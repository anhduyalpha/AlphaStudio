/**
 * User-facing download names derived from original file + operation.
 * Internal storage still uses randomServerName; only outputName is for Content-Disposition.
 */
import path from 'node:path';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const UNSAFE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_BASE = 120;
const MAX_TOTAL = 180;

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
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[. ]+$/g, '');
  return s || 'document';
}

/** Base name without extension, sanitized. */
export function baseFromOriginal(originalName?: string, fallback = 'document'): string {
  const name = originalName && originalName.trim() ? originalName : fallback;
  const base = path.basename(name, path.extname(name));
  return sanitizeFilenameSegment(base || fallback);
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
  if (name.length > MAX_TOTAL) {
    const keep = MAX_TOTAL - ext.length - 1 - Math.min(suffix.length, 40);
    const shortBase = base.slice(0, Math.max(8, keep));
    name = `${shortBase}-${suffix.slice(0, 40)}${ext}`;
  }
  // Final path-traversal / absolute path rejection
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return `document-${suffix || 'output'}${ext}`;
  }
  return name;
}

/** Convenience builders */
export const OutputNames = {
  merged: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'merged', ext: '.pdf' }),
  splitZip: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'pages', ext: '.zip' }),
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
    buildOutputName({ originalName: original, suffix: 'deleted-pages', ext: '.pdf' }),
  duplicated: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'duplicated', ext: '.pdf' }),
  compressed: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'compressed', ext: '.pdf' }),
  optimized: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'optimized', ext: '.pdf' }),
  repaired: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'repaired', ext: '.pdf' }),
  imagesToPdf: () =>
    buildOutputName({ originalName: 'images', suffix: 'to-pdf', ext: '.pdf', fallbackBase: 'images' }),
  text: (original?: string) => {
    const base = baseFromOriginal(original, 'document');
    return `${base}.txt`.slice(0, MAX_TOTAL);
  },
  ocrText: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'ocr', ext: '.txt' }),
  inspect: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'inspect', ext: '.json' }),
  pageImage: (original: string | undefined, ext: string) =>
    buildOutputName({ originalName: original, suffix: '', ext }),
  pageImagesZip: (original?: string) =>
    buildOutputName({ originalName: original, suffix: 'pages', ext: '.zip' }),
};
