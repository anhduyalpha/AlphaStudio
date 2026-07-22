import { PDFDocument } from 'pdf-lib';
import { badRequest } from '../../lib/errors.js';
import { loadPdfDocument } from '../load.js';
import { OutputNames } from '../output-names.js';
import { parsePageSelection } from '../page-selection.js';
import { normalizePdfOptions } from '../operation-options.js';
import { savePdfDocument } from '../save.js';
import type { PdfOpContext } from '../types.js';

/**
 * Duplicate selected pages.
 * - Default: append each selected page copy immediately after its original.
 * - insertAt (0-based target position in final plan): insert all duplicates at that position.
 * Original pages are not modified beyond the requested duplication plan.
 */
export async function duplicatePages(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const opts = normalizePdfOptions(ctx.options);
  if (!opts.pages) throw badRequest('pages to duplicate required (e.g. "1,3")');
  ctx.progress.stage('preparing', 0.2);
  const doc = await loadPdfDocument(ctx.inputPaths[0]);
  const pageCount = doc.getPageCount();
  const selected = parsePageSelection(opts.pages, pageCount, {
    emptyMeansAll: false,
    dedupe: true,
  });
  if (!selected.length) throw badRequest('No pages selected for duplication');

  // Build plan as list of source indices
  let plan: number[];
  if (opts.insertAt != null) {
    // Start with original order, insert copies of selected at insertAt
    plan = Array.from({ length: pageCount }, (_, i) => i);
    const insertAt = Math.min(Math.max(0, opts.insertAt), plan.length);
    const copies = [...selected];
    plan.splice(insertAt, 0, ...copies);
  } else {
    // After each selected original, insert a copy
    const selectedSet = new Set(selected);
    plan = [];
    for (let i = 0; i < pageCount; i++) {
      plan.push(i);
      if (selectedSet.has(i)) plan.push(i);
    }
  }

  ctx.progress.stage('processing', 0.5, 'Duplicating pages');
  const out = await PDFDocument.create();
  const copied = await out.copyPages(doc, plan);
  copied.forEach((p) => out.addPage(p));

  return savePdfDocument({
    doc: out,
    outputDir: ctx.outputDir,
    outputName: OutputNames.duplicated(ctx.primaryName),
    progress: ctx.progress,
    meta: {
      pages: out.getPageCount(),
      duplicated: selected.length,
      engine: 'pdf-lib',
    },
  });
}
