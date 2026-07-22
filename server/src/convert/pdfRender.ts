/**
 * PDF → image rasterization via external tools only (never LibreOffice).
 * Engines: pdftoppm (Poppler) → mutool (MuPDF) → Ghostscript.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileTracked } from '../lib/child-registry.js';
import {
  hasPdfRasterizer,
  resolveOptionalBinary,
} from '../tools/optional-binaries.js';
import { pdfError, sanitizeUserError, validatePdfInput } from './pdfInspect.js';
import { assertValidOutput } from './quality.js';
import { randomServerName } from '../lib/paths.js';

export type RasterEngine = 'pdftoppm' | 'mutool' | 'ghostscript';

export function rasterPrefixForEngine(base: string, engine: RasterEngine): string {
  return `${base}-${engine}-`;
}

export type RasterizeOptions = {
  inputPath: string;
  outputDir: string;
  format?: 'png' | 'jpeg' | 'jpg';
  dpi?: number;
  maxPages?: number;
  jobId?: string;
  isCancelled?: () => boolean;
  onProgress?: (pct: number, message: string) => void;
  originalBaseName?: string;
};

export type RasterizeResult = {
  pages: { path: string; name: string }[];
  engine: RasterEngine;
  pageCount: number;
  /** Single file if 1 page; otherwise zip path filled by caller */
  primaryPath?: string;
  primaryName?: string;
};

/**
 * Rasterize PDF pages to PNG/JPEG files in outputDir.
 * Returns pages + the engine that produced them.
 */
export async function rasterizePdfPages(
  opts: RasterizeOptions,
): Promise<{ path: string; name: string }[]> {
  const result = await rasterizePdfPagesWithEngine(opts);
  return result.pages;
}

/** Like rasterizePdfPages but includes the actual engine name. */
export async function rasterizePdfPagesWithEngine(
  opts: RasterizeOptions,
): Promise<{ pages: { path: string; name: string }[]; engine: RasterEngine }> {
  if (!hasPdfRasterizer()) {
    throw pdfError(
      'RASTERIZER_UNAVAILABLE',
      'PDF rasterizer not found (install pdftoppm, mutool, or Ghostscript)',
      503,
    );
  }

  opts.onProgress?.(10, 'validating');
  await validatePdfInput(opts.inputPath);
  if (opts.isCancelled?.()) throw pdfError('CORRUPTED_PDF', 'Cancelled');

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const format = opts.format === 'jpg' || opts.format === 'jpeg' ? 'jpeg' : 'png';
  const dpi = opts.dpi ?? 150;
  const prefix = `page-${randomBytes(3).toString('hex')}`;

  opts.onProgress?.(25, 'rendering');

  const pdftoppm = resolveOptionalBinary('pdftoppm');
  if (pdftoppm.available && pdftoppm.path) {
    try {
      const pages = await runPdftoppm(
        pdftoppm.path,
        opts,
        format,
        dpi,
        rasterPrefixForEngine(prefix, 'pdftoppm'),
      );
      return { pages, engine: 'pdftoppm' };
    } catch (e) {
      if (opts.isCancelled?.()) throw e;
    }
  }

  const mutool = resolveOptionalBinary('mutool');
  if (mutool.available && mutool.path) {
    try {
      const pages = await runMutool(
        mutool.path,
        opts,
        format,
        dpi,
        rasterPrefixForEngine(prefix, 'mutool'),
      );
      return { pages, engine: 'mutool' };
    } catch (e) {
      if (opts.isCancelled?.()) throw e;
    }
  }

  const gs = resolveOptionalBinary('ghostscript');
  if (gs.available && gs.path) {
    try {
      const pages = await runGhostscript(
        gs.path,
        opts,
        format,
        dpi,
        rasterPrefixForEngine(prefix, 'ghostscript'),
      );
      return { pages, engine: 'ghostscript' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ghostscript failed';
      throw pdfError(
        'RASTERIZER_UNAVAILABLE',
        `PDF render failed (${sanitizeUserError(msg)})`,
        503,
      );
    }
  }

  throw pdfError(
    'RASTERIZER_UNAVAILABLE',
    'No working PDF rasterizer',
    503,
  );
}

/**
 * Select rasterized pages by zero-based PDF page indices.
 * `rasterPages[i]` is assumed to correspond to PDF page index `i` when raster
 * started at page 1 (default). Order of `pageIndices` is preserved.
 * Exported for unit tests.
 */
export function filterRasterPagesByIndices<T>(
  rasterPages: T[],
  pageIndices: number[] | undefined,
): T[] {
  if (!pageIndices || !pageIndices.length) return rasterPages;
  const out: T[] = [];
  for (const idx of pageIndices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= rasterPages.length) {
      throw pdfError(
        'PAGE_OUT_OF_RANGE',
        `Page ${idx + 1} is out of range for rasterized output (${rasterPages.length} page(s) rendered)`,
      );
    }
    out.push(rasterPages[idx]!);
  }
  return out;
}

/**
 * Convert PDF → images for the universal converter (single image or zip of pages).
 */
export async function convertPdfToImages(opts: {
  inputPath: string;
  outputDir: string;
  format: 'png' | 'jpeg' | 'jpg';
  jobId?: string;
  isCancelled?: () => boolean;
  onProgress?: (pct: number, message: string) => void;
  originalBaseName?: string;
  workDir?: string;
  maxPages?: number;
  dpi?: number;
  /**
   * Zero-based page indices to keep (user selection). Raster may produce a
   * contiguous prefix/range; this filters to the exact selected pages in order.
   */
  pageIndices?: number[];
}): Promise<{ outputPath: string; outputName: string; outputMime: string; meta?: Record<string, unknown> }> {
  const format = opts.format === 'jpg' ? 'jpeg' : opts.format;
  const work = opts.workDir || path.join(opts.outputDir, `raster-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(work, { recursive: true });

  // When selecting non-prefix pages, render through the last selected page then filter.
  let maxPages = opts.maxPages;
  if (opts.pageIndices?.length) {
    const last = Math.max(...opts.pageIndices) + 1;
    maxPages = maxPages != null ? Math.max(maxPages, last) : last;
  }

  let pages: { path: string; name: string }[] = [];
  let engine: RasterEngine = 'pdftoppm';
  try {
    const raster = await rasterizePdfPagesWithEngine({
      inputPath: opts.inputPath,
      outputDir: work,
      format,
      jobId: opts.jobId,
      isCancelled: opts.isCancelled,
      onProgress: opts.onProgress,
      maxPages,
      dpi: opts.dpi,
    });
    pages = filterRasterPagesByIndices(raster.pages, opts.pageIndices);
    engine = raster.engine;
  } catch (e) {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw e;
  }

  if (!pages.length) {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw pdfError('OUTPUT_VALIDATION_FAILED', 'Output validation failed: no images produced');
  }

  const base =
    (opts.originalBaseName && opts.originalBaseName.trim()) ||
    path.basename(opts.inputPath, path.extname(opts.inputPath));
  const ext = format === 'jpeg' ? '.jpg' : '.png';
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const selectedLabels =
    opts.pageIndices?.length
      ? opts.pageIndices.map((i) => i + 1)
      : pages.map((_, i) => i + 1);

  // Single page → single image in outputDir
  if (pages.length === 1) {
    const finalName = randomServerName(ext);
    const finalPath = path.join(opts.outputDir, finalName);
    fs.copyFileSync(pages[0]!.path, finalPath);
    assertValidOutput(finalPath, { label: 'PDF page image', expectedExt: ext });
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    opts.onProgress?.(100, 'completed');
    const pageNo = selectedLabels[0] ?? 1;
    return {
      outputPath: finalPath,
      outputName: `${base}-page-${pageNo}${ext}`,
      outputMime: mime,
      meta: { pages: 1, engine, selectedPages: selectedLabels },
    };
  }

  // Multi-page → zip (safe entry names — no path traversal)
  const { default: archiver } = await import('archiver');
  const zipName = randomServerName('.zip');
  const zipPath = path.join(opts.outputDir, zipName);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('error', reject);
  });
  archive.pipe(output);
  const safeBase = base.replace(/[/\\]/g, '_');
  for (let i = 0; i < pages.length; i++) {
    const pageNo = selectedLabels[i] ?? i + 1;
    archive.file(pages[i]!.path, { name: `${safeBase}-page-${pageNo}${ext}` });
  }
  await archive.finalize();
  await done;
  assertValidOutput(zipPath, { label: 'PDF images zip', expectedExt: '.zip' });
  try {
    fs.rmSync(work, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  opts.onProgress?.(100, 'completed');
  return {
    outputPath: zipPath,
    outputName: `${safeBase}-pages.zip`,
    outputMime: 'application/zip',
    meta: { pages: pages.length, engine, selectedPages: selectedLabels },
  };
}

async function runPdftoppm(
  bin: string,
  opts: RasterizeOptions,
  format: string,
  dpi: number,
  prefix: string,
): Promise<{ path: string; name: string }[]> {
  const outPrefix = path.join(opts.outputDir, prefix);
  const fmtFlag = format === 'jpeg' ? '-jpeg' : '-png';
  const args = [fmtFlag, '-r', String(dpi)];
  if (opts.maxPages && opts.maxPages > 0) {
    args.push('-f', '1', '-l', String(opts.maxPages));
  }
  args.push(opts.inputPath, outPrefix);

  await execFileTracked(bin, args, {
    jobId: opts.jobId,
    timeout: 180_000,
    windowsHide: true,
  });

  return collectPages(opts.outputDir, prefix, format === 'jpeg' ? ['.jpg', '.jpeg'] : ['.png']);
}

async function runMutool(
  bin: string,
  opts: RasterizeOptions,
  format: string,
  dpi: number,
  prefix: string,
): Promise<{ path: string; name: string }[]> {
  const fmt = format === 'jpeg' ? 'jpeg' : 'png';
  // mutool draw -o out%d.png -F png -r 150 input.pdf
  const pattern = path.join(opts.outputDir, `${prefix}%d.${fmt === 'jpeg' ? 'jpg' : 'png'}`);
  const args = ['draw', '-o', pattern, '-F', fmt, '-r', String(dpi)];
  if (opts.maxPages && opts.maxPages > 0) {
    args.push(opts.inputPath, `1-${opts.maxPages}`);
  } else {
    args.push(opts.inputPath);
  }
  await execFileTracked(bin, args, {
    jobId: opts.jobId,
    timeout: 180_000,
    windowsHide: true,
  });
  return collectPages(opts.outputDir, prefix, fmt === 'jpeg' ? ['.jpg', '.jpeg'] : ['.png']);
}

async function runGhostscript(
  bin: string,
  opts: RasterizeOptions,
  format: string,
  dpi: number,
  prefix: string,
): Promise<{ path: string; name: string }[]> {
  const device = format === 'jpeg' ? 'jpeg' : 'png16m';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const pattern = path.join(opts.outputDir, `${prefix}%03d.${ext}`);
  const args = [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    `-sDEVICE=${device}`,
    `-r${dpi}`,
    `-sOutputFile=${pattern}`,
  ];
  if (opts.maxPages && opts.maxPages > 0) {
    args.push(`-dLastPage=${opts.maxPages}`);
  }
  args.push(opts.inputPath);

  await execFileTracked(bin, args, {
    jobId: opts.jobId,
    timeout: 180_000,
    windowsHide: true,
  });
  return collectPages(opts.outputDir, prefix, [`.${ext}`, '.jpeg']);
}

function collectPages(
  dir: string,
  prefix: string,
  exts: string[],
): { path: string; name: string }[] {
  const files = fs.readdirSync(dir).filter((f) => {
    if (!f.startsWith(prefix)) return false;
    const e = path.extname(f).toLowerCase();
    return exts.includes(e);
  });
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out: { path: string; name: string }[] = [];
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 0) {
        assertValidOutput(p, { label: 'Raster page' });
        out.push({ path: p, name: f });
      }
    } catch {
      /* skip invalid */
    }
  }
  if (!out.length) {
    throw new Error('Rasterizer produced no image files');
  }
  return out;
}

export function pdfToImagesAvailable(): boolean {
  return hasPdfRasterizer();
}
