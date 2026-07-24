import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { badRequest } from '../lib/errors.js';
import { randomServerName } from '../lib/paths.js';
import { detectFile, kindFromInspect, type InspectResult } from '../convert/detect.js';
import { assertPairAllowed, routeConversion } from '../convert/matrix.js';
import {
  convertWithCalibre,
  convertWithPandoc,
  convertWithPython,
  executeEngineFallback,
  validateEngineOutput,
  type EngineRoute,
} from '../convert/engines/index.js';
import { convertWithLibreOffice, isSameFormatPair } from '../convert/office.js';
import { convertTextFormat, textToPdf } from '../convert/textPdf.js';
import { assertValidOutput, resolveQualityPreset } from '../convert/quality.js';
import { extractPdfText } from '../convert/pdfText.js';
import { convertPdfToImages } from '../convert/pdfRender.js';
import { validatePdfInput, sanitizeUserError, pdfError } from '../convert/pdfInspect.js';
import { processImage } from './image.js';
import { processArchive } from './archive.js';
import { processMedia } from './media.js';
import type { ProcessContext, ProcessResult } from './types.js';

/**
 * Universal converter: capability-gated batch conversion using detect matrix.
 */
export async function processConverter(ctx: ProcessContext): Promise<ProcessResult> {
  const format = String(ctx.options.format || ctx.options.outputFormat || '')
    .toLowerCase()
    .replace(/^\./, '');
  if (!format) throw badRequest('Output format is required');
  if (!ctx.inputPaths.length) throw badRequest('Files required for conversion');
  ctx.onProgress(5, 'Starting conversion');

  const outputs: {
    path: string;
    name: string;
    meta?: Record<string, unknown>;
  }[] = [];
  let i = 0;

  for (const input of ctx.inputPaths) {
    if (ctx.isCancelled()) throw badRequest('Cancelled');
    const name = ctx.inputNames[i] || path.basename(input);

    // Reuse detect metadata from files.detect_json / options (avoid re-running detectFile)
    const resolvedInspect = await resolveInspect(ctx, i, input, name);
    const kind = kindFromInspect(resolvedInspect);
    assertPairAllowed(kind, format);

    ctx.onProgress(8 + (i / ctx.inputPaths.length) * 80, `Converting ${name}`);

    const singleCtx: ProcessContext = {
      ...ctx,
      inputPaths: [input],
      inputNames: [name],
      options: {
        ...ctx.options,
        format,
        operation: ctx.options.operation || 'convert',
        preserveMetadata: ctx.options.preserveMetadata,
        stripMetadata: ctx.options.preserveMetadata === false,
        // Pass detect so media/office can skip re-probe
        _detect: resolvedInspect,
        detectMeta: resolvedInspect,
        quality: ctx.options.quality ?? resolveQualityPreset(ctx.options),
      },
      onProgress: (p, msg) =>
        ctx.onProgress(8 + ((i + p / 100) / ctx.inputPaths.length) * 80, msg),
    };

    const decision = routeConversion(kind, format, String(singleCtx.options.operation || 'convert'));
    if (!decision.route || decision.engine === 'unsupported') {
      throw badRequest(decision.reason || `Unsupported conversion: ${kind.format} → ${format}`);
    }
    const candidates = [decision.route, ...(decision.fallbacks || [])];
    const executed = await executeEngineFallback(candidates, async (route) => {
      const result = await convertOne(singleCtx, kind.family, kind.format, format, route);
        validateEngineOutput(
          route,
          result.outputPath,
          path.extname(result.outputName).slice(1) || format,
        );
      return result;
    });
    const result = executed.result;
    result.meta = {
      ...result.meta,
      conversionEngine: {
        id: executed.route.engineId,
        name: executed.route.engineName,
        version: executed.route.version,
        profile: executed.route.profile,
      },
      attemptedEngines: executed.attemptedEngines,
    };
    validateConverterOutput(result.outputPath, format, result.outputName);
    outputs.push({ path: result.outputPath, name: result.outputName, meta: result.meta });
    i += 1;
  }

  if (outputs.length === 1) {
    ctx.onProgress(100, 'Conversion complete');
    return {
      outputPath: outputs[0].path,
      outputName: outputs[0].name,
      outputMime: mimeFromName(outputs[0].name),
      meta: {
        ...outputs[0].meta,
        files: 1,
        format,
        quality: resolveQualityPreset(ctx.options),
      },
    };
  }

  const zipResult = await processArchive({
    ...ctx,
    inputPaths: outputs.map((o) => o.path),
    inputNames: outputs.map((o) => o.name),
    options: { operation: 'create', format: 'zip' },
    onProgress: (p, msg) => ctx.onProgress(90 + p * 0.1, msg),
  });
  validateConverterOutput(zipResult.outputPath, 'zip', zipResult.outputName);
  ctx.onProgress(100, 'Batch complete');
  return {
    ...zipResult,
    meta: {
      files: outputs.length,
      packed: true,
      format,
      quality: resolveQualityPreset(ctx.options),
      conversionEngines: [
        ...new Map(
          outputs
            .map((output) => output.meta?.conversionEngine)
            .filter((engine): engine is Record<string, unknown> => Boolean(engine))
            .map((engine) => [String(engine.id || engine.name), engine]),
        ).values(),
      ],
    },
  };
}

/**
 * Prefer preloaded detect (inputDetects / _detectByPath / _detect / detectMeta).
 * Falls back to detectFile only when needed.
 */
function resolveInspect(
  ctx: ProcessContext,
  index: number,
  input: string,
  name: string,
): Promise<InspectResult> {
  const fromCtx = ctx.inputDetects?.[index];
  if (isUsableInspect(fromCtx)) return Promise.resolve(fromCtx as InspectResult);

  const cached = pickCachedDetect(ctx.options, input, name);
  if (cached) return Promise.resolve(cached);
  return detectFile(input, name);
}

function isUsableInspect(c: unknown): c is InspectResult {
  if (!c || typeof c !== 'object') return false;
  const ins = c as Partial<InspectResult>;
  return Boolean(ins.family && ins.format && ins.family !== 'unknown');
}

function pickCachedDetect(
  options: Record<string, unknown>,
  input: string,
  name: string,
): InspectResult | null {
  // Path-keyed map from job runner (files.detect_json preload)
  const byPath = options._detectByPath as Record<string, unknown> | undefined;
  if (byPath && typeof byPath === 'object') {
    const hit = byPath[input] || byPath[path.resolve(input)];
    if (isUsableInspect(hit)) return hit as InspectResult;
  }

  const candidates = [options._detect, options.detectMeta];
  for (const c of candidates) {
    if (!isUsableInspect(c)) continue;
    const ins = c as Partial<InspectResult>;
    if (ins.originalName && ins.originalName !== name) {
      // For multi-file batches a single shared detect is not reliable
      continue;
    }
    // If path-like fields present, prefer match
    const anyPath =
      (ins as { path?: string; filePath?: string }).path ||
      (ins as { filePath?: string }).filePath;
    if (anyPath && path.resolve(String(anyPath)) !== path.resolve(input)) continue;
    return ins as InspectResult;
  }
  return null;
}

function validateConverterOutput(outputPath: string, format: string, outputName: string): void {
  const extFromName = path.extname(outputName || '') || path.extname(outputPath || '');
  const expected =
    extFromName ||
    `.${format === 'jpeg' ? 'jpg' : format}`;
  try {
    assertValidOutput(outputPath, {
      label: 'Converter output',
      expectedExt: expected,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'invalid output';
    throw badRequest(msg);
  }
}

/**
 * Engine handler dispatch table — prefer this over growing if/else chains.
 * Family-specific paths (image/media/archive/pdf) still fall through below
 * for builtin composite routes that share an engine id.
 */
const ENGINE_DISPATCH: Record<
  string,
  (args: {
    ctx: ProcessContext;
    input: string;
    name: string;
    inputFormat: string;
    out: string;
    route: EngineRoute;
  }) => Promise<ProcessResult> | ProcessResult
> = {
  pandoc: ({ ctx, input, name, out, route }) =>
    convertWithPandoc({
      inputPath: input,
      outputDir: ctx.outputDir,
      outputFormat: out,
      route,
      originalBaseName: base(name),
      jobId: ctx.jobId,
      isCancelled: ctx.isCancelled,
    }),
  calibre: ({ ctx, input, name, out }) =>
    convertWithCalibre({
      inputPath: input,
      outputDir: ctx.outputDir,
      outputFormat: out,
      originalBaseName: base(name),
      jobId: ctx.jobId,
      isCancelled: ctx.isCancelled,
    }),
  libreoffice: ({ ctx, input, name, inputFormat, out }) =>
    convertOfficeRoute(ctx, input, name, inputFormat, out),
  python: ({ ctx, input, name, out, route }) =>
    convertWithPython({
      inputPath: input,
      outputDir: ctx.outputDir,
      outputFormat: out,
      operation: String(route.metadata?.operation || 'data.json-transform'),
      originalBaseName: base(name),
      jobId: ctx.jobId,
      isCancelled: ctx.isCancelled,
      options: { format: out },
    }),
};

async function convertOne(
  ctx: ProcessContext,
  family: string,
  inputFormat: string,
  outputFormat: string,
  selectedRoute: EngineRoute,
): Promise<ProcessResult> {
  const out = outputFormat === 'jpg' ? 'jpeg' : outputFormat;
  const input = ctx.inputPaths[0];
  const name = ctx.inputNames[0] || 'file';
  const quality = resolveQualityPreset(ctx.options);

  const dispatched = ENGINE_DISPATCH[selectedRoute.engineId];
  if (dispatched) {
    return dispatched({
      ctx,
      input,
      name,
      inputFormat,
      out,
      route: selectedRoute,
    });
  }

  // Same-format pairs never route to LibreOffice.
  // PDF→PDF: safe copy only (optimize/normalize is a separate pdf:compress job).
  // Office same-format: reject as no-op (matrix also omits these).
  if (isSameFormatPair(inputFormat, out)) {
    if (family === 'pdf' || inputFormat === 'pdf') {
      const dest = path.join(ctx.outputDir, randomServerName('.pdf'));
      fs.copyFileSync(input, dest);
      assertValidOutput(dest, { label: 'PDF same-format copy', expectedExt: '.pdf' });
      return { outputPath: dest, outputName: name, outputMime: 'application/pdf' };
    }
    if (['document', 'spreadsheet', 'presentation'].includes(family)) {
      throw badRequest(
        `Same-format conversion ${inputFormat} → ${out} is a no-op. Choose a different output format or use a dedicated optimize tool.`,
      );
    }
  }

  // Images via Sharp (direct encode — no intermediate raster when unnecessary)
  if (family === 'image') {
    if (out === 'pdf') {
      // Single hop: image → png buffer → pdf (png is required for pdf-lib embed)
      const png = await sharp(input).png().toBuffer();
      const doc = await PDFDocument.create();
      const img = await doc.embedPng(png);
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      const bytes = await doc.save();
      const outPath = path.join(ctx.outputDir, randomServerName('.pdf'));
      fs.writeFileSync(outPath, bytes);
      return { outputPath: outPath, outputName: `${base(name)}.pdf`, outputMime: 'application/pdf' };
    }
    if (['mp4', 'webm'].includes(out) && inputFormat === 'gif') {
      // Direct gif → video; no intermediate frame dump
      return processMedia({
        ...ctx,
        options: {
          operation: 'convert',
          format: out,
          family: 'media',
          quality,
          _engineRoute: selectedRoute,
          _detect: ctx.options._detect,
          detectMeta: ctx.options.detectMeta,
        },
      });
    }
    return processImage({
      ...ctx,
      options: {
        operation: 'convert',
        format: out === 'jpeg' ? 'jpeg' : out,
        quality: ctx.options.quality,
        stripMetadata: ctx.options.preserveMetadata === false,
      },
    });
  }

  // Audio / video via ffmpeg — direct convert; stream-copy when codecs allow
  if (family === 'audio' || family === 'video') {
    const audioOut = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma'].includes(out);
    if (family === 'video' && audioOut) {
      return processMedia({
        ...ctx,
        options: {
          operation: 'extract-audio',
          format: out,
          family: 'media',
          quality,
          _engineRoute: selectedRoute,
          _detect: ctx.options._detect,
          detectMeta: ctx.options.detectMeta,
        },
      });
    }
    return processMedia({
      ...ctx,
      options: {
        operation: 'convert',
        format: out,
        family: family === 'audio' ? 'audio' : 'media',
        quality,
        _engineRoute: selectedRoute,
        _detect: ctx.options._detect,
        detectMeta: ctx.options.detectMeta,
      },
    });
  }

  // Archives — extract real members, then re-archive (never wrap a zip as a single member)
  if (family === 'archive') {
    if (['zip', 'tar', 'gz', '7z'].includes(out)) {
      if (out === inputFormat || (out === 'gz' && inputFormat === 'gzip')) {
        // Same-format: direct copy, no extract/repack intermediate
        const dest = path.join(ctx.outputDir, randomServerName(`.${out}`));
        fs.copyFileSync(input, dest);
        return {
          outputPath: dest,
          outputName: `${base(name)}.${out}`,
          outputMime: mimeFromName(`.${out}`),
        };
      }
      const extracted = await processArchive({
        ...ctx,
        options: { operation: 'extract', format: inputFormat, leaveExtracted: true },
      });
      const extractRoot = String(extracted.meta?.extractRoot || extracted.outputPath);
      const entries = (extracted.meta?.entries as string[]) || [];
      const memberPaths = entries.map((rel) => path.join(extractRoot, rel)).filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!memberPaths.length) throw badRequest('Archive contained no extractable files');
      if (out === 'zip') {
        return processArchive({
          ...ctx,
          inputPaths: memberPaths,
          inputNames: memberPaths.map((p) => path.relative(extractRoot, p)),
          options: { operation: 'create', format: 'zip' },
        });
      }
      // tar / gz / 7z of extracted members
      if (out === 'gz' && memberPaths.length === 1) {
        return processArchive({
          ...ctx,
          inputPaths: [memberPaths[0]],
          inputNames: [path.basename(memberPaths[0])],
          options: { operation: 'create', format: 'gz' },
        });
      }
      return processArchive({
        ...ctx,
        inputPaths: memberPaths,
        inputNames: memberPaths.map((p) => path.relative(extractRoot, p)),
        options: { operation: 'create', format: out },
      });
    }
    throw badRequest(`Unsupported archive target ${out}`);
  }

  // Pure spreadsheet text pairs (no LibreOffice)
  if (family === 'spreadsheet' && ['csv', 'tsv'].includes(inputFormat)) {
    if (['csv', 'tsv', 'txt'].includes(out)) {
      const raw = fs.readFileSync(input, 'utf8');
      let text = raw;
      if (inputFormat === 'csv' && out === 'tsv') {
        text = csvToTsv(raw);
      } else if (inputFormat === 'tsv' && out === 'csv') {
        text = tsvToCsv(raw);
      }
      // txt = same content
      const ext = `.${out}`;
      const outPath = path.join(ctx.outputDir, randomServerName(ext));
      fs.writeFileSync(outPath, text, 'utf8');
      return {
        outputPath: outPath,
        outputName: `${base(name)}${ext}`,
        outputMime: out === 'csv' ? 'text/csv' : 'text/plain',
      };
    }
  }

  // PDF family — PDF-specific engines only (never LibreOffice)
  if (family === 'pdf' || inputFormat === 'pdf') {
    return convertPdfFamily(ctx, input, name, out);
  }

  // Office families — direct LO convert (no intermediate like first-to-pdf-then-docx).
  // Identical formats already handled above — never call LO for PDF→PDF etc.
  if (['document', 'spreadsheet', 'presentation'].includes(family)) {
    if (isSameFormatPair(inputFormat, out)) {
      throw badRequest(`Same-format ${inputFormat} → ${out} must not use LibreOffice`);
    }
    return convertOfficeRoute(ctx, input, name, inputFormat, out);
  }

  // Text / ebook
  if (family === 'text' || family === 'ebook') {
    if (out === 'pdf' && ['txt', 'md', 'html', 'htm'].includes(inputFormat)) {
      const r = await textToPdf({
        inputPath: input,
        outputDir: ctx.outputDir,
        title: base(name),
      });
      return { outputPath: r.outputPath, outputName: r.outputName, outputMime: 'application/pdf' };
    }
    if (['txt', 'md', 'html'].includes(out) && ['txt', 'md', 'html', 'htm'].includes(inputFormat)) {
      const raw = fs.readFileSync(input, 'utf8');
      const converted = convertTextFormat(raw, inputFormat, out);
      const ext = `.${out}`;
      const outPath = path.join(ctx.outputDir, randomServerName(ext));
      fs.writeFileSync(outPath, converted, 'utf8');
      return {
        outputPath: outPath,
        outputName: `${base(name)}${ext}`,
        outputMime: out === 'html' ? 'text/html' : 'text/plain',
      };
    }
  }

  throw badRequest(`No converter for family ${family} (${inputFormat} → ${out})`);
}

async function convertOfficeRoute(
  ctx: ProcessContext,
  input: string,
  name: string,
  inputFormat: string,
  outputFormat: string,
): Promise<ProcessResult> {
  if (isSameFormatPair(inputFormat, outputFormat)) {
    throw badRequest(`Same-format ${inputFormat} → ${outputFormat} must not use LibreOffice`);
  }
  const loOut = await convertWithLibreOffice({
    inputPath: input,
    outputDir: ctx.workDir,
    outFormat: outputFormat,
    isCancelled: ctx.isCancelled,
    jobId: ctx.jobId,
    originalBaseName: base(name),
  });
  const final = path.join(ctx.outputDir, path.basename(loOut.outputPath));
  fs.copyFileSync(loOut.outputPath, final);
  return {
    outputPath: final,
    outputName: loOut.outputName,
    outputMime: mimeFromName(loOut.outputName),
  };
}

/**
 * PDF convert pairs: text extraction, rasterize to images.
 * LibreOffice is never invoked for PDF input.
 */
async function convertPdfFamily(
  ctx: ProcessContext,
  input: string,
  name: string,
  out: string,
): Promise<ProcessResult> {
  ctx.onProgress(8, 'validating');
  await validatePdfInput(input, { originalName: name });

  const ocr = Boolean(ctx.options.ocr || ctx.options.useOcr || ctx.options.enableOcr);
  const route = routeConversion(
    { family: 'pdf', format: 'pdf', ext: '.pdf', mime: 'application/pdf' },
    out,
  );
  if (route.engine === 'unsupported' || route.libreOfficeAllowed) {
    throw badRequest(route.reason || `Unsupported conversion: pdf → ${out}`);
  }

  if (out === 'txt') {
    ctx.onProgress(12, 'extracting');
    try {
      const result = await extractPdfText({
        inputPath: input,
        outputDir: ctx.outputDir,
        ocr,
        ocrLang: typeof ctx.options.ocrLang === 'string' ? ctx.options.ocrLang : undefined,
        originalBaseName: base(name),
        jobId: ctx.jobId,
        isCancelled: ctx.isCancelled,
        onProgress: (p, msg) => ctx.onProgress(12 + p * 0.85, msg),
      });
      return {
        outputPath: result.outputPath,
        outputName: result.outputName,
        outputMime: 'text/plain',
        meta: {
          engine: result.engine,
          pageCount: result.pageCount,
          charCount: result.charCount,
          scanned: result.scanned,
          usedOcr: result.usedOcr,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PDF text extraction failed';
      // Re-throw AppError-shaped errors as-is
      if (e && typeof e === 'object' && (e as { name?: string }).name === 'AppError') throw e;
      throw badRequest(sanitizeUserError(msg));
    }
  }

  if (['png', 'jpeg', 'jpg'].includes(out)) {
    ctx.onProgress(12, 'rendering');
    const result = await convertPdfToImages({
      inputPath: input,
      outputDir: ctx.outputDir,
      format: out === 'jpg' ? 'jpeg' : (out as 'png' | 'jpeg'),
      jobId: ctx.jobId,
      isCancelled: ctx.isCancelled,
      onProgress: (p, msg) => ctx.onProgress(12 + p * 0.85, msg),
      originalBaseName: base(name),
      workDir: path.join(ctx.workDir, 'pdf-raster'),
    });
    return {
      outputPath: result.outputPath,
      outputName: result.outputName,
      outputMime: result.outputMime,
      meta: result.meta,
    };
  }

  throw pdfError(
    'UNSUPPORTED_CONVERSION',
    `Unsupported conversion: pdf → ${out}`,
  );
}

function base(name: string) {
  return path.basename(name, path.extname(name));
}

function csvToTsv(csv: string): string {
  // Naive RFC4180-ish: split rows, respect simple quoted fields
  return csv
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const fields: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
          fields.push(cur);
          cur = '';
        } else cur += ch;
      }
      fields.push(cur);
      return fields.join('\t');
    })
    .join('\n');
}

function tsvToCsv(tsv: string): string {
  return tsv
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .split('\t')
        .map((f) => {
          if (/[",\n]/.test(f)) return `"${f.replace(/"/g, '""')}"`;
          return f;
        })
        .join(','),
    )
    .join('\n');
}

function mimeFromName(name: string): string {
  const ext = path.extname(name).toLowerCase() || (name.startsWith('.') ? name : `.${name}`);
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.7z': 'application/x-7z-compressed',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.json': 'application/json',
    '.parquet': 'application/vnd.apache.parquet',
  };
  return map[ext] || 'application/octet-stream';
}
