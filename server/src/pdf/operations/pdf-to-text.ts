import path from 'node:path';
import { badRequest } from '../../lib/errors.js';
import { OutputNames } from '../output-names.js';
import type { PdfOpContext } from '../types.js';

export async function pdfToText(ctx: PdfOpContext) {
  if (!ctx.inputPaths[0]) throw badRequest('PDF required');
  ctx.progress.stage('processing', 0.1, 'Extracting text');
  const { extractPdfText } = await import('../../convert/pdfText.js');
  const result = await extractPdfText({
    inputPath: ctx.inputPaths[0],
    outputDir: ctx.outputDir,
    ocr: false,
    originalBaseName: path.basename(ctx.primaryName || 'document', path.extname(ctx.primaryName || '')),
    jobId: ctx.jobId,
    isCancelled: ctx.isCancelled,
    onProgress: (p, msg) => {
      const stage = /ocr/i.test(msg || '') ? 'ocr' : 'processing';
      ctx.progress.stage(stage as 'ocr' | 'processing', Math.min(0.95, p / 100), msg);
    },
  });

  ctx.progress.complete('completed');
  return {
    outputPath: result.outputPath,
    outputName: OutputNames.text(ctx.primaryName),
    outputMime: 'text/plain',
    meta: {
      engine: result.engine,
      outputKind: 'text',
      pageCount: result.pageCount,
      charCount: result.charCount,
      characterCount: result.charCount,
      scanned: result.scanned,
      usedOcr: result.usedOcr,
      ocrStatus: result.usedOcr ? 'applied' : result.scanned ? 'needed' : 'not-needed',
    },
  };
}
