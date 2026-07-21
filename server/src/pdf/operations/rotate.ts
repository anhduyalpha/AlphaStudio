import { degrees } from 'pdf-lib';
import { badRequest } from '../../lib/errors.js';
import { throwIfCancelled } from '../errors.js';
import { loadPdfDocument } from '../load.js';
import { OutputNames } from '../output-names.js';
import { parsePageSelection } from '../page-selection.js';
import { normalizePdfOptions } from '../operation-options.js';
import { savePdfDocument } from '../save.js';
import type { PdfOpContext } from '../types.js';

export async function rotatePdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const opts = normalizePdfOptions(ctx.options);
  const angle = opts.angle;
  if (![0, 90, 180, 270].includes(angle)) {
    throw badRequest('Angle must be 0, 90, 180, or 270 degrees');
  }
  ctx.progress.stage('preparing', 0.2);
  const doc = await loadPdfDocument(ctx.inputPaths[0]);
  const pagesSpec = parsePageSelection(opts.pages, doc.getPageCount());
  let i = 0;
  for (const idx of pagesSpec) {
    throwIfCancelled(ctx.isCancelled);
    const page = doc.getPage(idx);
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + angle + 360) % 360));
    i += 1;
    ctx.progress.batch('processing', i, pagesSpec.length, `Rotated page ${i}/${pagesSpec.length}`);
  }
  return savePdfDocument({
    doc,
    outputDir: ctx.outputDir,
    outputName: OutputNames.rotated(ctx.primaryName),
    progress: ctx.progress,
    meta: { pages: doc.getPageCount(), rotated: pagesSpec.length, angle, engine: 'pdf-lib' },
  });
}
