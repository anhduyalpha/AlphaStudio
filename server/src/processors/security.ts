import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileTypeFromFile } from '../lib/magic.js';
import sharp from 'sharp';
import { badRequest } from '../lib/errors.js';
import { randomServerName } from '../lib/paths.js';
import type { ProcessContext, ProcessResult } from './types.js';

export async function processSecurity(ctx: ProcessContext): Promise<ProcessResult> {
  const op = String(ctx.options.operation || 'hash');
  ctx.onProgress(20, `Security ${op}`);

  if (op === 'hash' || op === 'checksum') {
    if (!ctx.inputPaths[0] && typeof ctx.options.input !== 'string') {
      throw badRequest('File or text input required');
    }
    const algorithms = normalizeAlgos(ctx.options.algorithms || ctx.options.algorithm || 'sha256');
    const results: Record<string, string> = {};
    if (ctx.inputPaths[0]) {
      const buf = fs.readFileSync(ctx.inputPaths[0]);
      for (const algo of algorithms) {
        results[algo] = createHash(algo).update(buf).digest('hex');
      }
    } else {
      const text = String(ctx.options.input || '');
      for (const algo of algorithms) {
        results[algo] = createHash(algo).update(text, 'utf8').digest('hex');
      }
    }
    return writeJson(ctx, {
      algorithms: results,
      filename: ctx.inputNames[0] || null,
      size: ctx.inputPaths[0] ? fs.statSync(ctx.inputPaths[0]).size : String(ctx.options.input || '').length,
    }, 'checksums.json');
  }

  if (op === 'compare') {
    const expected = String(ctx.options.expected || '').trim().toLowerCase();
    const algorithms = normalizeAlgos(ctx.options.algorithm || 'sha256');
    const algo = algorithms[0];
    if (!expected) throw badRequest('expected checksum required');
    if (!/^[a-f0-9]{32,128}$/.test(expected)) {
      throw badRequest('expected checksum must be a hex digest (32–128 chars)');
    }
    if (!ctx.inputPaths[0]) throw badRequest('File required');
    const actual = createHash(algo).update(fs.readFileSync(ctx.inputPaths[0])).digest('hex');
    return writeJson(ctx, {
      algorithm: algo,
      expected,
      actual,
      match: actual === expected,
    }, 'checksum-compare.json');
  }

  if (op === 'signature' || op === 'magic') {
    if (!ctx.inputPaths[0]) throw badRequest('File required');
    const p = ctx.inputPaths[0];
    const head = Buffer.alloc(Math.min(64, fs.statSync(p).size));
    const fd = fs.openSync(p, 'r');
    fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const ft = await fileTypeFromFile(p);
    const ext = path.extname(ctx.inputNames[0] || p).toLowerCase();
    const detectedExt = ft?.ext ? `.${ft.ext.toLowerCase()}` : null;
    const match = extensionMatchesDetection(ext, detectedExt, ft?.mime || null);
    return writeJson(ctx, {
      extension: ext,
      declaredName: ctx.inputNames[0],
      detectedMime: ft?.mime || null,
      detectedExt: detectedExt,
      magicHex: head.toString('hex'),
      magicAscii: head.toString('utf8').replace(/[^\x20-\x7E]/g, '.'),
      match,
    }, 'file-signature.json');
  }

  if (op === 'metadata') {
    if (!ctx.inputPaths[0]) throw badRequest('File required');
    const p = ctx.inputPaths[0];
    const stat = fs.statSync(p);
    const ft = await fileTypeFromFile(p);
    const meta: Record<string, unknown> = {
      name: ctx.inputNames[0],
      size: stat.size,
      mime: ft?.mime || null,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
    };
    if (ft?.mime?.startsWith('image/')) {
      try {
        const img = await sharp(p).metadata();
        meta.image = {
          width: img.width,
          height: img.height,
          format: img.format,
          space: img.space,
          hasAlpha: img.hasAlpha,
          orientation: img.orientation,
          density: img.density,
          exif: Boolean(img.exif),
          icc: Boolean(img.icc),
        };
      } catch {
        meta.image = { error: 'Unable to read image metadata' };
      }
    }
    if (path.extname(p).toLowerCase() === '.pdf') {
      const head = fs.readFileSync(p).subarray(0, Math.min(2048, stat.size)).toString('latin1');
      const producer = /\/Producer\s*\(([^)]*)\)/.exec(head)?.[1];
      const creator = /\/Creator\s*\(([^)]*)\)/.exec(head)?.[1];
      meta.pdf = { producer: producer || null, creator: creator || null };
    }
    return writeJson(ctx, meta, 'metadata.json');
  }

  if (op === 'password') {
    // Secure password generation only — not cracking
    const length = Math.min(Math.max(Number(ctx.options.length || 16), 8), 128);
    const useSymbols = ctx.options.symbols !== false;
    const alphabet =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
      (useSymbols ? '!@#$%^&*()-_=+[]{}' : '');
    const { randomInt } = await import('node:crypto');
    let pw = '';
    for (let i = 0; i < length; i++) pw += alphabet[randomInt(alphabet.length)];
    return writeJson(ctx, { password: pw, length, symbols: useSymbols }, 'password.json');
  }

  throw badRequest(`Unknown security operation: ${op}`);
}

function normalizeAlgos(v: unknown): string[] {
  const allowed = new Set(['md5', 'sha1', 'sha256', 'sha512']);
  const list = Array.isArray(v) ? v.map(String) : String(v).split(/[,\s]+/);
  const algos = list.map((a) => a.toLowerCase()).filter((a) => allowed.has(a));
  if (!algos.length) throw badRequest('No valid hash algorithms');
  return [...new Set(algos)];
}

/** True only when declared extension is compatible with detected type. */
export function extensionMatchesDetection(
  declaredExt: string,
  detectedExt: string | null,
  detectedMime: string | null,
): boolean | null {
  if (!detectedExt && !detectedMime) return null;
  const ext = declaredExt.toLowerCase().startsWith('.')
    ? declaredExt.toLowerCase()
    : `.${declaredExt.toLowerCase()}`;
  const aliases: Record<string, string[]> = {
    '.jpg': ['.jpg', '.jpeg'],
    '.jpeg': ['.jpg', '.jpeg'],
    '.tif': ['.tif', '.tiff'],
    '.tiff': ['.tif', '.tiff'],
    '.mp3': ['.mp3'],
    '.m4a': ['.m4a', '.mp4'],
  };
  if (detectedExt) {
    const det = detectedExt.toLowerCase().startsWith('.')
      ? detectedExt.toLowerCase()
      : `.${detectedExt.toLowerCase()}`;
    const allowed = aliases[ext] || [ext];
    if (allowed.includes(det)) return true;
    // also accept if declared matches detected without alias
    if (ext === det) return true;
    return false;
  }
  // mime-only fallback
  if (detectedMime) {
    const mimeMap: Record<string, string[]> = {
      '.png': ['image/png'],
      '.jpg': ['image/jpeg'],
      '.jpeg': ['image/jpeg'],
      '.webp': ['image/webp'],
      '.gif': ['image/gif'],
      '.pdf': ['application/pdf'],
      '.zip': ['application/zip', 'application/x-zip-compressed'],
    };
    const mimes = mimeMap[ext];
    if (!mimes) return false;
    return mimes.includes(detectedMime);
  }
  return null;
}

function writeJson(ctx: ProcessContext, data: unknown, name: string): ProcessResult {
  const outputPath = path.join(ctx.outputDir, randomServerName('.json'));
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
  ctx.onProgress(100, 'Done');
  return {
    outputPath,
    outputName: name,
    outputMime: 'application/json',
    meta: data as Record<string, unknown>,
  };
}
