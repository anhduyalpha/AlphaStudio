import { PDFDocument } from 'pdf-lib';
import { badRequest } from '../../lib/errors.js';
import { loadPdfDocument } from '../load.js';
import { OutputNames } from '../output-names.js';
import { formatPageRangeLabel, parsePageSelection } from '../page-selection.js';
import { normalizePdfOptions } from '../operation-options.js';
import { savePdfDocument } from '../save.js';
import type { PdfOpContext } from '../types.js';

export async function extractPages(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const opts = normalizePdfOptions(ctx.options);
  if (!opts.pages) throw badRequest('pages required (e.g. "1-3,5")');
  ctx.progress.stage('preparing', 0.2);
  const doc = await loadPdfDocument(ctx.inputPaths[0]);
  const pages = parsePageSelection(opts.pages, doc.getPageCount(), { emptyMeansAll: false });
  if (!pages.length) throw badRequest('pages required (e.g. "1-3,5")');

  // Preserve basic metadata when available
  ctx.progress.stage('processing', 0.5, 'Extracting pages');
  const out = await PDFDocument.create();
  try {
    const title = doc.getTitle();
    if (title) out.setTitle(title);
    const author = doc.getAuthor();
    if (author) out.setAuthor(author);
  } catch {
    /* optional */
  }
  const copied = await out.copyPages(doc, pages);
  copied.forEach((p) => out.addPage(p));

  const rangeLabel = formatPageRangeLabel(pages);
  return savePdfDocument({
    doc: out,
    outputDir: ctx.outputDir,
    outputName: OutputNames.extracted(ctx.primaryName, rangeLabel),
    progress: ctx.progress,
    meta: { pages: pages.length, range: rangeLabel, engine: 'pdf-lib' },
  });
}
