import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { badRequest } from '../../lib/errors.js';
import { throwIfCancelled, pdfError } from '../errors.js';
import { OutputNames } from '../output-names.js';
import { normalizePdfOptions } from '../operation-options.js';
import { savePdfDocument } from '../save.js';
import type { PdfOpContext } from '../types.js';

const A4 = { w: 595.28, h: 841.89 };
const LETTER = { w: 612, h: 792 };
/** Cap page dimension in PDF points (~200 inches) to prevent unsafe sizes */
const MAX_PAGE_PT = 14400;
const MAX_IMAGE_EDGE_PX = 10000;

export async function imagesToPdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths.length) throw badRequest('Images required');
  const opts = normalizePdfOptions(ctx.options);
  ctx.progress.stage('preparing', 0.1, 'Preparing images');
  const out = await PDFDocument.create();
  const n = ctx.inputPaths.length;

  for (let i = 0; i < n; i++) {
    throwIfCancelled(ctx.isCancelled);
    const imgPath = ctx.inputPaths[i]!;
    const label = ctx.inputNames[i] || path.basename(imgPath);
    ctx.progress.batch('processing', i, n, `Adding image ${i + 1}/${n}`);

    let pipeline = sharp(imgPath).rotate(); // EXIF auto-orientation
    const meta = await pipeline.metadata();
    let width = meta.width || 0;
    let height = meta.height || 0;
    if (!width || !height) {
      throw badRequest(`Could not read image dimensions: ${path.basename(label)}`);
    }
    // Downscale absurdly large images before embed
    if (width > MAX_IMAGE_EDGE_PX || height > MAX_IMAGE_EDGE_PX) {
      pipeline = pipeline.resize({
        width: MAX_IMAGE_EDGE_PX,
        height: MAX_IMAGE_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      });
      const resized = await pipeline.toBuffer({ resolveWithObject: true });
      width = resized.info.width;
      height = resized.info.height;
      pipeline = sharp(resized.data);
    }

    // Prefer PNG for lossless; JPEG for photos when source is jpeg
    const isJpeg = /jpe?g/i.test(meta.format || '') || /\.jpe?g$/i.test(label);
    let embedded;
    if (isJpeg) {
      const jpg = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      embedded = await out.embedJpg(jpg);
    } else {
      const png = await pipeline.png().toBuffer();
      embedded = await out.embedPng(png);
    }

    const pageDims = resolvePageSize(opts.pageSize, opts.orientation, embedded.width, embedded.height);
    const margin = Math.min(opts.marginPt, Math.min(pageDims.w, pageDims.h) / 4);
    const contentW = Math.max(1, pageDims.w - margin * 2);
    const contentH = Math.max(1, pageDims.h - margin * 2);

    const draw = fitImage(
      embedded.width,
      embedded.height,
      contentW,
      contentH,
      opts.fit,
    );

    const page = out.addPage([pageDims.w, pageDims.h]);
    page.drawImage(embedded, {
      x: margin + draw.x,
      y: margin + draw.y,
      width: draw.w,
      height: draw.h,
    });
  }

  ctx.progress.batch('processing', n, n, `Added ${n} image(s)`);
  return savePdfDocument({
    doc: out,
    outputDir: ctx.outputDir,
    outputName: OutputNames.imagesToPdf(),
    progress: ctx.progress,
    meta: {
      pages: n,
      engine: 'pdf-lib+sharp',
      pageSize: opts.pageSize,
      fit: opts.fit,
    },
  });
}

function resolvePageSize(
  mode: string,
  orientation: string,
  imgW: number,
  imgH: number,
): { w: number; h: number } {
  let w: number;
  let h: number;
  if (mode === 'a4') {
    w = A4.w;
    h = A4.h;
  } else if (mode === 'letter') {
    w = LETTER.w;
    h = LETTER.h;
  } else {
    // fit-to-image / original: use image pixel dims as points (1px≈1pt) with cap
    w = Math.min(MAX_PAGE_PT, Math.max(1, imgW));
    h = Math.min(MAX_PAGE_PT, Math.max(1, imgH));
  }

  if (orientation === 'landscape' && h > w) {
    [w, h] = [h, w];
  } else if (orientation === 'portrait' && w > h) {
    [w, h] = [h, w];
  } else if (orientation === 'auto' && (mode === 'a4' || mode === 'letter')) {
    // Match image aspect
    if (imgW > imgH && h > w) [w, h] = [h, w];
  }

  if (w > MAX_PAGE_PT || h > MAX_PAGE_PT) {
    throw pdfError('PDF_TOO_LARGE', 'Page dimensions exceed safe limits');
  }
  return { w, h };
}

function fitImage(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
  fit: string,
): { x: number; y: number; w: number; h: number } {
  if (fit === 'stretch') {
    return { x: 0, y: 0, w: boxW, h: boxH };
  }
  const scale =
    fit === 'cover'
      ? Math.max(boxW / imgW, boxH / imgH)
      : Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = (boxW - w) / 2;
  const y = (boxH - h) / 2;
  return { x, y, w, h };
}
