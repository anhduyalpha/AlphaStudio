/**
 * PDF pre-validation and inspection.
 * Pure decisions: magic, encryption, page tree, scanned vs text, metadata.
 * Never routes through LibreOffice.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { sanitizeUserError } from '../lib/sanitize.js';
export { sanitizeUserError } from '../lib/sanitize.js';
import { badRequest, unsupported } from '../lib/errors.js';
import { resolveOptionalBinary } from '../tools/optional-binaries.js';

export type PdfInspectResult = {
  path: string;
  size: number;
  pageCount: number;
  encrypted: boolean;
  passwordRequired: boolean;
  corrupted: boolean;
  empty: boolean;
  /** True when native extraction yields no meaningful text */
  scannedLikely: boolean;
  textSample?: string;
  textCharCount: number;
  pageSize?: { width: number; height: number };
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
  };
  checksum: string;
  engine: 'pdf-lib';
};

export type PdfErrorCode =
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'CORRUPTED_PDF'
  | 'EMPTY_PDF'
  | 'NO_EXTRACTABLE_TEXT'
  | 'OCR_UNAVAILABLE'
  | 'RASTERIZER_UNAVAILABLE'
  | 'REPAIR_UNAVAILABLE'
  | 'COMPRESSION_UNAVAILABLE'
  | 'UNSUPPORTED_CONVERSION'
  | 'OUTPUT_VALIDATION_FAILED'
  | 'MIME_MISMATCH'
  | 'INVALID_PDF'
  | 'PAGE_RANGE_INVALID'
  | 'PAGE_OUT_OF_RANGE'
  | 'PDF_TOO_LARGE'
  | 'PDF_PAGE_LIMIT_EXCEEDED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'DECRYPT_UNAVAILABLE';

export function pdfError(
  code: PdfErrorCode,
  message: string,
  statusCode = 400,
): Error & { statusCode: number; code: string; name: string } {
  const err = new Error(sanitizeUserError(message)) as Error & {
    statusCode: number;
    code: string;
    name: string;
    details?: unknown;
  };
  const availability = new Set([
    'OCR_UNAVAILABLE',
    'RASTERIZER_UNAVAILABLE',
    'REPAIR_UNAVAILABLE',
    'COMPRESSION_UNAVAILABLE',
    'DECRYPT_UNAVAILABLE',
    'UNSUPPORTED_CONVERSION',
  ]);
  err.statusCode = availability.has(code) ? (statusCode === 400 ? 503 : statusCode) : statusCode;
  // Keep stable pdf codes; map legacy UNSUPPORTED_CONVERSION for older clients when needed
  err.code = code;
  err.name = 'AppError';
  err.details = { pdfCode: code };
  return err;
}

/** Read first N bytes; false if not a PDF header. */
export function hasPdfMagic(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(8);
      const n = fs.readSync(fd, buf, 0, 8, 0);
      if (n < 5) return false;
      return buf.subarray(0, 5).toString('ascii') === '%PDF-';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** Fast checksum for inspect cache (full file, chunked). */
export function checksumFile(filePath: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let n = 0;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

const inspectCache = new Map<string, { at: number; result: PdfInspectResult }>();
const INSPECT_CACHE_TTL_MS = 10 * 60_000;
const INSPECT_CACHE_MAX = 64;

export function getCachedPdfInspect(checksum: string): PdfInspectResult | null {
  const hit = inspectCache.get(checksum);
  if (!hit) return null;
  if (Date.now() - hit.at > INSPECT_CACHE_TTL_MS) {
    inspectCache.delete(checksum);
    return null;
  }
  return hit.result;
}

export function setCachedPdfInspect(checksum: string, result: PdfInspectResult): void {
  if (inspectCache.size >= INSPECT_CACHE_MAX) {
    const first = inspectCache.keys().next().value;
    if (first) inspectCache.delete(first);
  }
  inspectCache.set(checksum, { at: Date.now(), result });
}

export function clearPdfInspectCache(): void {
  inspectCache.clear();
}

/**
 * Validate PDF input before any conversion/edit.
 * Throws AppError-shaped errors with precise codes.
 */
export async function validatePdfInput(
  filePath: string,
  opts: {
    originalName?: string;
    declaredMime?: string;
    /** When true, load even if encrypted (for metadata only) */
    allowEncrypted?: boolean;
  } = {},
): Promise<PdfInspectResult> {
  if (!filePath || !fs.existsSync(filePath)) {
    throw pdfError('CORRUPTED_PDF', 'Corrupted PDF: file is missing or unreadable');
  }

  let st: fs.Stats;
  try {
    st = fs.statSync(filePath);
  } catch {
    throw pdfError('CORRUPTED_PDF', 'Corrupted PDF: file is not readable');
  }
  if (!st.isFile()) {
    throw pdfError('CORRUPTED_PDF', 'Corrupted PDF: path is not a file');
  }
  if (st.size <= 0) {
    throw pdfError('EMPTY_PDF', 'Empty PDF: file size is zero');
  }

  // Extension / MIME mismatch (when caller provides declared name/mime)
  const name = opts.originalName || path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  if (ext && ext !== '.pdf') {
    throw pdfError(
      'MIME_MISMATCH',
      `Extension/MIME mismatch: expected .pdf, got ${ext}`,
    );
  }
  if (opts.declaredMime) {
    const m = opts.declaredMime.toLowerCase();
    if (m && m !== 'application/pdf' && m !== 'application/x-pdf' && m !== 'application/octet-stream') {
      throw pdfError(
        'MIME_MISMATCH',
        `Extension/MIME mismatch: declared type ${opts.declaredMime} is not PDF`,
      );
    }
  }

  if (!hasPdfMagic(filePath)) {
    throw pdfError('CORRUPTED_PDF', 'Corrupted PDF: missing %PDF- magic header');
  }

  // Truncation heuristic: PDF should end near %%EOF
  try {
    const tailSize = Math.min(2048, st.size);
    const fd = fs.openSync(filePath, 'r');
    const tail = Buffer.alloc(tailSize);
    fs.readSync(fd, tail, 0, tailSize, st.size - tailSize);
    fs.closeSync(fd);
    const tailStr = tail.toString('latin1');
    if (!/%%EOF/i.test(tailStr) && st.size < 100) {
      throw pdfError('CORRUPTED_PDF', 'Corrupted PDF: truncated or incomplete file');
    }
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'CORRUPTED_PDF') throw e;
    // continue — some valid PDFs have extra bytes after EOF
  }

  const checksum = checksumFile(filePath);
  const cached = getCachedPdfInspect(checksum);
  if (cached) {
    return { ...cached, path: filePath };
  }

  const bytes = fs.readFileSync(filePath);

  // Encryption probe: try strict load first
  let encrypted = false;
  let passwordRequired = false;
  let doc: PDFDocument | null = null;

  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt|password|security/i.test(msg)) {
      encrypted = true;
      passwordRequired = true;
      if (!opts.allowEncrypted) {
        throw pdfError('PASSWORD_REQUIRED', 'Password required: this PDF is encrypted');
      }
      try {
        doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      } catch {
        throw pdfError('PASSWORD_REQUIRED', 'Password required: this PDF is encrypted');
      }
    } else {
      throw pdfError(
        'CORRUPTED_PDF',
        `Corrupted PDF: ${sanitizeUserError(msg)}`,
      );
    }
  }

  if (!doc) {
    throw pdfError('CORRUPTED_PDF', 'Corrupted PDF: unable to parse document');
  }

  let pageCount = 0;
  try {
    pageCount = doc.getPageCount();
  } catch (e) {
    throw pdfError(
      'CORRUPTED_PDF',
      `Corrupted PDF: unreadable page tree (${sanitizeUserError(e instanceof Error ? e.message : 'error')})`,
    );
  }

  if (pageCount <= 0) {
    throw pdfError('EMPTY_PDF', 'Empty PDF: no pages in document');
  }

  let pageSize: { width: number; height: number } | undefined;
  try {
    const page = doc.getPage(0);
    const box = page.getSize();
    pageSize = { width: box.width, height: box.height };
  } catch {
    /* optional */
  }

  const metadata: PdfInspectResult['metadata'] = {};
  try {
    const title = doc.getTitle();
    const author = doc.getAuthor();
    const subject = doc.getSubject();
    const creator = doc.getCreator();
    const producer = doc.getProducer();
    if (title) metadata.title = title;
    if (author) metadata.author = author;
    if (subject) metadata.subject = subject;
    if (creator) metadata.creator = creator;
    if (producer) metadata.producer = producer;
    const created = doc.getCreationDate();
    const modified = doc.getModificationDate();
    if (created) metadata.creationDate = created.toISOString();
    if (modified) metadata.modificationDate = modified.toISOString();
  } catch {
    /* metadata optional */
  }

  // Text vs scanned: inflate FlateDecode streams + optional pdftotext probe.
  // Raw byte scans miss most modern PDFs (compressed content streams).
  let textSample = extractTextSampleFromBytes(bytes);
  let textCharCount = textSample.replace(/\s+/g, '').length;
  if (textCharCount < 8) {
    const probe = probeExternalText(filePath);
    if (probe && probe.replace(/\s+/g, '').length > textCharCount) {
      textSample = probe;
      textCharCount = probe.replace(/\s+/g, '').length;
    }
  }
  // Near-empty after inflate+probe → likely scanned; short text docs still count as text
  const scannedLikely = textCharCount < 8;

  const result: PdfInspectResult = {
    path: filePath,
    size: st.size,
    pageCount,
    encrypted,
    passwordRequired,
    corrupted: false,
    empty: false,
    scannedLikely,
    textSample: textSample.slice(0, 500),
    textCharCount,
    pageSize,
    metadata,
    checksum,
    engine: 'pdf-lib',
  };

  setCachedPdfInspect(checksum, result);
  return result;
}

/**
 * Best-effort text sample without external tools.
 * 1) Scan raw PDF for Tj/TJ operators (uncompressed streams).
 * 2) Inflate FlateDecode streams and scan again (typical pdf-lib / modern PDFs).
 */
export function extractTextSampleFromBytes(bytes: Buffer, maxChars = 4000): string {
  const fromRaw = harvestTextOperators(bytes.toString('latin1'), maxChars);
  if (fromRaw.replace(/\s+/g, '').length >= 8) {
    return fromRaw;
  }

  // Inflate FlateDecode streams — most text PDFs store operators compressed
  const inflated = inflatePdfStreams(bytes, maxChars * 8);
  if (inflated) {
    const fromInflated = harvestTextOperators(inflated, maxChars);
    if (fromInflated.replace(/\s+/g, '').length > fromRaw.replace(/\s+/g, '').length) {
      return fromInflated;
    }
  }

  return fromRaw;
}

/** Decode PDF hex string body `<48656C6C6F>` → "Hello" (pdf-lib uses this form). */
function decodePdfHexLiteral(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (!clean.length || clean.length % 2 !== 0 || /[^0-9A-Fa-f]/.test(clean)) return '';
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  // Prefer UTF-16BE when BOM present; else latin1/PDFDoc-ish bytes
  if (out.length >= 2 && out[0] === 0xfe && out[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < out.length; i += 2) {
      s += String.fromCharCode((out[i] << 8) | out[i + 1]);
    }
    return s;
  }
  return Buffer.from(out).toString('latin1');
}

/** Harvest Tj/TJ and BT/ET string literals from decoded PDF content. */
function harvestTextOperators(raw: string, maxChars: number): string {
  const chunks: string[] = [];
  let total = 0;

  // Parentheses literals, hex literals (pdf-lib), and TJ arrays
  const re =
    /\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9A-Fa-f \t\r\n]+)>\s*Tj|\[((?:[^\[\]]|\([^\)]*\)|<[^>]*>)*)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null && total < maxChars) {
    let lit = '';
    if (m[1] != null) lit = unescapePdfLiteral(m[1]);
    else if (m[2] != null) lit = decodePdfHexLiteral(m[2]);
    else lit = extractFromTjArray(m[3] || '');
    if (lit && /[\x20-\x7E\u00A0-\uFFFF]/.test(lit)) {
      chunks.push(lit);
      total += lit.length;
    }
  }

  if (total < 40) {
    const bt = /BT([\s\S]{0,8000}?)ET/g;
    let b: RegExpExecArray | null;
    while ((b = bt.exec(raw)) !== null && total < maxChars) {
      const inner = b[1];
      const litRe = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f \t\r\n]+)>/g;
      let lm: RegExpExecArray | null;
      while ((lm = litRe.exec(inner)) !== null && total < maxChars) {
        const lit = lm[1] != null ? unescapePdfLiteral(lm[1]) : decodePdfHexLiteral(lm[2] || '');
        if (lit.trim()) {
          chunks.push(lit);
          total += lit.length;
        }
      }
    }
  }

  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Locate `stream`…`endstream` pairs with FlateDecode and inflate content.
 * Returns concatenated latin1 of inflated payloads (capped).
 */
export function inflatePdfStreams(bytes: Buffer, maxOut = 200_000): string {
  const raw = bytes.toString('latin1');
  const parts: string[] = [];
  let total = 0;
  // Match object dict + stream ... endstream (non-greedy body)
  const streamRe = /<<([\s\S]{0,2000}?)>>\s*stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null && total < maxOut) {
    const dict = m[1];
    if (!/\/FlateDecode|\/Fl/i.test(dict)) continue;
    // Binary body may include \r\n after stream keyword — m[2] is latin1 of bytes
    const bodyLatin = m[2];
    // Strip trailing whitespace that may be outside length
    let body = Buffer.from(bodyLatin, 'latin1');
    // Prefer /Length if present
    const lenMatch = dict.match(/\/Length\s+(\d+)/);
    if (lenMatch) {
      const len = Number(lenMatch[1]);
      if (Number.isFinite(len) && len > 0 && len <= body.length) {
        body = body.subarray(0, len);
      }
    } else {
      // Trim trailing CR/LF that often precedes endstream
      while (body.length && (body[body.length - 1] === 0x0a || body[body.length - 1] === 0x0d)) {
        body = body.subarray(0, body.length - 1);
      }
    }
    const inflated = tryInflate(body);
    if (inflated && inflated.length) {
      const slice = inflated.toString('latin1').slice(0, maxOut - total);
      parts.push(slice);
      total += slice.length;
    }
  }
  return parts.join('\n');
}

function tryInflate(body: Buffer): Buffer | null {
  if (!body.length) return null;
  try {
    return inflateSync(body);
  } catch {
    /* try raw deflate */
  }
  try {
    return inflateRawSync(body);
  } catch {
    return null;
  }
}

/**
 * Optional fast pdftotext probe for scanned-vs-text classification.
 * Does not throw; returns empty string when tool missing or fails.
 */
export function probeExternalText(filePath: string): string {
  try {
    const pdftotext = resolveOptionalBinary('pdftotext');
    if (!pdftotext?.available || !pdftotext.path) return '';
    // Stage ASCII path for tools that choke on Unicode filenames
    let toolPath = filePath;
    const base = path.basename(filePath);
    let staged: string | null = null;
    if (/[^\x20-\x7E]/.test(base) || /\s/.test(base)) {
      staged = path.join(os.tmpdir(), `pdf-probe-in-${randomBytes(4).toString('hex')}.pdf`);
      fs.copyFileSync(filePath, staged);
      toolPath = staged;
    }
    const tmp = path.join(os.tmpdir(), `pdf-probe-${randomBytes(4).toString('hex')}.txt`);
    try {
      execFileSync(pdftotext.path, ['-enc', 'UTF-8', '-l', '2', toolPath, tmp], {
        timeout: 15_000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (!fs.existsSync(tmp)) return '';
      const text = fs.readFileSync(tmp, 'utf8');
      return text.slice(0, 4000);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      if (staged) {
        try {
          fs.unlinkSync(staged);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    return '';
  }
}

function unescapePdfLiteral(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function extractFromTjArray(s: string): string {
  const parts: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f \t\r\n]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    parts.push(m[1] != null ? unescapePdfLiteral(m[1]) : decodePdfHexLiteral(m[2] || ''));
  }
  return parts.join('');
}

/** Validate a produced TXT output is non-empty and meaningful. */
export function assertMeaningfulTextOutput(
  outputPath: string,
  opts: { minChars?: number; label?: string } = {},
): void {
  const minChars = opts.minChars ?? 1;
  const label = opts.label || 'TXT output';
  if (!outputPath || !fs.existsSync(outputPath)) {
    throw pdfError('OUTPUT_VALIDATION_FAILED', `Output validation failed: ${label} missing`);
  }
  const st = fs.statSync(outputPath);
  if (st.size <= 0) {
    throw pdfError('OUTPUT_VALIDATION_FAILED', `Output validation failed: ${label} is empty`);
  }
  const text = fs.readFileSync(outputPath, 'utf8');
  const meaningful = text.replace(/\s+/g, '').length;
  if (meaningful < minChars) {
    throw pdfError(
      'OUTPUT_VALIDATION_FAILED',
      `Output validation failed: ${label} has no meaningful text`,
    );
  }
}

/** Re-export friendly badRequest wrapper that sanitizes paths. */
export function pdfBadRequest(message: string): never {
  throw badRequest(sanitizeUserError(message));
}

export function pdfUnsupported(message: string): never {
  throw unsupported(sanitizeUserError(message));
}
