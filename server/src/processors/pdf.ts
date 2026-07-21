/**
 * Thin PDF processor entry: validate inputs, normalize options, dispatch operation.
 * Operation implementations live under server/src/pdf/operations/* (lazy-loaded).
 */
import path from 'node:path';
import { badRequest } from '../lib/errors.js';
import { sanitizeUserError, validatePdfInput } from '../convert/pdfInspect.js';
import { getPdfOperation } from '../pdf/index.js';
import { normalizePdfOptions } from '../pdf/operation-options.js';
import { ProgressTracker } from '../pdf/progress.js';
import { throwIfCancelled, pdfError } from '../pdf/errors.js';
import type { ProcessContext, ProcessResult } from './types.js';

// Re-export parser for existing tests
export { parsePages, parsePageSelection } from '../pdf/page-selection.js';

export async function processPdf(ctx: ProcessContext): Promise<ProcessResult> {
  const rawOp = String(ctx.options.operation || 'merge').toLowerCase().trim();
  const progress = new ProgressTracker({
    onProgress: ctx.onProgress,
    stages: stagesFor(rawOp),
  });
  progress.stage('validating', 0, 'Validating inputs');
  throwIfCancelled(ctx.isCancelled);

  let opts;
  try {
    opts = normalizePdfOptions(ctx.options);
  } catch (e) {
    if (e && typeof e === 'object' && (e as { name?: string }).name === 'AppError') throw e;
    throw badRequest(e instanceof Error ? e.message : 'Invalid options');
  }

  const op = opts.operation;

  // Pre-validate PDF inputs (from-images takes images)
  if (op !== 'from-images') {
    for (let i = 0; i < ctx.inputPaths.length; i++) {
      throwIfCancelled(ctx.isCancelled);
      const p = ctx.inputPaths[i]!;
      const name = ctx.inputNames[i] || path.basename(p);
      const declaredMime = opts.mime || opts.contentType;
      try {
        await validatePdfInput(p, {
          originalName: name,
          declaredMime,
          allowEncrypted: op === 'inspect' || op === 'repair',
        });
      } catch (e) {
        if (e && typeof e === 'object' && (e as { name?: string }).name === 'AppError') throw e;
        throw badRequest(sanitizeUserError(e instanceof Error ? e.message : 'Invalid PDF'));
      }
      progress.stage('validating', (i + 1) / Math.max(1, ctx.inputPaths.length));
    }
  }

  progress.stage('inspecting', 0.5, 'Ready');

  const handler = await getPdfOperation(op);
  if (!handler) {
    throw badRequest(`Unknown PDF operation: ${op}`);
  }

  const primaryName = ctx.inputNames[0] || path.basename(ctx.inputPaths[0] || 'document.pdf');

  return handler({
    ...ctx,
    progress,
    primaryName,
  });
}

function stagesFor(op: string): import('../pdf/progress.js').PdfStage[] {
  switch (op) {
    case 'to-images':
      return ['validating', 'inspecting', 'rendering', 'packaging', 'validating-output', 'completed'];
    case 'ocr':
      return ['validating', 'inspecting', 'rendering', 'ocr', 'packaging', 'validating-output', 'completed'];
    case 'to-text':
    case 'extract-text':
      return ['validating', 'inspecting', 'processing', 'ocr', 'packaging', 'validating-output', 'completed'];
    case 'compress':
    case 'compress-structural':
    case 'compress-advanced':
      return ['validating', 'optimizing', 'packaging', 'validating-output', 'completed'];
    case 'inspect':
      return ['validating', 'inspecting', 'packaging', 'validating-output', 'completed'];
    case 'repair':
      return ['validating', 'processing', 'packaging', 'validating-output', 'completed'];
    default:
      return ['validating', 'preparing', 'processing', 'packaging', 'validating-output', 'completed'];
  }
}

// Keep pdfError reachable for accidental external imports
void pdfError;
