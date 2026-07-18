import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { badRequest } from '../lib/errors.js';
import type { ProcessContext, ProcessResult } from './types.js';

function writeJsonResult(ctx: ProcessContext, data: unknown, name = 'result.json'): ProcessResult {
  const outputPath = path.join(ctx.outputDir, name);
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
  return {
    outputPath,
    outputName: name,
    outputMime: 'application/json',
    meta: typeof data === 'object' && data ? (data as Record<string, unknown>) : { result: data },
  };
}

function writeTextResult(ctx: ProcessContext, text: string, name = 'result.txt'): ProcessResult {
  const outputPath = path.join(ctx.outputDir, name);
  fs.writeFileSync(outputPath, text, 'utf8');
  return {
    outputPath,
    outputName: name,
    outputMime: 'text/plain',
    meta: { length: text.length },
  };
}

export async function processText(ctx: ProcessContext): Promise<ProcessResult> {
  ctx.onProgress(10, 'Processing text');
  const op = String(ctx.options.operation || 'hash');
  const input =
    typeof ctx.options.input === 'string'
      ? ctx.options.input
      : ctx.inputPaths[0]
        ? fs.readFileSync(ctx.inputPaths[0], 'utf8')
        : '';

  // Optional cooperative delay for cancel testing / long-running demos (ms, capped)
  const delayMs = Math.min(Math.max(Number(ctx.options.delayMs) || 0, 0), 60_000);
  if (delayMs > 0) {
    const step = 50;
    let waited = 0;
    while (waited < delayMs) {
      if (ctx.isCancelled()) throw badRequest('Cancelled');
      await new Promise((r) => setTimeout(r, Math.min(step, delayMs - waited)));
      waited += step;
      ctx.onProgress(10 + (waited / delayMs) * 20, 'Working…');
    }
  }

  if (ctx.isCancelled()) throw badRequest('Cancelled');

  switch (op) {
    case 'format-json': {
      try {
        const parsed = JSON.parse(input);
        const indent = Number(ctx.options.indent ?? 2);
        const sortKeys = Boolean(ctx.options.sortKeys);
        const value = sortKeys ? sortObject(parsed) : parsed;
        const out = JSON.stringify(value, null, Number.isFinite(indent) ? indent : 2);
        ctx.onProgress(100, 'JSON formatted');
        return writeTextResult(ctx, out, 'formatted.json');
      } catch (e) {
        throw badRequest(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
      }
    }
    case 'base64-encode': {
      const out = Buffer.from(input, 'utf8').toString('base64');
      ctx.onProgress(100, 'Base64 encoded');
      return writeTextResult(ctx, out, 'base64.txt');
    }
    case 'base64-decode': {
      try {
        const out = Buffer.from(input.replace(/\s+/g, ''), 'base64').toString('utf8');
        ctx.onProgress(100, 'Base64 decoded');
        return writeTextResult(ctx, out, 'decoded.txt');
      } catch {
        throw badRequest('Invalid Base64 input');
      }
    }
    case 'url-encode': {
      const out = encodeURIComponent(input);
      ctx.onProgress(100, 'URL encoded');
      return writeTextResult(ctx, out, 'url-encoded.txt');
    }
    case 'url-decode': {
      try {
        const out = decodeURIComponent(input);
        ctx.onProgress(100, 'URL decoded');
        return writeTextResult(ctx, out, 'url-decoded.txt');
      } catch {
        throw badRequest('Invalid URL-encoded input');
      }
    }
    case 'hash': {
      const algo = String(ctx.options.algorithm || 'sha256').toLowerCase();
      const allowed = new Set(['md5', 'sha1', 'sha256', 'sha512']);
      if (!allowed.has(algo)) throw badRequest(`Unsupported hash algorithm: ${algo}`);
      const digest = createHash(algo).update(input, 'utf8').digest('hex');
      ctx.onProgress(100, `${algo} computed`);
      return writeJsonResult(ctx, { algorithm: algo, digest, length: input.length });
    }
    case 'cleanup': {
      let out = input
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[^\S\n]+/g, (m) => (m.includes('\n') ? m : ' '))
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
      ctx.onProgress(100, 'Text cleaned');
      return writeTextResult(ctx, out, 'cleaned.txt');
    }
    case 'uuid': {
      const count = Math.min(Number(ctx.options.count || 1), 100);
      const ids = Array.from({ length: count }, () => randomUUID());
      ctx.onProgress(100, 'UUID generated');
      return writeJsonResult(ctx, { uuids: ids });
    }
    case 'word-count': {
      const words = input.trim() ? input.trim().split(/\s+/).length : 0;
      const chars = input.length;
      const lines = input ? input.split(/\r?\n/).length : 0;
      ctx.onProgress(100, 'Counted');
      return writeJsonResult(ctx, { words, characters: chars, lines, paragraphs: input.split(/\n\s*\n/).filter(Boolean).length });
    }
    case 'case': {
      const mode = String(ctx.options.caseMode || 'lower');
      let out = input;
      if (mode === 'upper') out = input.toUpperCase();
      else if (mode === 'lower') out = input.toLowerCase();
      else if (mode === 'title') out = input.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      else if (mode === 'snake') out = input.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
      else if (mode === 'camel') {
        out = input
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase());
      }
      ctx.onProgress(100, 'Case converted');
      return writeTextResult(ctx, out, 'cased.txt');
    }
    default:
      throw badRequest(`Unknown text operation: ${op}`);
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortObject(obj[key]);
    }
    return sorted;
  }
  return value;
}
