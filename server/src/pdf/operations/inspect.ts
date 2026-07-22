import fs from 'node:fs';
import path from 'node:path';
import { badRequest } from '../../lib/errors.js';
import { validatePdfInput } from '../../convert/pdfInspect.js';
import { OutputNames } from '../output-names.js';
import { writeBinaryOutput } from '../save.js';
import type { PdfOpContext } from '../types.js';

export async function inspectPdf(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  ctx.progress.stage('inspecting', 0.2, 'Inspecting PDF');
  const inspect = await validatePdfInput(ctx.inputPaths[0], {
    originalName: ctx.primaryName,
    allowEncrypted: true,
  });

  // Detect PDF version from header
  let pdfVersion: string | undefined;
  try {
    const fd = fs.openSync(ctx.inputPaths[0], 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    const m = buf.toString('ascii').match(/%PDF-(\d+\.\d+)/);
    if (m) pdfVersion = m[1];
  } catch {
    /* optional */
  }

  const warnings: string[] = [];
  if (inspect.encrypted || inspect.passwordRequired) {
    warnings.push('Document is encrypted or password-protected');
  }
  if (inspect.scannedLikely) {
    warnings.push('Document appears scanned (little extractable text)');
  }
  if (inspect.pageCount > 500) {
    warnings.push('Large page count may slow preview and OCR');
  }

  const result = {
    filename: path.basename(ctx.primaryName || ctx.inputPaths[0]),
    size: inspect.size,
    pageCount: inspect.pageCount,
    pageDimensions: inspect.pageSize
      ? { width: inspect.pageSize.width, height: inspect.pageSize.height, unit: 'pt' }
      : null,
    encryption: {
      encrypted: inspect.encrypted,
      passwordRequired: inspect.passwordRequired,
    },
    metadata: inspect.metadata,
    pdfVersion: pdfVersion || null,
    scannedLikely: inspect.scannedLikely,
    extractableText: {
      available: !inspect.scannedLikely && inspect.textCharCount > 0,
      charCount: inspect.textCharCount,
      sample: inspect.textSample?.slice(0, 200) || null,
    },
    checksum: inspect.checksum,
    engine: inspect.engine || 'pdf-lib',
    warnings,
  };

  ctx.progress.stage('packaging', 0.8, 'Writing inspection report');
  const json = JSON.stringify(result, null, 2);
  return writeBinaryOutput({
    data: json,
    outputDir: ctx.outputDir,
    ext: '.json',
    outputName: OutputNames.inspect(ctx.primaryName),
    outputMime: 'application/json',
    progress: ctx.progress,
    meta: {
      ...result,
      // Flatten key fields for JobOutputCard
      pageCount: result.pageCount,
      engine: result.engine,
    },
  });
}
