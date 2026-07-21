import { PDFDocument } from 'pdf-lib';
import { badRequest } from '../../lib/errors.js';
import { pdfError } from '../errors.js';
import { loadPdfDocument } from '../load.js';
import { OutputNames } from '../output-names.js';
import { parsePageSelection } from '../page-selection.js';
import { normalizePdfOptions } from '../operation-options.js';
import { savePdfDocument } from '../save.js';
import type { PdfOpContext } from '../types.js';

/**
 * Reorder pages. By default rejects missing pages and unintended duplicates
 * (full permutation required). Set allowDuplicates to permit duplicate indices
 * (which may drop pages not listed).
 */
export async function reorderPdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const opts = normalizePdfOptions(ctx.options);
  ctx.progress.stage('preparing', 0.2);
  const doc = await loadPdfDocument(ctx.inputPaths[0]);
  const pageCount = doc.getPageCount();
  const orderSpec = opts.order ?? opts.pages;
  if (!orderSpec) throw badRequest('Page order required (e.g. "3,1,2")');

  const order = parsePageSelection(orderSpec, pageCount, {
    dedupe: !opts.allowDuplicates,
    emptyMeansAll: false,
  });
  if (!order.length) throw badRequest('Page order required');

  if (!opts.allowDuplicates) {
    const unique = new Set(order);
    if (unique.size !== order.length) {
      throw pdfError(
        'PAGE_RANGE_INVALID',
        'Reorder order contains duplicate pages. Enable allowDuplicates to permit copies.',
      );
    }
    // Full document reorder: require every page exactly once when order length matches pageCount
    // or when user provided a complete permutation. If partial order without allowDuplicates,
    // only listed pages are kept (explicit extract-like reorder) — but warn via validation:
    // Spec: "without unintentionally losing pages". So require full coverage unless partial flag.
    const partial = ctx.options.partial === true || ctx.options.allowPageLoss === true;
    if (!partial && unique.size !== pageCount) {
      const missing: number[] = [];
      for (let i = 0; i < pageCount; i++) {
        if (!unique.has(i)) missing.push(i + 1);
      }
      throw pdfError(
        'PAGE_RANGE_INVALID',
        `Reorder would drop pages: missing ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}. Include all pages or set partial=true.`,
        400,
        { missingPages: missing },
      );
    }
  }

  ctx.progress.stage('processing', 0.4, 'Reordering pages');
  const out = await PDFDocument.create();
  const copied = await out.copyPages(doc, order);
  copied.forEach((p) => out.addPage(p));

  return savePdfDocument({
    doc: out,
    outputDir: ctx.outputDir,
    outputName: OutputNames.reordered(ctx.primaryName),
    progress: ctx.progress,
    meta: {
      pages: out.getPageCount(),
      engine: 'pdf-lib',
      allowDuplicates: opts.allowDuplicates,
    },
  });
}
