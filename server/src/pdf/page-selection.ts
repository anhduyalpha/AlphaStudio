/**
 * Shared one-based page selection parser → zero-based indices.
 *
 * Supported tokens (comma-separated combinations allowed):
 *   1 | 1,3,5 | 1-3 | 1- | -5 | all | odd | even | last | 1-3,7,10-
 *
 * Rules:
 * - UI stays one-based; backend indices are zero-based.
 * - Invalid syntax throws PAGE_RANGE_INVALID (never silent ignore).
 * - Pages outside 1..pageCount throw PAGE_OUT_OF_RANGE.
 * - Duplicates removed when dedupe=true (default); order preserved for first occurrence.
 * - When dedupe=false, intentional duplicates are kept (duplicate-pages / reorder allowDuplicates).
 */
import { pdfError } from './errors.js';

export type ParsePagesOptions = {
  /** Remove duplicate indices while preserving first-seen order. Default true. */
  dedupe?: boolean;
  /** Empty / missing spec means all pages. Default true. */
  emptyMeansAll?: boolean;
};

/**
 * Parse a page selection into zero-based indices.
 */
export function parsePageSelection(
  spec: unknown,
  pageCount: number,
  options: ParsePagesOptions = {},
): number[] {
  const dedupe = options.dedupe !== false;
  const emptyMeansAll = options.emptyMeansAll !== false;

  if (!Number.isFinite(pageCount) || pageCount < 0 || !Number.isInteger(pageCount)) {
    throw pdfError('PAGE_RANGE_INVALID', 'Invalid document page count for page selection');
  }
  if (pageCount === 0) {
    throw pdfError('EMPTY_PDF', 'Empty PDF: no pages in document');
  }

  if (Array.isArray(spec)) {
    const indices: number[] = [];
    for (const item of spec) {
      const n = Number(item);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw pdfError('PAGE_RANGE_INVALID', `Invalid page number: ${String(item)}`);
      }
      // Accept either 1-based (typical UI) or 0-based if already converted incorrectly:
      // arrays from options are treated as 1-based per API contract.
      if (n < 1 || n > pageCount) {
        throw pdfError(
          'PAGE_OUT_OF_RANGE',
          `Page ${n} is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'})`,
          400,
          { page: n, pageCount },
        );
      }
      indices.push(n - 1);
    }
    return finalize(indices, dedupe);
  }

  if (spec == null || (typeof spec === 'string' && !spec.trim())) {
    if (emptyMeansAll) {
      return Array.from({ length: pageCount }, (_, i) => i);
    }
    throw pdfError('PAGE_RANGE_INVALID', 'Page selection is required');
  }

  if (typeof spec === 'number') {
    if (!Number.isInteger(spec) || spec < 1 || spec > pageCount) {
      throw pdfError(
        'PAGE_OUT_OF_RANGE',
        `Page ${spec} is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'})`,
        400,
        { page: spec, pageCount },
      );
    }
    return [spec - 1];
  }

  if (typeof spec !== 'string') {
    throw pdfError('PAGE_RANGE_INVALID', 'Page selection must be a string or array');
  }

  const raw = spec.trim();
  const lower = raw.toLowerCase();
  if (lower === 'all') {
    return Array.from({ length: pageCount }, (_, i) => i);
  }

  const indices: number[] = [];
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) {
    throw pdfError('PAGE_RANGE_INVALID', 'Page selection is empty');
  }

  for (const part of parts) {
    const token = part.toLowerCase();

    if (token === 'all') {
      for (let i = 0; i < pageCount; i++) indices.push(i);
      continue;
    }
    if (token === 'odd') {
      for (let i = 0; i < pageCount; i += 2) indices.push(i);
      continue;
    }
    if (token === 'even') {
      for (let i = 1; i < pageCount; i += 2) indices.push(i);
      continue;
    }
    if (token === 'last') {
      indices.push(pageCount - 1);
      continue;
    }

    if (token.includes('-')) {
      // Range: "1-3", "1-", "-5", "10-"
      // Reject bare "-" or multiple hyphens in invalid ways
      if (token === '-' || token.startsWith('--') || token.endsWith('--')) {
        throw pdfError('PAGE_RANGE_INVALID', `Invalid page range syntax: "${part}"`);
      }
      const segs = part.split('-');
      // Allow only single hyphen separator (not "1-2-3")
      if (segs.length !== 2) {
        throw pdfError('PAGE_RANGE_INVALID', `Invalid page range syntax: "${part}"`);
      }
      const left = segs[0].trim();
      const right = segs[1].trim();
      if (left === '' && right === '') {
        throw pdfError('PAGE_RANGE_INVALID', `Invalid page range syntax: "${part}"`);
      }
      let a: number;
      let b: number;
      if (left === '') {
        a = 1;
      } else {
        a = Number(left);
        if (!Number.isFinite(a) || !Number.isInteger(a)) {
          throw pdfError('PAGE_RANGE_INVALID', `Invalid page range start: "${part}"`);
        }
      }
      if (right === '') {
        b = pageCount;
      } else {
        b = Number(right);
        if (!Number.isFinite(b) || !Number.isInteger(b)) {
          throw pdfError('PAGE_RANGE_INVALID', `Invalid page range end: "${part}"`);
        }
      }
      if (a < 1 || b < 1) {
        throw pdfError(
          'PAGE_OUT_OF_RANGE',
          `Page range "${part}" is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'})`,
          400,
          { range: part, pageCount },
        );
      }
      if (a > pageCount || b > pageCount) {
        throw pdfError(
          'PAGE_OUT_OF_RANGE',
          `Page range "${part}" is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'})`,
          400,
          { range: part, pageCount },
        );
      }
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let i = start; i <= end; i++) {
        indices.push(i - 1);
      }
      continue;
    }

    // Single page number
    if (!/^\d+$/.test(token)) {
      throw pdfError('PAGE_RANGE_INVALID', `Invalid page selection token: "${part}"`);
    }
    const n = Number(token);
    if (!Number.isInteger(n) || n < 1) {
      throw pdfError('PAGE_RANGE_INVALID', `Invalid page number: "${part}"`);
    }
    if (n > pageCount) {
      throw pdfError(
        'PAGE_OUT_OF_RANGE',
        `Page ${n} is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'})`,
        400,
        { page: n, pageCount },
      );
    }
    indices.push(n - 1);
  }

  if (!indices.length) {
    throw pdfError('PAGE_RANGE_INVALID', 'Page selection produced no pages');
  }
  return finalize(indices, dedupe);
}

function finalize(indices: number[], dedupe: boolean): number[] {
  if (!dedupe) return indices;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const i of indices) {
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  return out;
}

/**
 * Backward-compatible alias used by older tests/imports.
 * Prefer parsePageSelection for new code.
 *
 * Note: stricter than the historical silent-filter parser — invalid syntax
 * and out-of-range pages throw instead of being dropped.
 */
export function parsePages(spec: unknown, pageCount: number): number[] {
  return parsePageSelection(spec, pageCount);
}

/** Format zero-based indices as a compact 1-based range string for filenames (e.g. "1-5" or "1-3_7"). */
export function formatPageRangeLabel(zeroBased: number[]): string {
  if (!zeroBased.length) return 'none';
  const pages = zeroBased.map((i) => i + 1);
  // Collapse contiguous runs
  const parts: string[] = [];
  let runStart = pages[0]!;
  let runEnd = pages[0]!;
  for (let i = 1; i < pages.length; i++) {
    const p = pages[i]!;
    if (p === runEnd + 1) {
      runEnd = p;
    } else {
      parts.push(runStart === runEnd ? String(runStart) : `${runStart}-${runEnd}`);
      runStart = p;
      runEnd = p;
    }
  }
  parts.push(runStart === runEnd ? String(runStart) : `${runStart}-${runEnd}`);
  return parts.join('_').slice(0, 40);
}
