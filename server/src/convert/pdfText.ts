/**
 * PDF → text extraction with optional OCR.
 * Engines: pdftotext (Poppler) → mutool (MuPDF) → native content-stream scan.
 * OCR via tesseract only when explicitly enabled and available.
 * Never uses LibreOffice.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { execFileTracked } from '../lib/child-registry.js';
import { resolveOptionalBinary } from '../tools/optional-binaries.js';
import {
  assertMeaningfulTextOutput,
  extractTextSampleFromBytes,
  pdfError,
  sanitizeUserError,
  validatePdfInput,
  type PdfInspectResult,
} from './pdfInspect.js';
import { randomServerName } from '../lib/paths.js';

export type PdfTextExtractOptions = {
  inputPath: string;
  outputDir: string;
  /** Run OCR when native text is empty/scanned. Default false. */
  ocr?: boolean;
  /** OCR language(s), default eng */
  ocrLang?: string;
  originalBaseName?: string;
  jobId?: string;
  isCancelled?: () => boolean;
  onProgress?: (pct: number, message: string) => void;
  /** Minimum non-whitespace chars to count as "meaningful" */
  minMeaningfulChars?: number;
  timeoutMs?: number;
};

export type PdfTextExtractResult = {
  outputPath: string;
  outputName: string;
  engine: 'pdftotext' | 'mutool' | 'native' | 'tesseract';
  pageCount: number;
  charCount: number;
  scanned: boolean;
  usedOcr: boolean;
  inspect: PdfInspectResult;
};

function progress(opts: PdfTextExtractOptions, pct: number, msg: string) {
  opts.onProgress?.(pct, msg);
}

/** Stage a copy with ASCII-only basename when path has Unicode/spaces (Windows tool safety). */
async function stageAsciiInput(inputPath: string, outputDir: string): Promise<string> {
  const base = path.basename(inputPath);
  const needsStage = /[^\x20-\x7E]/.test(base) || /\s/.test(base);
  if (!needsStage) return inputPath;
  fs.mkdirSync(outputDir, { recursive: true });
  const staged = path.join(outputDir, `pdf-in-${randomBytes(4).toString('hex')}.pdf`);
  fs.copyFileSync(inputPath, staged);
  return staged;
}

/**
 * Extract text from PDF → .txt file.
 * 1. Validate PDF
 * 2. Native/tool text extraction
 * 3. If no meaningful text and OCR not requested → error No extractable text
 * 4. If OCR requested → tesseract (requires rasterizer + tesseract)
 * 5. Validate non-empty meaningful TXT
 */
export async function extractPdfText(
  opts: PdfTextExtractOptions,
): Promise<PdfTextExtractResult> {
  progress(opts, 5, 'validating');
  if (opts.isCancelled?.()) throw pdfError('CORRUPTED_PDF', 'Cancelled');

  const inspect = await validatePdfInput(opts.inputPath);
  progress(opts, 15, 'inspecting');

  const minChars = opts.minMeaningfulChars ?? 1;
  fs.mkdirSync(opts.outputDir, { recursive: true });

  progress(opts, 25, 'extracting');
  let text = '';
  let engine: PdfTextExtractResult['engine'] = 'native';

  // External tools on Windows can fail on Unicode/spaces paths — use ASCII staging copy
  const toolInputPath = await stageAsciiInput(opts.inputPath, opts.outputDir);

  try {
    // Prefer pdftotext (preserves page breaks with -layout or form-feed)
    const pdftotext = resolveOptionalBinary('pdftotext');
    if (pdftotext?.available && pdftotext.path) {
      try {
        text = await runPdftotext(pdftotext.path, toolInputPath, opts);
        engine = 'pdftotext';
      } catch {
        text = '';
      }
    }

    if (!hasMeaningful(text, minChars)) {
      const mutool = resolveOptionalBinary('mutool');
      if (mutool?.available && mutool.path) {
        try {
          text = await runMutoolText(mutool.path, toolInputPath, opts);
          engine = 'mutool';
        } catch {
          /* fall through */
        }
      }
    }

    if (!hasMeaningful(text, minChars)) {
      // Native fallback from content streams + per-page markers (uses original path)
      const bytes = fs.readFileSync(opts.inputPath);
      const sample = extractTextSampleFromBytes(bytes, 200_000);
      if (hasMeaningful(sample, minChars)) {
        text = formatNativeWithPages(sample, inspect.pageCount);
        engine = 'native';
      }
    }
  } finally {
    if (toolInputPath !== opts.inputPath) {
      try {
        fs.unlinkSync(toolInputPath);
      } catch {
        /* ignore */
      }
    }
  }

  // Treat as scanned only when effectively no text (not merely short documents)
  const scannedThreshold = Math.max(8, minChars);
  const scanned = !hasMeaningful(text, scannedThreshold);
  let usedOcr = false;

  if (scanned) {
    if (!opts.ocr) {
      throw pdfError(
        'NO_EXTRACTABLE_TEXT',
        'No extractable text: this appears to be a scanned PDF. Enable OCR to extract text.',
      );
    }
    progress(opts, 45, 'OCR');
    const ocrResult = await runOcrOnPdf(opts, inspect);
    text = ocrResult.text;
    engine = 'tesseract';
    usedOcr = true;
    if (!hasMeaningful(text, minChars)) {
      throw pdfError(
        'NO_EXTRACTABLE_TEXT',
        'No extractable text: OCR completed but found no meaningful text',
      );
    }
  }

  // Normalize page boundaries: ensure form-feed or --- Page N --- markers
  text = ensurePageBoundaries(text, inspect.pageCount);

  const outName = randomServerName('.txt');
  const outputPath = path.join(opts.outputDir, outName);
  fs.writeFileSync(outputPath, text, 'utf8');

  progress(opts, 90, 'packaging');
  try {
    assertMeaningfulTextOutput(outputPath, { minChars, label: 'PDF text' });
  } catch (e) {
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    throw e;
  }

  const displayBase =
    (opts.originalBaseName && opts.originalBaseName.trim()) ||
    path.basename(opts.inputPath, path.extname(opts.inputPath));

  progress(opts, 100, 'completed');
  return {
    outputPath,
    outputName: `${displayBase}.txt`,
    engine,
    pageCount: inspect.pageCount,
    charCount: text.replace(/\s+/g, '').length,
    scanned: scanned || usedOcr,
    usedOcr,
    inspect,
  };
}

function hasMeaningful(text: string, minChars: number): boolean {
  return text.replace(/\s+/g, '').length >= minChars;
}

async function runPdftotext(
  bin: string,
  inputPath: string,
  opts: PdfTextExtractOptions,
): Promise<string> {
  const tmp = path.join(
    opts.outputDir,
    `pdftotext-${randomBytes(4).toString('hex')}.txt`,
  );
  try {
    await execFileTracked(bin, ['-enc', 'UTF-8', '-layout', inputPath, tmp], {
      jobId: opts.jobId,
      timeout: opts.timeoutMs ?? 120_000,
      windowsHide: true,
    });
    if (!fs.existsSync(tmp)) return '';
    return fs.readFileSync(tmp, 'utf8');
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function runMutoolText(
  bin: string,
  inputPath: string,
  opts: PdfTextExtractOptions,
): Promise<string> {
  const result = await execFileTracked(bin, ['draw', '-F', 'txt', inputPath], {
    jobId: opts.jobId,
    timeout: opts.timeoutMs ?? 120_000,
    windowsHide: true,
    maxBuffer: 40 * 1024 * 1024,
  });
  return String(result.stdout || '');
}

function formatNativeWithPages(sample: string, pageCount: number): string {
  // Native extractor cannot reliably split pages; mark single block with count
  const header =
    pageCount > 1
      ? `--- Page 1 of ${pageCount} (native extraction; page boundaries approximate) ---\n`
      : '';
  return header + sample + (sample.endsWith('\n') ? '' : '\n');
}

function ensurePageBoundaries(text: string, pageCount: number): string {
  if (pageCount <= 1) return text.endsWith('\n') ? text : text + '\n';
  // pdftotext uses form feed \f between pages
  if (text.includes('\f')) {
    return text
      .split('\f')
      .map((part, i) => {
        const body = part.replace(/^\s+/, '');
        return `--- Page ${i + 1} ---\n${body}`;
      })
      .join('\n\n')
      .replace(/\n*$/, '\n');
  }
  if (/---\s*Page\s+\d+/i.test(text)) return text.endsWith('\n') ? text : text + '\n';
  return text.endsWith('\n') ? text : text + '\n';
}

/**
 * OCR path: rasterize pages then tesseract.
 * Requires tesseract + a PDF rasterizer (pdftoppm, mutool, or ghostscript).
 */
async function runOcrOnPdf(
  opts: PdfTextExtractOptions,
  inspect: PdfInspectResult,
): Promise<{ text: string }> {
  const tesseract = resolveOptionalBinary('tesseract');
  if (!tesseract?.available || !tesseract.path) {
    throw pdfError(
      'OCR_UNAVAILABLE',
      'OCR unavailable: Tesseract is not installed on this machine',
      503,
    );
  }

  // Dynamic import of render to avoid circular deps at load time
  const { rasterizePdfPages } = await import('./pdfRender.js');
  let pages: { path: string }[] = [];
  const work = path.join(
    opts.outputDir,
    `ocr-${randomBytes(4).toString('hex')}`,
  );
  fs.mkdirSync(work, { recursive: true });

  try {
    progress(opts, 50, 'rendering');
    pages = await rasterizePdfPages({
      inputPath: opts.inputPath,
      outputDir: work,
      format: 'png',
      dpi: 200,
      jobId: opts.jobId,
      isCancelled: opts.isCancelled,
      maxPages: Math.min(inspect.pageCount, 50),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'rasterize failed';
    if (/unavailable|not found|no rasterizer/i.test(msg)) {
      throw pdfError(
        'OCR_UNAVAILABLE',
        'OCR unavailable: PDF rasterizer (pdftoppm, mutool, or Ghostscript) is required',
        503,
      );
    }
    throw pdfError('OCR_UNAVAILABLE', `OCR unavailable: ${sanitizeUserError(msg)}`, 503);
  }

  if (!pages.length) {
    throw pdfError(
      'OCR_UNAVAILABLE',
      'OCR unavailable: could not rasterize PDF pages',
      503,
    );
  }

  const lang = opts.ocrLang || 'eng';
  const parts: string[] = [];
  let i = 0;
  for (const page of pages) {
    if (opts.isCancelled?.()) throw pdfError('CORRUPTED_PDF', 'Cancelled');
    i += 1;
    progress(opts, 55 + Math.floor((40 * i) / pages.length), `OCR page ${i}/${pages.length}`);
    const outBase = path.join(work, `ocr-page-${i}`);
    try {
      await execFileTracked(
        tesseract.path,
        [page.path, outBase, '-l', lang, '--psm', '3'],
        {
          jobId: opts.jobId,
          timeout: opts.timeoutMs ?? 180_000,
          windowsHide: true,
        },
      );
      const txtPath = `${outBase}.txt`;
      if (fs.existsSync(txtPath)) {
        const pageText = fs.readFileSync(txtPath, 'utf8');
        parts.push(`--- Page ${i} ---\n${pageText.trim()}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'tesseract failed';
      throw pdfError(
        'OCR_UNAVAILABLE',
        `OCR unavailable: ${sanitizeUserError(msg)}`,
        503,
      );
    }
  }

  // cleanup raster work dir
  try {
    fs.rmSync(work, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return { text: parts.join('\n\n') + '\n' };
}

/** Sync probe: is pdftotext / mutool / tesseract present? */
export function probePdfTextEngines(): {
  pdftotext: boolean;
  mutool: boolean;
  tesseract: boolean;
  native: boolean;
} {
  return {
    pdftotext: Boolean(resolveOptionalBinary('pdftotext')?.available),
    mutool: Boolean(resolveOptionalBinary('mutool')?.available),
    tesseract: Boolean(resolveOptionalBinary('tesseract')?.available),
    native: true,
  };
}

/** Used by tests: force native-only extract without writing LO. */
export function extractTextNativeSync(inputPath: string): string {
  const bytes = fs.readFileSync(inputPath);
  return extractTextSampleFromBytes(bytes, 200_000);
}

/** Which binary would be preferred (for matrix/capability reports). */
export function preferredTextEngine(): string {
  if (resolveOptionalBinary('pdftotext')?.available) return 'pdftotext';
  if (resolveOptionalBinary('mutool')?.available) return 'mutool';
  return 'native';
}

// Silence unused import if tree-shaken in some builds
void os;
void execFileSync;
