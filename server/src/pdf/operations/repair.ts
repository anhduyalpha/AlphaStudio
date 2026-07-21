import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { assertValidOutput } from '../../convert/quality.js';
import { execFileTracked } from '../../lib/child-registry.js';
import { randomServerName } from '../../lib/paths.js';
import { resolveOptionalBinary } from '../../tools/optional-binaries.js';
import { badRequest } from '../../lib/errors.js';
import { pdfError, throwIfCancelled } from '../errors.js';
import { OutputNames } from '../output-names.js';
import type { PdfOpContext } from '../types.js';

/**
 * Repair PDF via qpdf (preferred) or Ghostscript rewrite.
 * Never fakes repair with pdf-lib alone.
 */
export async function repairPdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  const inputPath = ctx.inputPaths[0];
  throwIfCancelled(ctx.isCancelled);

  const qpdf = resolveOptionalBinary('qpdf');
  if (qpdf.available && qpdf.path) {
    return repairWithQpdf(ctx, inputPath, qpdf.path);
  }

  const gs = resolveOptionalBinary('ghostscript');
  if (gs.available && gs.path) {
    return repairWithGhostscript(ctx, inputPath, gs.path);
  }

  throw pdfError(
    'REPAIR_UNAVAILABLE',
    'PDF repair requires qpdf or Ghostscript. Install one of these tools to enable repair.',
    503,
    { requires: ['qpdf', 'ghostscript'] },
  );
}

async function repairWithQpdf(ctx: PdfOpContext, inputPath: string, bin: string) {
  ctx.progress.stage('processing', 0.2, 'Repairing with qpdf');
  const name = randomServerName('.pdf');
  const outputPath = path.join(ctx.outputDir, name);
  // qpdf --recover or default rewrite; --warning-exit-0 for damaged files
  const args = ['--warning-exit-0', inputPath, outputPath];
  try {
    await execFileTracked(bin, args, {
      jobId: ctx.jobId,
      timeout: 180_000,
      windowsHide: true,
    });
  } catch (e) {
    // Try with --decrypt-not-needed style recover
    const msg = e instanceof Error ? e.message : 'qpdf failed';
    throw pdfError(
      'CORRUPTED_PDF',
      `Repair failed: ${msg.slice(0, 200)}`,
    );
  }
  await validateRepaired(outputPath);
  ctx.progress.complete('completed');
  return {
    outputPath,
    outputName: OutputNames.repaired(ctx.primaryName),
    outputMime: 'application/pdf',
    meta: {
      engine: 'qpdf',
      size: fs.statSync(outputPath).size,
      pages: (await PDFDocument.load(fs.readFileSync(outputPath))).getPageCount(),
    },
  };
}

async function repairWithGhostscript(ctx: PdfOpContext, inputPath: string, bin: string) {
  ctx.progress.stage('processing', 0.2, 'Rewriting with Ghostscript');
  const name = randomServerName('.pdf');
  const outputPath = path.join(ctx.outputDir, name);
  const args = [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];
  try {
    await execFileTracked(bin, args, {
      jobId: ctx.jobId,
      timeout: 300_000,
      windowsHide: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ghostscript failed';
    throw pdfError('CORRUPTED_PDF', `Repair failed: ${msg.slice(0, 200)}`);
  }
  await validateRepaired(outputPath);
  ctx.progress.complete('completed');
  return {
    outputPath,
    outputName: OutputNames.repaired(ctx.primaryName),
    outputMime: 'application/pdf',
    meta: {
      engine: 'ghostscript',
      size: fs.statSync(outputPath).size,
      pages: (await PDFDocument.load(fs.readFileSync(outputPath))).getPageCount(),
    },
  };
}

async function validateRepaired(outputPath: string): Promise<void> {
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: repair produced empty file');
  }
  assertValidOutput(outputPath, { label: 'Repaired PDF', expectedExt: '.pdf' });
  const head = Buffer.alloc(5);
  const fd = fs.openSync(outputPath, 'r');
  fs.readSync(fd, head, 0, 5, 0);
  fs.closeSync(fd);
  if (head.toString('ascii') !== '%PDF-') {
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: missing %PDF- signature');
  }
  try {
    const doc = await PDFDocument.load(fs.readFileSync(outputPath));
    if (doc.getPageCount() < 1) {
      throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: repaired PDF has no pages');
    }
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'OUTPUT_VALIDATION_FAILED') throw e;
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: repaired PDF could not be parsed');
  }
}

/** Capability probe for UI */
export function repairAvailable(): { available: boolean; engine?: string; requires: string[] } {
  const qpdf = resolveOptionalBinary('qpdf');
  if (qpdf.available) return { available: true, engine: 'qpdf', requires: ['qpdf'] };
  const gs = resolveOptionalBinary('ghostscript');
  if (gs.available) return { available: true, engine: 'ghostscript', requires: ['ghostscript'] };
  return { available: false, requires: ['qpdf', 'ghostscript'] };
}
