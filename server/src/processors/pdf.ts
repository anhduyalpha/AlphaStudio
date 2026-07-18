import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import sharp from 'sharp';
import {
  assertValidOutput,
  pdfCompressOptions,
  resolveQualityPreset,
} from '../convert/quality.js';
import {
  pdfError,
  sanitizeUserError,
  validatePdfInput,
} from '../convert/pdfInspect.js';
import { convertPdfToImages, pdfToImagesAvailable } from '../convert/pdfRender.js';
import { badRequest, unavailable } from '../lib/errors.js';
import { randomServerName } from '../lib/paths.js';
import type { ProcessContext, ProcessResult } from './types.js';

export async function processPdf(ctx: ProcessContext): Promise<ProcessResult> {
  const op = String(ctx.options.operation || 'merge');
  ctx.onProgress(5, 'validating');

  if (ctx.isCancelled()) throw badRequest('Cancelled');

  // Pre-validate all PDF inputs (except from-images which takes images).
  // Pass originalName as-is so extension/MIME mismatches are not rewritten away.
  if (op !== 'from-images') {
    for (let i = 0; i < ctx.inputPaths.length; i++) {
      const p = ctx.inputPaths[i];
      const name = ctx.inputNames[i] || path.basename(p);
      const declaredMime =
        typeof ctx.options.mime === 'string'
          ? ctx.options.mime
          : typeof ctx.options.contentType === 'string'
            ? ctx.options.contentType
            : undefined;
      try {
        await validatePdfInput(p, { originalName: name, declaredMime });
      } catch (e) {
        if (e && typeof e === 'object' && (e as { name?: string }).name === 'AppError') throw e;
        throw badRequest(sanitizeUserError(e instanceof Error ? e.message : 'Invalid PDF'));
      }
    }
  }

  ctx.onProgress(12, 'inspecting');

  switch (op) {
    case 'merge':
      return mergePdfs(ctx);
    case 'split':
      return splitPdf(ctx);
    case 'rotate':
      return rotatePdf(ctx);
    case 'reorder':
      return reorderPdf(ctx);
    case 'compress':
      return compressPdf(ctx);
    case 'extract':
      return extractPages(ctx);
    case 'from-images':
      return imagesToPdf(ctx);
    case 'to-images':
      return pdfToImages(ctx);
    case 'to-text':
    case 'extract-text':
      return pdfToText(ctx);
    default:
      throw badRequest(`Unknown PDF operation: ${op}`);
  }
}

async function loadDoc(filePath: string) {
  const bytes = fs.readFileSync(filePath);
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load failed';
    if (/encrypt|password|security/i.test(msg)) {
      throw pdfError('PASSWORD_REQUIRED', 'Password required: this PDF is encrypted');
    }
    throw pdfError('CORRUPTED_PDF', `Corrupted PDF: ${sanitizeUserError(msg)}`);
  }
}

async function mergePdfs(ctx: ProcessContext): Promise<ProcessResult> {
  if (ctx.inputPaths.length < 1) throw badRequest('At least one PDF required');
  ctx.onProgress(20, 'extracting');
  const out = await PDFDocument.create();
  let i = 0;
  for (const p of ctx.inputPaths) {
    if (ctx.isCancelled()) throw badRequest('Cancelled');
    const doc = await loadDoc(p);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => out.addPage(page));
    i += 1;
    ctx.onProgress(20 + (60 * i) / ctx.inputPaths.length, `Merged ${i}/${ctx.inputPaths.length}`);
  }
  ctx.onProgress(85, 'packaging');
  return savePdf(ctx, out, 'merged.pdf');
}

async function splitPdf(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  ctx.onProgress(20, 'extracting');
  const doc = await loadDoc(ctx.inputPaths[0]);
  const indices = doc.getPageIndices();
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

  for (const idx of indices) {
    if (ctx.isCancelled()) throw badRequest('Cancelled');
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(doc, [idx]);
    single.addPage(page);
    const bytes = await single.save();
    archive.append(Buffer.from(bytes), { name: `page-${idx + 1}.pdf` });
    ctx.onProgress(20 + (60 * (idx + 1)) / indices.length, `Split page ${idx + 1}`);
  }
  ctx.onProgress(90, 'packaging');
  await archive.finalize();
  await done;
  assertValidOutput(zipPath, { label: 'PDF split zip', expectedExt: '.zip', minBytes: 1 });
  ctx.onProgress(100, 'completed');
  return {
    outputPath: zipPath,
    outputName: 'split-pages.zip',
    outputMime: 'application/zip',
    meta: { pages: indices.length },
  };
}

async function rotatePdf(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const angle = Number(ctx.options.angle ?? 90);
  if (![0, 90, 180, 270, -90, -180, -270].includes(angle)) {
    throw badRequest('Angle must be a multiple of 90');
  }
  ctx.onProgress(30, 'extracting');
  const doc = await loadDoc(ctx.inputPaths[0]);
  const pagesSpec = parsePages(ctx.options.pages, doc.getPageCount());
  for (const i of pagesSpec) {
    doc.getPage(i).setRotation(degrees((doc.getPage(i).getRotation().angle + angle + 360) % 360));
  }
  ctx.onProgress(80, 'packaging');
  return savePdf(ctx, doc, 'rotated.pdf');
}

async function reorderPdf(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  ctx.onProgress(30, 'extracting');
  const doc = await loadDoc(ctx.inputPaths[0]);
  const order = parsePages(ctx.options.order ?? ctx.options.pages, doc.getPageCount());
  if (!order.length) throw badRequest('Page order required');
  const out = await PDFDocument.create();
  const copied = await out.copyPages(doc, order);
  copied.forEach((p) => out.addPage(p));
  ctx.onProgress(80, 'packaging');
  return savePdf(ctx, out, 'reordered.pdf');
}

async function extractPages(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  ctx.onProgress(30, 'extracting');
  const doc = await loadDoc(ctx.inputPaths[0]);
  const pages = parsePages(ctx.options.pages, doc.getPageCount());
  if (!pages.length) throw badRequest('pages required (e.g. "1-3,5")');
  const out = await PDFDocument.create();
  const copied = await out.copyPages(doc, pages);
  copied.forEach((p) => out.addPage(p));
  ctx.onProgress(80, 'packaging');
  return savePdf(ctx, out, 'extracted.pdf');
}

async function compressPdf(ctx: ProcessContext): Promise<ProcessResult> {
  // pdf-lib path: structural compression only — preserve page size, fonts, vectors.
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const preset = resolveQualityPreset(ctx.options);
  const compressOpts = pdfCompressOptions(preset);
  ctx.onProgress(30, 'optimizing');
  const doc = await loadDoc(ctx.inputPaths[0]);
  ctx.onProgress(50, `optimizing (structural, ${preset})`);
  const bytes = await doc.save({
    useObjectStreams: compressOpts.useObjectStreams,
    objectsPerTick: compressOpts.objectsPerTick,
  });
  if (!bytes.length) {
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: empty compressed PDF');
  }
  const name = randomServerName('.pdf');
  const outputPath = path.join(ctx.outputDir, name);
  fs.writeFileSync(outputPath, bytes);
  assertValidOutput(outputPath, { label: 'PDF output', expectedExt: '.pdf' });
  ctx.onProgress(100, 'completed');
  return {
    outputPath,
    outputName: 'compressed.pdf',
    outputMime: 'application/pdf',
    meta: {
      originalSize: fs.statSync(ctx.inputPaths[0]).size,
      size: bytes.length,
      qualityPreset: preset,
      structuralOnly: true,
      useObjectStreams: compressOpts.useObjectStreams,
      note: compressOpts.note,
    },
  };
}

async function imagesToPdf(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths.length) throw badRequest('Images required');
  ctx.onProgress(20, 'extracting');
  const out = await PDFDocument.create();
  let i = 0;
  for (const imgPath of ctx.inputPaths) {
    if (ctx.isCancelled()) throw badRequest('Cancelled');
    const png = await sharp(imgPath).png().toBuffer();
    const embedded = await out.embedPng(png);
    const page = out.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    i += 1;
    ctx.onProgress(20 + (60 * i) / ctx.inputPaths.length, `Added image ${i}`);
  }
  ctx.onProgress(85, 'packaging');
  return savePdf(ctx, out, 'images.pdf');
}

async function pdfToImages(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  if (!pdfToImagesAvailable()) {
    throw unavailable(
      'pdf.to-images',
      'PDF rasterization requires pdftoppm, mutool, or Ghostscript (LibreOffice is not used for PDF input)',
    );
  }
  const formatRaw = String(ctx.options.format || 'png').toLowerCase();
  const format = formatRaw === 'jpg' || formatRaw === 'jpeg' ? 'jpeg' : 'png';
  ctx.onProgress(20, 'rendering');
  const result = await convertPdfToImages({
    inputPath: ctx.inputPaths[0],
    outputDir: ctx.outputDir,
    format,
    jobId: ctx.jobId,
    isCancelled: ctx.isCancelled,
    onProgress: (p, msg) => ctx.onProgress(20 + p * 0.75, msg),
    originalBaseName: path.basename(ctx.inputNames[0] || 'pages', path.extname(ctx.inputNames[0] || '')),
    workDir: path.join(ctx.workDir, 'pdf-to-images'),
  });
  return {
    outputPath: result.outputPath,
    outputName: result.outputName,
    outputMime: result.outputMime,
    meta: result.meta,
  };
}

async function pdfToText(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const { extractPdfText } = await import('../convert/pdfText.js');
  const ocr = Boolean(ctx.options.ocr || ctx.options.useOcr || ctx.options.enableOcr);
  ctx.onProgress(20, 'extracting');
  const result = await extractPdfText({
    inputPath: ctx.inputPaths[0],
    outputDir: ctx.outputDir,
    ocr,
    ocrLang: typeof ctx.options.ocrLang === 'string' ? ctx.options.ocrLang : undefined,
    originalBaseName: path.basename(ctx.inputNames[0] || 'document', path.extname(ctx.inputNames[0] || '')),
    jobId: ctx.jobId,
    isCancelled: ctx.isCancelled,
    onProgress: (p, msg) => ctx.onProgress(20 + p * 0.75, msg),
  });
  return {
    outputPath: result.outputPath,
    outputName: result.outputName,
    outputMime: 'text/plain',
    meta: {
      engine: result.engine,
      pageCount: result.pageCount,
      charCount: result.charCount,
      scanned: result.scanned,
      usedOcr: result.usedOcr,
    },
  };
}

async function savePdf(ctx: ProcessContext, doc: PDFDocument, downloadName: string): Promise<ProcessResult> {
  const bytes = await doc.save();
  if (!bytes.length) {
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: empty PDF');
  }
  const name = randomServerName('.pdf');
  const outputPath = path.join(ctx.outputDir, name);
  fs.writeFileSync(outputPath, bytes);
  assertValidOutput(outputPath, { label: 'PDF output', expectedExt: '.pdf' });
  ctx.onProgress(100, 'completed');
  return {
    outputPath,
    outputName: downloadName,
    outputMime: 'application/pdf',
    meta: { pages: doc.getPageCount(), size: bytes.length },
  };
}

/**
 * Parse 1-based page list into 0-based indices.
 * Supports: "1,3,5", "1-3", open ranges "1-" (to end) and "-3" (from start), empty = all.
 */
export function parsePages(spec: unknown, pageCount: number): number[] {
  if (Array.isArray(spec)) {
    return spec.map((n) => Number(n) - 1).filter((i) => i >= 0 && i < pageCount);
  }
  if (typeof spec !== 'string' || !spec.trim()) {
    return Array.from({ length: pageCount }, (_, i) => i);
  }
  const result: number[] = [];
  for (const part of spec.split(',')) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes('-')) {
      const segs = p.split('-');
      const left = segs[0].trim();
      const right = segs.slice(1).join('-').trim();
      let a = left === '' ? 1 : Number(left);
      let b = right === '' ? pageCount : Number(right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (a < 1) a = 1;
      if (b > pageCount) b = pageCount;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= pageCount) result.push(i - 1);
      }
    } else {
      const n = Number(p);
      if (n >= 1 && n <= pageCount) result.push(n - 1);
    }
  }
  return [...new Set(result)];
}

void rgb;
