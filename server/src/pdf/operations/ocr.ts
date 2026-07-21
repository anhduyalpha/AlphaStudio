import path from 'node:path';
import { badRequest } from '../../lib/errors.js';
import { pdfError } from '../errors.js';
import { normalizePdfOptions } from '../operation-options.js';
import { OutputNames } from '../output-names.js';
import { hasOcrStack } from '../../tools/optional-binaries.js';
import type { PdfOpContext } from '../types.js';

/**
 * Dedicated OCR operation.
 * Searchable PDF is capability-gated: only when a reliable toolchain exists.
 * Current stack produces text OCR via rasterize + tesseract.
 * Searchable PDF is NOT faked — rejected when requested without support.
 */
export async function ocrPdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  if (!hasOcrStack()) {
    throw pdfError(
      'OCR_UNAVAILABLE',
      'OCR requires Tesseract and a PDF rasterizer (pdftoppm, mutool, or Ghostscript)',
      503,
    );
  }
  const opts = normalizePdfOptions(ctx.options);

  if (opts.searchablePdf) {
    // Honest gate: no reliable searchable-PDF toolchain in this stack
    throw pdfError(
      'OCR_UNAVAILABLE',
      'Searchable PDF OCR is not available with the current toolchain. Use text OCR output instead.',
      503,
      { searchablePdf: false },
    );
  }

  ctx.progress.stage('ocr', 0.05, 'Starting OCR');
  const { extractPdfText } = await import('../../convert/pdfText.js');
  const result = await extractPdfText({
    inputPath: ctx.inputPaths[0],
    outputDir: ctx.outputDir,
    ocr: true,
    ocrLang: opts.ocrLang,
    originalBaseName: path.basename(ctx.primaryName || 'document', path.extname(ctx.primaryName || '')),
    jobId: ctx.jobId,
    isCancelled: ctx.isCancelled,
    // Force OCR path even if some text exists — user asked for OCR
    minMeaningfulChars: 1_000_000, // force "scanned" path when ocr:true... 
    // Wait: extractPdfText only OCRs when scanned. Override by always requesting ocr
    // and treating short text as scanned. Better: call with ocr:true and low native yield.
    onProgress: (p, msg) => {
      ctx.progress.stage('ocr', Math.min(0.95, p / 100), msg || 'OCR');
    },
  });

  // If native text was used (document had text), still OK — re-run forced OCR via option
  // When extractPdfText finds text it skips OCR. For dedicated ocr op we need force.
  // If usedOcr is false, re-extract forcing by using a wrapper.
  if (!result.usedOcr) {
    // Force OCR regardless of native text: call internal force path
    const forced = await forceOcr(ctx, opts.ocrLang, opts.ocrPageLimit);
    ctx.progress.complete('completed');
    return forced;
  }

  ctx.progress.complete('completed');
  return {
    outputPath: result.outputPath,
    outputName: OutputNames.ocrText(ctx.primaryName),
    outputMime: 'text/plain',
    meta: {
      engine: 'tesseract',
      pageCount: result.pageCount,
      charCount: result.charCount,
      usedOcr: true,
      ocrLang: opts.ocrLang,
      searchablePdf: false,
    },
  };
}

async function forceOcr(
  ctx: PdfOpContext,
  ocrLang: string,
  pageLimit: number,
) {
  const { validatePdfInput } = await import('../../convert/pdfInspect.js');
  const { rasterizePdfPages } = await import('../../convert/pdfRender.js');
  const { resolveOptionalBinary } = await import('../../tools/optional-binaries.js');
  const { execFileTracked } = await import('../../lib/child-registry.js');
  const { assertMeaningfulTextOutput } = await import('../../convert/pdfInspect.js');
  const { randomServerName } = await import('../../lib/paths.js');
  const fs = await import('node:fs');
  const { randomBytes } = await import('node:crypto');
  const { throwIfCancelled } = await import('../errors.js');

  const inspect = await validatePdfInput(ctx.inputPaths[0]!);
  const tesseract = resolveOptionalBinary('tesseract');
  if (!tesseract.available || !tesseract.path) {
    throw pdfError('OCR_UNAVAILABLE', 'OCR unavailable: Tesseract is not installed', 503);
  }

  const work = path.join(ctx.workDir, `ocr-force-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    ctx.progress.stage('rendering', 0.1, 'Rasterizing for OCR');
    const pages = await rasterizePdfPages({
      inputPath: ctx.inputPaths[0]!,
      outputDir: work,
      format: 'png',
      dpi: 200,
      maxPages: Math.min(inspect.pageCount, pageLimit),
      jobId: ctx.jobId,
      isCancelled: ctx.isCancelled,
      onProgress: (p, msg) => ctx.progress.stage('rendering', p / 100, msg),
    });

    const parts: string[] = [];
    let i = 0;
    for (const page of pages) {
      throwIfCancelled(ctx.isCancelled);
      i += 1;
      ctx.progress.batch('ocr', i, pages.length, `OCR page ${i}/${pages.length}`);
      const outBase = path.join(work, `ocr-page-${i}`);
      try {
        await execFileTracked(
          tesseract.path,
          [page.path, outBase, '-l', ocrLang, '--psm', '3'],
          {
            jobId: ctx.jobId,
            timeout: 180_000,
            windowsHide: true,
          },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'tesseract failed';
        if (/failed loading language|Error opening data file|tessdata/i.test(msg)) {
          throw pdfError(
            'OCR_UNAVAILABLE',
            `OCR language pack unavailable for "${ocrLang}". Install the Tesseract language data.`,
            503,
            { ocrLang },
          );
        }
        throw pdfError('OCR_UNAVAILABLE', `OCR failed: ${msg.slice(0, 200)}`, 503);
      }
      const txtPath = `${outBase}.txt`;
      if (fs.existsSync(txtPath)) {
        parts.push(`--- Page ${i} ---\n${fs.readFileSync(txtPath, 'utf8').trim()}`);
      }
    }

    const text = parts.join('\n\n') + '\n';
    const outName = randomServerName('.txt');
    const outputPath = path.join(ctx.outputDir, outName);
    fs.writeFileSync(outputPath, text, 'utf8');
    assertMeaningfulTextOutput(outputPath, { minChars: 1, label: 'OCR text' });

    return {
      outputPath,
      outputName: OutputNames.ocrText(ctx.primaryName),
      outputMime: 'text/plain',
      meta: {
        engine: 'tesseract',
        pageCount: pages.length,
        charCount: text.replace(/\s+/g, '').length,
        usedOcr: true,
        ocrLang,
        searchablePdf: false,
      },
    };
  } finally {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
