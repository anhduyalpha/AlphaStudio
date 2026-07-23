import path from 'node:path';
import { badRequest } from '../lib/errors.js';
import {
  findPythonOperation,
  runPythonOperation,
} from '../convert/engines/python.js';
import { processArchive } from './archive.js';
import type { ProcessContext, ProcessResult } from './types.js';

function baseName(name: string): string {
  return path.basename(name, path.extname(name)) || 'output';
}

/**
 * Specialized Python operation runner (searchable OCR, deskew, autocrop, table
 * extraction, ...). Capability gating happens in assertJobCapable before the
 * job is queued; here we run the bridge and shape the result. A single artifact
 * maps to one output; multiple artifacts are zipped (same pattern as the batch
 * converter).
 */
export async function processPyop(ctx: ProcessContext): Promise<ProcessResult> {
  const operation = String(ctx.options.operation || '');
  const spec = findPythonOperation(operation);
  if (!spec) throw badRequest(`Unknown Python operation: ${operation || '(none)'}`);
  if (!ctx.inputPaths.length) throw badRequest('Files required for this operation');

  ctx.onProgress(5, `Starting ${spec.label}`);
  const { outputs, meta } = await runPythonOperation({
    operation,
    inputPaths: ctx.inputPaths,
    outputDir: ctx.outputDir,
    options: ctx.options,
    jobId: ctx.jobId,
    isCancelled: ctx.isCancelled,
  });
  if (!outputs.length) throw badRequest('Operation produced no output');

  const source = baseName(ctx.inputNames[0] || outputs[0].name);
  if (outputs.length === 1) {
    const ext = path.extname(outputs[0].name);
    ctx.onProgress(100, `${spec.label} complete`);
    return {
      outputPath: outputs[0].path,
      outputName: `${source}-${spec.suffix}${ext}`,
      outputMime: outputs[0].mime,
      meta: { ...meta, operation },
    };
  }

  ctx.onProgress(90, 'Packaging results');
  const zip = await processArchive({
    ...ctx,
    inputPaths: outputs.map((output) => output.path),
    inputNames: outputs.map((output) => output.name),
    options: { operation: 'create', format: 'zip' },
    onProgress: (progress, message) => ctx.onProgress(90 + progress * 0.1, message),
  });
  return {
    ...zip,
    outputName: `${source}-${spec.suffix}.zip`,
    meta: { ...meta, operation, files: outputs.length, packed: true },
  };
}
