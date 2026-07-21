/**
 * PDF operations barrel — lazy loaders to keep startup light.
 */
import type { PdfOperationHandler } from './types.js';

export type PdfOpId =
  | 'merge'
  | 'split'
  | 'rotate'
  | 'reorder'
  | 'extract'
  | 'delete-pages'
  | 'duplicate-pages'
  | 'from-images'
  | 'to-images'
  | 'to-text'
  | 'extract-text'
  | 'ocr'
  | 'compress'
  | 'compress-structural'
  | 'compress-advanced'
  | 'inspect'
  | 'repair';

const loaders: Record<string, () => Promise<PdfOperationHandler>> = {
  merge: async () => (await import('./operations/merge.js')).mergePdfs,
  split: async () => (await import('./operations/split.js')).splitPdf,
  rotate: async () => (await import('./operations/rotate.js')).rotatePdf,
  reorder: async () => (await import('./operations/reorder.js')).reorderPdf,
  extract: async () => (await import('./operations/extract.js')).extractPages,
  'delete-pages': async () => (await import('./operations/delete-pages.js')).deletePages,
  'duplicate-pages': async () => (await import('./operations/duplicate-pages.js')).duplicatePages,
  'from-images': async () => (await import('./operations/images-to-pdf.js')).imagesToPdf,
  'to-images': async () => (await import('./operations/pdf-to-images.js')).pdfToImages,
  'to-text': async () => (await import('./operations/pdf-to-text.js')).pdfToText,
  'extract-text': async () => (await import('./operations/pdf-to-text.js')).pdfToText,
  ocr: async () => (await import('./operations/ocr.js')).ocrPdf,
  compress: async () => (await import('./operations/compress.js')).compressPdf,
  'compress-structural': async () => {
    const { compressPdf } = await import('./operations/compress.js');
    return async (ctx) =>
      compressPdf({
        ...ctx,
        options: { ...ctx.options, operation: 'compress-structural', compressMode: 'structural' },
      });
  },
  'compress-advanced': async () => {
    const { compressPdf } = await import('./operations/compress.js');
    return async (ctx) =>
      compressPdf({
        ...ctx,
        options: { ...ctx.options, operation: 'compress-advanced', compressMode: 'advanced' },
      });
  },
  inspect: async () => (await import('./operations/inspect.js')).inspectPdf,
  repair: async () => (await import('./operations/repair.js')).repairPdf,
};

export async function getPdfOperation(op: string): Promise<PdfOperationHandler | null> {
  const load = loaders[op];
  if (!load) return null;
  return load();
}

export { parsePages, parsePageSelection } from './page-selection.js';
export { buildOutputName, OutputNames } from './output-names.js';
export { normalizePdfOptions, redactSensitiveOptions } from './operation-options.js';
export { ProgressTracker } from './progress.js';
export { pdfError } from './errors.js';
