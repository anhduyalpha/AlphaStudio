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

  // Explicit zero-based selection — convertPdfToImages filters raster output to these pages.
  let pageIndices: number[] | undefined;
  let maxPages: number | undefined;
  if (opts.pages) {
    pageIndices = parsePageSelection(opts.pages, inspect.pageCount, { emptyMeansAll: false });
    maxPages = Math.max(...pageIndices) + 1;
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
    pageIndices,
  });

  const selectedPages = pageIndices
    ? pageIndices.map((i) => i + 1)
    : (result.meta?.selectedPages as number[] | undefined);
  const ext = opts.format === 'jpeg' ? '.jpg' : '.png';
  const outputName =
    result.outputMime === 'application/zip'
      ? OutputNames.pageImagesZip(ctx.primaryName)
      : OutputNames.pageImage(ctx.primaryName, selectedPages?.[0] || 1, ext);

  ctx.progress.complete('completed');
  return {
    outputPath: result.outputPath,
    outputName,
    outputMime: result.outputMime,
    meta: {
      ...result.meta,
      outputKind:
        result.outputMime === 'application/zip'
          ? 'zip'
          : opts.format === 'jpeg'
            ? 'jpeg'
            : 'png',
      pageCount: selectedPages?.length ?? Number(result.meta?.pages || 0),
      selectedPages: selectedPages || result.meta?.selectedPages,
    },
  };
}
