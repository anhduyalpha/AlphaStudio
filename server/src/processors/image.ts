import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { badRequest } from '../lib/errors.js';
import { randomServerName } from '../lib/paths.js';
import {
  assertValidOutput,
  imageEncodeOptions,
  resolveNumericQuality,
  resolveQualityPreset,
  sharpFormatOptions,
} from '../convert/quality.js';
import type { ProcessContext, ProcessResult } from './types.js';

const FORMAT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

export async function processImage(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('Image input required');
  const op = String(ctx.options.operation || 'compress');
  const input = ctx.inputPaths[0];
  ctx.onProgress(15, 'Loading image');

  if (ctx.isCancelled()) throw badRequest('Cancelled');

  const preset = resolveQualityPreset(ctx.options);
  const numericQuality = resolveNumericQuality(ctx.options);
  const encodeBase = imageEncodeOptions(preset, String(ctx.options.format || 'png'));

  // Auto-rotate from EXIF orientation so pixels match visual orientation
  let pipeline = sharp(input, { failOn: 'error' }).rotate();
  const meta = await sharp(input, { failOn: 'error' }).metadata();
  ctx.onProgress(30, 'Processing');

  switch (op) {
    case 'resize': {
      const width = num(ctx.options.width);
      const height = num(ctx.options.height);
      if (!width && !height) throw badRequest('width and/or height required');
      const withoutEnlargement =
        ctx.options.withoutEnlargement !== undefined
          ? Boolean(ctx.options.withoutEnlargement)
          : encodeBase.withoutEnlargementDefault;
      const fitValue = String(ctx.options.fit || 'inside');
      const fit = (['cover', 'contain', 'fill', 'inside', 'outside'].includes(fitValue)
        ? fitValue
        : 'inside') as 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
      pipeline = pipeline.resize({
        width: width || undefined,
        height: height || undefined,
        fit,
        // Preserve aspect ratio via fit:inside (default); never upscale unless opted in
        withoutEnlargement,
        kernel: encodeBase.kernel,
      });
      break;
    }
    case 'crop': {
      const left = num(ctx.options.left) ?? 0;
      const top = num(ctx.options.top) ?? 0;
      const width = num(ctx.options.width);
      const height = num(ctx.options.height);
      if (!width || !height) throw badRequest('crop width and height required');
      pipeline = pipeline.extract({ left, top, width, height });
      break;
    }
    case 'rotate': {
      // Additional user angle on top of EXIF-corrected orientation
      const angle = num(ctx.options.angle) ?? 90;
      pipeline = pipeline.rotate(angle);
      break;
    }
    case 'convert':
    case 'compress':
    case 'optimize': {
      // format / quality handled below
      break;
    }
    case 'strip-metadata': {
      // Already auto-rotated above; metadata stripped by omitting withMetadata
      break;
    }
    default:
      throw badRequest(`Unknown image operation: ${op}`);
  }

  const format = String(ctx.options.format || meta.format || 'png').toLowerCase().replace('jpg', 'jpeg');
  // Sharp: omit withMetadata → strips EXIF; withMetadata() → preserves.
  // strip-metadata op always strips. preserveMetadata:true keeps EXIF.
  // stripMetadata:false keeps EXIF. Explicit stripMetadata:true strips.
  // Default (no flags): strip for privacy on encode.
  const forceStrip = op === 'strip-metadata' || ctx.options.stripMetadata === true;
  const forcePreserve =
    !forceStrip &&
    (ctx.options.preserveMetadata === true || ctx.options.stripMetadata === false);

  if (forcePreserve) {
    pipeline = pipeline.withMetadata();
  }
  // else omit withMetadata → strip

  if (ctx.isCancelled()) throw badRequest('Cancelled');
  ctx.onProgress(70, `Encoding (${preset})`);

  const ext = format === 'jpeg' ? '.jpg' : `.${format}`;
  const outName = randomServerName(ext);
  const outputPath = path.join(ctx.outputDir, outName);

  const fmtOpts = sharpFormatOptions(preset, format, numericQuality);

  // BMP / ICO need explicit writers — never write PNG bytes under a false extension
  if (format === 'bmp') {
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bmp = encodeBmp(data, info.width, info.height);
    fs.writeFileSync(outputPath, bmp);
  } else if (format === 'ico') {
    const pngBuf = await pipeline
      .resize(256, 256, {
        fit: 'inside',
        withoutEnlargement: false,
        kernel: encodeBase.kernel,
      })
      .png()
      .toBuffer();
    const ico = encodeIcoFromPng(pngBuf);
    fs.writeFileSync(outputPath, ico);
  } else if (format === 'jpeg' || format === 'jpg') {
    await pipeline.jpeg(fmtOpts as Parameters<typeof pipeline.jpeg>[0]).toFile(outputPath);
  } else if (format === 'png') {
    await pipeline.png(fmtOpts as Parameters<typeof pipeline.png>[0]).toFile(outputPath);
  } else if (format === 'webp') {
    await pipeline.webp(fmtOpts as Parameters<typeof pipeline.webp>[0]).toFile(outputPath);
  } else if (format === 'avif') {
    await pipeline.avif(fmtOpts as Parameters<typeof pipeline.avif>[0]).toFile(outputPath);
  } else if (format === 'tiff') {
    await pipeline.tiff(fmtOpts as Parameters<typeof pipeline.tiff>[0]).toFile(outputPath);
  } else if (format === 'gif') {
    await pipeline.gif(fmtOpts as Parameters<typeof pipeline.gif>[0]).toFile(outputPath);
  } else {
    throw badRequest(`Unsupported output format: ${format}`);
  }

  assertValidOutput(outputPath, 'Image output');

  const outStat = fs.statSync(outputPath);
  let outMeta: { width?: number; height?: number; format?: string } = {};
  try {
    outMeta = await sharp(outputPath).metadata();
  } catch {
    // ICO may not be readable by sharp; use known dims for bmp/ico
    if (format === 'bmp' || format === 'ico') {
      outMeta = { format, width: meta.width, height: meta.height };
    }
  }
  ctx.onProgress(100, 'Image ready');

  return {
    outputPath,
    outputName: suggestName(ctx.inputNames[0] || 'image', ext),
    outputMime: FORMAT_MIME[format] || 'application/octet-stream',
    meta: {
      width: outMeta.width,
      height: outMeta.height,
      format: outMeta.format || format,
      size: outStat.size,
      originalSize: meta.size,
      qualityPreset: preset,
      ...(numericQuality !== undefined ? { quality: numericQuality } : {}),
    },
  };
}

/** Uncompressed 32-bit BGRA BMP (real BMP magic BM) */
function encodeBmp(rgba: Buffer, width: number, height: number): Buffer {
  const rowSize = width * 4;
  const pixelSize = rowSize * height;
  const fileSize = 54 + pixelSize;
  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); // DIB header size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // bottom-up
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(32, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelSize, 34);
  // pixels bottom-up, BGRA
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const si = (srcY * width + x) * 4;
      const di = 54 + y * rowSize + x * 4;
      buf[di] = rgba[si + 2]; // B
      buf[di + 1] = rgba[si + 1]; // G
      buf[di + 2] = rgba[si]; // R
      buf[di + 3] = rgba[si + 3]; // A
    }
  }
  return buf;
}

/** Single-image ICO wrapping a PNG payload (valid ICO) */
function encodeIcoFromPng(png: Buffer): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 0 => 256
  entry[1] = 0; // height 0 => 256
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset after header+entry
  return Buffer.concat([header, entry, png]);
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function suggestName(original: string, ext: string) {
  const base = path.basename(original, path.extname(original)) || 'image';
  return `${base}${ext}`;
}
