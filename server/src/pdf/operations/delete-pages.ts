import { PDFDocument } from 'pdf-lib';
import { badRequest } from '../../lib/errors.js';
import { pdfError } from '../errors.js';
import { loadPdfDocument } from '../load.js';
import { OutputNames } from '../output-names.js';
import { parsePageSelection } from '../page-selection.js';
import { normalizePdfOptions } from '../operation-options.js';
import { savePdfDocument } from '../save.js';
import type { PdfOpContext } from '../types.js';

export async function deletePages(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const opts = normalizePdfOptions(ctx.options);
  if (!opts.pages) throw badRequest('pages to delete required (e.g. "2,4-5")');
  ctx.progress.stage('preparing', 0.2);
  const doc = await loadPdfDocument(ctx.inputPaths[0]);
  const pageCount = doc.getPageCount();
  const toDelete = new Set(
    parsePageSelection(opts.pages, pageCount, { emptyMeansAll: false, dedupe: true }),
  );
  if (!toDelete.size) throw badRequest('No pages selected for deletion');

  const keep: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (!toDelete.has(i)) keep.push(i);
  }
  if (!keep.length) {
    throw pdfError(
      'PAGE_RANGE_INVALID',
      'Cannot delete all pages: result would be an empty PDF',
    );
  }

  ctx.progress.stage('processing', 0.5, `Removing ${toDelete.size} page(s)`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(doc, keep);
  copied.forEach((p) => out.addPage(p));

  return savePdfDocument({
    doc: out,
    outputDir: ctx.outputDir,
    outputName: OutputNames.deleted(ctx.primaryName),
    progress: ctx.progress,
    meta: {
      pages: keep.length,
      deleted: toDelete.size,
      remainingPages: keep.length,
      engine: 'pdf-lib',
    },
  });
}
