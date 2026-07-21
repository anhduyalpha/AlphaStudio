import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { badRequest } from '../../lib/errors.js';
import { throwIfCancelled } from '../errors.js';
import { loadPdfDocument } from '../load.js';
import { OutputNames } from '../output-names.js';
import { savePdfDocument } from '../save.js';
import type { PdfOpContext } from '../types.js';

export async function mergePdfs(ctx: PdfOpContext) {
  if (ctx.inputPaths.length < 1) throw badRequest('At least one PDF required');
  ctx.progress.stage('preparing', 0, 'Preparing merge');
  const out = await PDFDocument.create();
  let totalPages = 0;
  const n = ctx.inputPaths.length;

  for (let i = 0; i < n; i++) {
    throwIfCancelled(ctx.isCancelled);
    const p = ctx.inputPaths[i]!;
    const label = ctx.inputNames[i] || path.basename(p);
    ctx.progress.batch('processing', i, n, `Merging ${i + 1}/${n}: ${safeName(label)}`);
    let doc: PDFDocument;
    try {
      doc = await loadPdfDocument(p);
    } catch (e) {
      // Identify exact file that failed
      const msg = e instanceof Error ? e.message : 'Invalid PDF';
      throw badRequest(`Merge failed on file "${safeName(label)}": ${msg}`);
    }
    const indices = doc.getPageIndices();
    const pages = await out.copyPages(doc, indices);
    for (const page of pages) out.addPage(page);
    totalPages += indices.length;
    ctx.progress.batch('processing', i + 1, n, `Merged ${i + 1}/${n}`);
  }

  const firstName = ctx.inputNames[0] || ctx.primaryName;
  return savePdfDocument({
    doc: out,
    outputDir: ctx.outputDir,
    outputName: OutputNames.merged(firstName),
    progress: ctx.progress,
    meta: { pages: totalPages, files: n, engine: 'pdf-lib' },
  });
}

function safeName(name: string): string {
  return path.basename(name).slice(0, 80);
}
