import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { assertValidOutput } from '../../convert/quality.js';
import { badRequest } from '../../lib/errors.js';
import { randomServerName } from '../../lib/paths.js';
import { throwIfCancelled, pdfError } from '../errors.js';
import { loadPdfDocument } from '../load.js';
import { OutputNames, baseFromOriginal } from '../output-names.js';
import { parsePageSelection, formatPageRangeLabel } from '../page-selection.js';
import { normalizePdfOptions } from '../operation-options.js';
import type { PdfOpContext } from '../types.js';

export async function splitPdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const opts = normalizePdfOptions(ctx.options);
  ctx.progress.stage('preparing', 0.2, 'Preparing split');
  const doc = await loadPdfDocument(ctx.inputPaths[0]);
  const pageCount = doc.getPageCount();

  // Build groups of zero-based page indices
  const groups = buildSplitGroups(opts, pageCount);
  if (!groups.length) throw badRequest('Split produced no groups');

  const base = baseFromOriginal(ctx.primaryName);
  const single = groups.length === 1 && groups[0]!.length > 0;

  // Single range → single PDF (not zip) for better UX
  if (single && opts.splitMode === 'ranges') {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(doc, groups[0]!);
    pages.forEach((p) => out.addPage(p));
    const rangeLabel = formatPageRangeLabel(groups[0]!);
    const { savePdfDocument } = await import('../save.js');
    return savePdfDocument({
      doc: out,
      outputDir: ctx.outputDir,
      outputName: OutputNames.extracted(ctx.primaryName, rangeLabel),
      progress: ctx.progress,
      meta: { pages: groups[0]!.length, groups: 1, engine: 'pdf-lib', splitMode: opts.splitMode },
    });
  }

  ctx.progress.stage('processing', 0, 'Splitting pages');
  const { default: archiver } = await import('archiver');
  const zipName = randomServerName('.zip');
  const zipPath = path.join(ctx.outputDir, zipName);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('error', reject);
  });
  archive.pipe(output);

  let gi = 0;
  for (const group of groups) {
    throwIfCancelled(ctx.isCancelled);
    gi += 1;
    const singleDoc = await PDFDocument.create();
    const copied = await singleDoc.copyPages(doc, group);
    copied.forEach((p) => singleDoc.addPage(p));
    const bytes = await singleDoc.save();
    if (!bytes.length) {
      throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: empty split part');
    }
    // Predictable safe zip entry names (no path traversal)
    const rangeLabel = formatPageRangeLabel(group);
    const entryName =
      groups.length === pageCount && group.length === 1
        ? `${base}-page-${group[0]! + 1}.pdf`
        : `${base}-part-${String(gi).padStart(3, '0')}-pages-${rangeLabel}.pdf`;
    const safeEntry = entryName.replace(/[/\\]/g, '_');
    archive.append(Buffer.from(bytes), { name: safeEntry });
    ctx.progress.batch('processing', gi, groups.length, `Split part ${gi}/${groups.length}`);
  }

  ctx.progress.stage('packaging', 0.5, 'Packaging ZIP');
  await archive.finalize();
  await done;
  ctx.progress.stage('validating-output', 0.8);
  assertValidOutput(zipPath, { label: 'PDF split zip', expectedExt: '.zip', minBytes: 1 });
  ctx.progress.complete('completed');

  return {
    outputPath: zipPath,
    outputName: OutputNames.splitZip(ctx.primaryName),
    outputMime: 'application/zip',
    meta: {
      outputKind: 'zip',
      pageCount: groups.reduce((total, group) => total + group.length, 0),
      pages: groups.reduce((total, group) => total + group.length, 0),
      sourcePageCount: pageCount,
      parts: groups.length,
      engine: 'pdf-lib',
      splitMode: opts.splitMode,
    },
  };
}

function buildSplitGroups(
  opts: ReturnType<typeof normalizePdfOptions>,
  pageCount: number,
): number[][] {
  switch (opts.splitMode) {
    case 'every-page': {
      return Array.from({ length: pageCount }, (_, i) => [i]);
    }
    case 'every-n': {
      const n = opts.everyN || 1;
      const groups: number[][] = [];
      for (let i = 0; i < pageCount; i += n) {
        const g: number[] = [];
        for (let j = i; j < Math.min(pageCount, i + n); j++) g.push(j);
        groups.push(g);
      }
      return groups;
    }
    case 'ranges': {
      const pages = parsePageSelection(opts.pages, pageCount, { emptyMeansAll: true });
      // One PDF with selected pages, or if user wants one-file-per contiguous run:
      // Default for ranges mode with multi selection: one group of all selected pages.
      // Contiguous splitting: if splitByContiguous true — keep simple one group.
      return [pages];
    }
    case 'groups': {
      if (!opts.groups?.length) {
        throw badRequest('groups required for split mode "groups" (semicolon-separated page specs)');
      }
      return opts.groups.map((g) => parsePageSelection(g, pageCount, { emptyMeansAll: false }));
    }
    default:
      return Array.from({ length: pageCount }, (_, i) => [i]);
  }
}
