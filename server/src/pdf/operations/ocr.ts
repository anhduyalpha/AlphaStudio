import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { badRequest } from '../../lib/errors.js';
import { execFileTracked } from '../../lib/child-registry.js';
import { randomServerName } from '../../lib/paths.js';
import {
  assertMeaningfulTextOutput,
  validatePdfInput,
} from '../../convert/pdfInspect.js';
import { rasterizePdfPagesWithEngine } from '../../convert/pdfRender.js';
import { hasOcrStack, resolveOptionalBinary } from '../../tools/optional-binaries.js';
import { pdfError, throwIfCancelled } from '../errors.js';
import { normalizePdfOptions } from '../operation-options.js';
import { OutputNames } from '../output-names.js';
import { parsePageSelection } from '../page-selection.js';
import type { PdfOpContext } from '../types.js';

/** Resolve the exact ordered OCR page set and enforce the configured limit. */
export function resolveOcrPageSelection(
  pages: string | undefined,
  pageCount: number,
  pageLimit: number,
): number[] {
  const selected = parsePageSelection(pages, pageCount, {
    emptyMeansAll: true,
    dedupe: true,
  });
  if (selected.length > pageLimit) {
    throw pdfError(
      'PDF_PAGE_LIMIT_EXCEEDED',
      `OCR selection contains ${selected.length} pages; the limit is ${pageLimit}`,
      400,
      { selectedPages: selected.length, pageLimit },
    );
  }
  return selected;
}

/**
 * Dedicated text OCR operation.
 *
 * The submitted page set is copied to a temporary PDF in the requested order,
 * so rasterization never scans unselected pages. There is no native-text probe
 * or second OCR fallback: every selected page is rasterized and OCRed once.
 */
export async function ocrPdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const opts = normalizePdfOptions(ctx.options);

  if (opts.searchablePdf) {
    throw pdfError(
      'OCR_UNAVAILABLE',
      'Searchable PDF OCR is not available with the current toolchain. Use text OCR output instead.',
      503,
      { searchablePdf: false },
    );
  }
  if (!hasOcrStack()) {
    throw pdfError(
      'OCR_UNAVAILABLE',
      'OCR requires Tesseract and a PDF rasterizer (pdftoppm, mutool, or Ghostscript)',
      503,
    );
  }

  ctx.progress.stage('rendering', 0, 'Preparing selected pages for OCR');
  throwIfCancelled(ctx.isCancelled);
  const inspect = await validatePdfInput(ctx.inputPaths[0], {
    originalName: ctx.primaryName,
  });
  const selectedIndices = resolveOcrPageSelection(
    opts.pages,
    inspect.pageCount,
    opts.ocrPageLimit,
  );
  const selectedPages = selectedIndices.map((index) => index + 1);

  const tesseract = resolveOptionalBinary('tesseract');
  if (!tesseract.available || !tesseract.path) {
    throw pdfError('OCR_UNAVAILABLE', 'OCR unavailable: Tesseract is not installed', 503);
  }

  const work = path.join(ctx.workDir, `ocr-${randomBytes(6).toString('hex')}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    const source = await PDFDocument.load(await fs.promises.readFile(ctx.inputPaths[0]));
    const subset = await PDFDocument.create();
    const copied = await subset.copyPages(source, selectedIndices);
    copied.forEach((page) => subset.addPage(page));
    const subsetPath = path.join(work, 'selected-pages.pdf');
    await fs.promises.writeFile(subsetPath, await subset.save());

    ctx.progress.stage('rendering', 0, `Rasterizing ${selectedIndices.length} selected page(s)`);
    const raster = await rasterizePdfPagesWithEngine({
      inputPath: subsetPath,
      outputDir: path.join(work, 'raster'),
      format: 'png',
      dpi: 200,
      maxPages: selectedIndices.length,
      jobId: ctx.jobId,
      isCancelled: ctx.isCancelled,
      onProgress: (percent, message) => {
        ctx.progress.stage('rendering', Math.min(1, percent / 100), message);
      },
    });
    if (raster.pages.length !== selectedIndices.length) {
      throw pdfError(
        'OUTPUT_VALIDATION_FAILED',
        `OCR rasterization produced ${raster.pages.length} of ${selectedIndices.length} selected pages`,
      );
    }

    const sections: string[] = [];
    let characterCount = 0;
    for (let i = 0; i < raster.pages.length; i += 1) {
      throwIfCancelled(ctx.isCancelled);
      const page = raster.pages[i]!;
      const originalPage = selectedPages[i]!;
      ctx.progress.batch(
        'ocr',
        i,
        raster.pages.length,
        `OCR page ${originalPage} (${i + 1}/${raster.pages.length})`,
      );
      const outBase = path.join(work, `ocr-page-${String(i + 1).padStart(4, '0')}`);
      try {
        await execFileTracked(
          tesseract.path,
          [page.path, outBase, '-l', opts.ocrLang, '--psm', '3'],
          {
            jobId: ctx.jobId,
            timeout: 180_000,
            windowsHide: true,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tesseract failed';
        if (/failed loading language|Error opening data file|tessdata/i.test(message)) {
          throw pdfError(
            'OCR_UNAVAILABLE',
            `OCR language pack unavailable for "${opts.ocrLang}". Install the Tesseract language data.`,
            503,
            { ocrLang: opts.ocrLang },
          );
        }
        throw pdfError('OCR_UNAVAILABLE', 'OCR failed while processing a selected page', 503, {
          engine: 'tesseract',
          page: originalPage,
        });
      }

      const textPath = `${outBase}.txt`;
      const pageText = fs.existsSync(textPath)
        ? await fs.promises.readFile(textPath, 'utf8')
        : '';
      const trimmed = pageText.trim();
      characterCount += trimmed.replace(/\s+/g, '').length;
      sections.push(`--- Page ${originalPage} ---\n${trimmed}`);
      ctx.progress.batch(
        'ocr',
        i + 1,
        raster.pages.length,
        `OCR page ${originalPage} complete`,
      );
    }

    if (characterCount < 1) {
      throw pdfError(
        'NO_EXTRACTABLE_TEXT',
        'OCR completed but found no meaningful text on the selected pages',
      );
    }

    ctx.progress.stage('packaging', 0.5, 'Writing OCR text');
    const outputPath = path.join(ctx.outputDir, randomServerName('.txt'));
    await fs.promises.writeFile(outputPath, `${sections.join('\n\n')}\n`, 'utf8');
    assertMeaningfulTextOutput(outputPath, { minChars: 1, label: 'OCR text' });
    ctx.progress.complete('completed');
    return {
      outputPath,
      outputName: OutputNames.ocrText(ctx.primaryName),
      outputMime: 'text/plain',
      meta: {
        engine: 'tesseract',
        rasterEngine: raster.engine,
        outputKind: 'text',
        pageCount: selectedIndices.length,
        selectedPages,
        charCount: characterCount,
        characterCount,
        usedOcr: true,
        ocrStatus: 'applied',
        ocrLang: opts.ocrLang,
        searchablePdf: false,
      },
    };
  } finally {
    try {
      await fs.promises.rm(work, { recursive: true, force: true });
    } catch {
      /* best-effort temporary cleanup */
    }
  }
}
