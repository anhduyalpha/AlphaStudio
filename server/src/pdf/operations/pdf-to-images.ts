import path from 'node:path';
import { badRequest } from '../../lib/errors.js';
import { pdfError } from '../errors.js';
import { normalizePdfOptions } from '../operation-options.js';
import { OutputNames } from '../output-names.js';
import { parsePageSelection } from '../page-selection.js';
import { hasPdfRasterizer } from '../../tools/optional-binaries.js';
import type { PdfOpContext } from '../types.js';

export async function pdfToImages(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  if (!hasPdfRasterizer()) {
    throw pdfError(
      'RASTERIZER_UNAVAILABLE',
      'PDF rasterization requires pdftoppm, mutool, or Ghostscript (LibreOffice is not used for PDF input)',
      503,
    );
  }
  const opts = normalizePdfOptions(ctx.options);
  const dpi =
    opts.dpi ??
    (opts.quality === 'fast' ? 96 : opts.quality === 'high' ? 200 : 150);

  ctx.progress.stage('rendering', 0.1, 'Rasterizing PDF pages');
  const { convertPdfToImages } = await import('../../convert/pdfRender.js');
  const { validatePdfInput } = await import('../../convert/pdfInspect.js');
  const inspect = await validatePdfInput(ctx.inputPaths[0], {
    originalName: ctx.primaryName,
  });

  // Optional page range: use maxPages when contiguous from start; otherwise full then filter is not ideal.
  // For selected ranges, pass maxPages only when pages is a prefix; otherwise rasterize all with max cap.
  let maxPages: number | undefined;
  if (opts.pages) {
    const selected = parsePageSelection(opts.pages, inspect.pageCount, { emptyMeansAll: false });
    // If selection is 1..N contiguous from start, limit
    const isPrefix =
      selected.length > 0 &&
      selected.every((v, i) => v === i) &&
      selected[selected.length - 1] === selected.length - 1;
    if (isPrefix) maxPages = selected.length;
    else {
      // For arbitrary ranges, rasterize up to last selected page
      maxPages = Math.max(...selected) + 1;
    }
  }

  const result = await convertPdfToImages({
    inputPath: ctx.inputPaths[0],
    outputDir: ctx.outputDir,
    format: opts.format,
    jobId: ctx.jobId,
    isCancelled: ctx.isCancelled,
    onProgress: (p, msg) => {
      ctx.progress.stage('rendering', Math.min(0.95, p / 100), msg || 'Rendering');
    },
    originalBaseName: path.basename(ctx.primaryName || 'pages', path.extname(ctx.primaryName || '')),
    workDir: path.join(ctx.workDir, 'pdf-to-images'),
    maxPages,
    dpi,
  });

  // Prefer naming helpers when multi-page zip / single image
  const outputName =
    result.outputMime === 'application/zip'
      ? OutputNames.pageImagesZip(ctx.primaryName)
      : result.outputName;

  ctx.progress.complete('completed');
  return {
    outputPath: result.outputPath,
    outputName,
    outputMime: result.outputMime,
    meta: {
      ...result.meta,
      // engine must be pdftoppm|mutool|ghostscript when provided by convertPdfToImages
    },
  };
}
