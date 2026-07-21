/**
 * Shared PDF / binary output persistence with validation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { assertValidOutput } from '../convert/quality.js';
import { randomServerName } from '../lib/paths.js';
import type { ProcessResult } from '../processors/types.js';
import { pdfError } from './errors.js';
import type { ProgressTracker } from './progress.js';

export async function savePdfDocument(opts: {
  doc: PDFDocument;
  outputDir: string;
  outputName: string;
  progress?: ProgressTracker;
  meta?: Record<string, unknown>;
  saveOptions?: { useObjectStreams?: boolean; objectsPerTick?: number };
}): Promise<ProcessResult> {
  opts.progress?.stage('packaging', 0.3, 'Saving PDF');
  const bytes = await opts.doc.save(opts.saveOptions);
  if (!bytes.length) {
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: empty PDF');
  }
  const name = randomServerName('.pdf');
  const outputPath = path.join(opts.outputDir, name);
  await fs.promises.writeFile(outputPath, bytes);

  opts.progress?.stage('validating-output', 0.5, 'Validating output');
  assertValidOutput(outputPath, { label: 'PDF output', expectedExt: '.pdf', minBytes: 1 });

  // Re-parse to confirm validity
  try {
    const check = await PDFDocument.load(await fs.promises.readFile(outputPath));
    if (check.getPageCount() < 1) {
      throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: no pages in output PDF');
    }
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'OUTPUT_VALIDATION_FAILED') {
      throw e;
    }
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: output PDF could not be parsed');
  }

  // Signature check
  const fd = await fs.promises.open(outputPath, 'r');
  try {
    const head = Buffer.alloc(5);
    await fd.read(head, 0, 5, 0);
    if (head.toString('ascii') !== '%PDF-') {
      throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: missing %PDF- signature');
    }
  } finally {
    await fd.close();
  }

  opts.progress?.complete('completed');
  return {
    outputPath,
    outputName: opts.outputName,
    outputMime: 'application/pdf',
    meta: {
      pages: opts.doc.getPageCount(),
      size: bytes.length,
      ...(opts.meta || {}),
    },
  };
}

export async function writeBinaryOutput(opts: {
  data: Buffer | string;
  outputDir: string;
  ext: string;
  outputName: string;
  outputMime: string;
  progress?: ProgressTracker;
  meta?: Record<string, unknown>;
  minBytes?: number;
}): Promise<ProcessResult> {
  opts.progress?.stage('packaging', 0.5);
  const name = randomServerName(opts.ext.startsWith('.') ? opts.ext : `.${opts.ext}`);
  const outputPath = path.join(opts.outputDir, name);
  await fs.promises.writeFile(outputPath, opts.data, typeof opts.data === 'string' ? 'utf8' : undefined);
  opts.progress?.stage('validating-output', 0.8);
  assertValidOutput(outputPath, {
    label: 'Output',
    expectedExt: opts.ext.startsWith('.') ? opts.ext : `.${opts.ext}`,
    minBytes: opts.minBytes ?? 1,
  });
  opts.progress?.complete('completed');
  return {
    outputPath,
    outputName: opts.outputName,
    outputMime: opts.outputMime,
    meta: opts.meta,
  };
}
