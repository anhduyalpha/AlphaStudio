import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { assertValidOutput, pdfCompressOptions, resolveQualityPreset } from '../../convert/quality.js';
import { execFileTracked } from '../../lib/child-registry.js';
import { randomServerName } from '../../lib/paths.js';
import { resolveOptionalBinary } from '../../tools/optional-binaries.js';
import { badRequest } from '../../lib/errors.js';
import { pdfError, throwIfCancelled } from '../errors.js';
import { loadPdfDocument } from '../load.js';
import { OutputNames } from '../output-names.js';
import { advancedCompressSettings, normalizePdfOptions } from '../operation-options.js';
import type { PdfOpContext } from '../types.js';

export async function compressPdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const opts = normalizePdfOptions(ctx.options);
  const preset = resolveQualityPreset(ctx.options);
  const inputPath = ctx.inputPaths[0];
  const originalSize = fs.statSync(inputPath).size;

  if (opts.compressMode === 'advanced') {
    return compressAdvanced(ctx, inputPath, originalSize, preset);
  }
  return compressStructural(ctx, inputPath, originalSize, preset);
}

async function compressStructural(
  ctx: PdfOpContext,
  inputPath: string,
  originalSize: number,
  preset: 'fast' | 'balanced' | 'high',
) {
  const compressOpts = pdfCompressOptions(preset);
  ctx.progress.stage('optimizing', 0.2, `Structural optimization (${preset})`);
  throwIfCancelled(ctx.isCancelled);
  const doc = await loadPdfDocument(inputPath);
  ctx.progress.stage('optimizing', 0.6, 'Writing optimized PDF');
  const bytes = await doc.save({
    useObjectStreams: compressOpts.useObjectStreams,
    objectsPerTick: compressOpts.objectsPerTick,
  });
  if (!bytes.length) {
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: empty compressed PDF');
  }

  const name = randomServerName('.pdf');
  const outputPath = path.join(ctx.outputDir, name);
  await fs.promises.writeFile(outputPath, bytes);
  await validateCompressedOutput(outputPath, originalSize);

  const compressedSize = fs.statSync(outputPath).size;
  const reductionBytes = originalSize - compressedSize;
  const reductionPercent =
    originalSize > 0 ? Math.round((reductionBytes / originalSize) * 10000) / 100 : 0;

  const meta: Record<string, unknown> = {
    engine: 'pdf-lib',
    originalSize,
    compressedSize,
    reductionBytes,
    reductionPercent,
    preset,
    structuralOnly: true,
    qualityPreset: preset,
    useObjectStreams: compressOpts.useObjectStreams,
    note: compressOpts.note || 'Structural optimization only; does not re-encode images',
  };
  if (compressedSize > originalSize * 1.05) {
    meta.warning = 'Compressed file is larger than the original (structural rewrite overhead)';
  }

  ctx.progress.complete('completed');
  return {
    outputPath,
    outputName: OutputNames.optimized(ctx.primaryName),
    outputMime: 'application/pdf',
    meta,
  };
}

async function compressAdvanced(
  ctx: PdfOpContext,
  inputPath: string,
  originalSize: number,
  preset: 'fast' | 'balanced' | 'high',
) {
  const settings = advancedCompressSettings(preset);
  ctx.progress.stage('optimizing', 0.1, `Advanced compression (${preset})`);
  throwIfCancelled(ctx.isCancelled);

  const gs = resolveOptionalBinary('ghostscript');
  if (gs.available && gs.path) {
    try {
      const result = await compressWithGhostscript(ctx, inputPath, originalSize, settings, gs.path);
      return result;
    } catch (e) {
      if (ctx.isCancelled()) throw e;
      // fall through to qpdf
    }
  }

  const qpdf = resolveOptionalBinary('qpdf');
  if (qpdf.available && qpdf.path) {
    try {
      const result = await compressWithQpdf(ctx, inputPath, originalSize, settings, qpdf.path);
      return result;
    } catch (e) {
      if (ctx.isCancelled()) throw e;
    }
  }

  // Fallback: structural only, mark clearly
  ctx.progress.stage('optimizing', 0.4, 'Falling back to structural optimization');
  const structural = await compressStructural(ctx, inputPath, originalSize, preset);
  return {
    ...structural,
    outputName: OutputNames.compressed(ctx.primaryName),
    meta: {
      ...structural.meta,
      structuralOnly: true,
      advancedRequested: true,
      note: 'Advanced engines unavailable; applied structural pdf-lib optimization only',
    },
  };
}

async function compressWithGhostscript(
  ctx: PdfOpContext,
  inputPath: string,
  originalSize: number,
  settings: ReturnType<typeof advancedCompressSettings>,
  bin: string,
) {
  const name = randomServerName('.pdf');
  const outputPath = path.join(ctx.outputDir, name);
  const args = [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-sDEVICE=pdfwrite',
    `-dCompatibilityLevel=${settings.compatibilityLevel}`,
    `-dPDFSETTINGS=${settings.gsPdfSettings}`,
    `-dColorImageResolution=${settings.imageDpi}`,
    `-dGrayImageResolution=${settings.imageDpi}`,
    `-dMonoImageResolution=${settings.imageDpi}`,
    `-dJPEGQ=${settings.jpegQuality}`,
    '-dColorImageDownsampleType=/Bicubic',
    '-dGrayImageDownsampleType=/Bicubic',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];
  ctx.progress.stage('optimizing', 0.5, 'Compressing with Ghostscript');
  await execFileTracked(bin, args, {
    jobId: ctx.jobId,
    timeout: 300_000,
    windowsHide: true,
  });
  await validateCompressedOutput(outputPath, originalSize);

  const compressedSize = fs.statSync(outputPath).size;
  const reductionBytes = originalSize - compressedSize;
  const reductionPercent =
    originalSize > 0 ? Math.round((reductionBytes / originalSize) * 10000) / 100 : 0;
  const meta: Record<string, unknown> = {
    engine: 'ghostscript',
    originalSize,
    compressedSize,
    reductionBytes,
    reductionPercent,
    preset: settings.preset,
    structuralOnly: false,
    imageDpi: settings.imageDpi,
    jpegQuality: settings.jpegQuality,
    compatibilityLevel: settings.compatibilityLevel,
    colorImageDownsample: settings.colorImageDownsample,
    grayImageDownsample: settings.grayImageDownsample,
    useObjectStreams: settings.useObjectStreams,
  };
  if (compressedSize > originalSize * 1.05) {
    meta.warning = 'Compressed file is larger than the original';
  }
  ctx.progress.complete('completed');
  return {
    outputPath,
    outputName: OutputNames.compressed(ctx.primaryName),
    outputMime: 'application/pdf',
    meta,
  };
}

async function compressWithQpdf(
  ctx: PdfOpContext,
  inputPath: string,
  originalSize: number,
  settings: ReturnType<typeof advancedCompressSettings>,
  bin: string,
) {
  const name = randomServerName('.pdf');
  const outputPath = path.join(ctx.outputDir, name);
  const args = [
    '--object-streams=generate',
    '--compression-level=9',
    '--recompress-flate',
    inputPath,
    outputPath,
  ];
  ctx.progress.stage('optimizing', 0.5, 'Optimizing with qpdf');
  await execFileTracked(bin, args, {
    jobId: ctx.jobId,
    timeout: 180_000,
    windowsHide: true,
  });
  await validateCompressedOutput(outputPath, originalSize);

  const compressedSize = fs.statSync(outputPath).size;
  const reductionBytes = originalSize - compressedSize;
  const reductionPercent =
    originalSize > 0 ? Math.round((reductionBytes / originalSize) * 10000) / 100 : 0;
  const meta: Record<string, unknown> = {
    engine: 'qpdf',
    originalSize,
    compressedSize,
    reductionBytes,
    reductionPercent,
    preset: settings.preset,
    structuralOnly: false,
    note: 'qpdf object-stream optimization (images not re-encoded)',
  };
  if (compressedSize > originalSize * 1.05) {
    meta.warning = 'Compressed file is larger than the original';
  }
  ctx.progress.complete('completed');
  return {
    outputPath,
    outputName: OutputNames.compressed(ctx.primaryName),
    outputMime: 'application/pdf',
    meta,
  };
}

async function validateCompressedOutput(outputPath: string, originalSize: number): Promise<void> {
  if (!fs.existsSync(outputPath)) {
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: compressed file missing');
  }
  const st = fs.statSync(outputPath);
  if (st.size <= 0) {
    // Never replace valid input with empty — delete bad output
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: empty compressed PDF');
  }
  assertValidOutput(outputPath, { label: 'Compressed PDF', expectedExt: '.pdf', minBytes: 1 });

  const fd = fs.openSync(outputPath, 'r');
  try {
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    if (head.toString('ascii') !== '%PDF-') {
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore */
      }
      throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: missing %PDF- signature');
    }
  } finally {
    fs.closeSync(fd);
  }

  try {
    const doc = await PDFDocument.load(fs.readFileSync(outputPath));
    if (doc.getPageCount() < 1) {
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore */
      }
      throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: no pages after compression');
    }
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'OUTPUT_VALIDATION_FAILED') throw e;
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: compressed PDF could not be parsed');
  }

  void originalSize;
}
