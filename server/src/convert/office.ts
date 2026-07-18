import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { badRequest, unavailable } from '../lib/errors.js';
import { requireTool, normalizeLibreOfficePath, isLibreOfficeInstallComplete } from '../tools/registry.js';
import { randomServerName } from '../lib/paths.js';
import { execFileTracked } from '../lib/child-registry.js';
import { config } from '../config.js';
import { assertValidOutput } from './quality.js';
import { logger } from '../lib/logger.js';
import { sanitizeUserError } from './pdfInspect.js';

/**
 * Convert office/document via LibreOffice headless.
 * Fixed argv only — never shell-interpolates user strings into a shell.
 * Each job gets isolated:
 *   - UserInstallation profile under temp/lo-profiles
 *   - empty per-invocation --outdir (no shared leftover pollution)
 *   - optional isolated input copy when names need Unicode/spaces safety
 */
export async function convertWithLibreOffice(opts: {
  inputPath: string;
  outputDir: string;
  /** LO filter target e.g. pdf, docx, csv, png */
  outFormat: string;
  timeoutMs?: number;
  isCancelled?: () => boolean;
  jobId?: string;
  /** Display basename for outputName (without ext); defaults to input basename */
  originalBaseName?: string;
}): Promise<{ outputPath: string; outputName: string }> {
  // Module boundary: never run LO for no-op same-format (esp. PDF→PDF)
  // Callers should gate earlier; this is defense-in-depth.
  if (opts.inputPath && opts.outFormat) {
    const inExt = path.extname(opts.inputPath).replace(/^\./, '').toLowerCase();
    if (isSameFormatPair(inExt, opts.outFormat)) {
      throw badRequest(
        `Same-format ${inExt || '?'} → ${opts.outFormat} must not use LibreOffice`,
      );
    }
  }

  let lo;
  try {
    lo = requireTool('libreoffice');
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'LibreOffice not available';
    throw unavailable('libreoffice', sanitizeUserError(msg)); // AppError 503
  }

  // Prefer validated soffice.com on Windows; require complete install (not bare copy)
  const loPath = normalizeLibreOfficePath(lo.path);
  if (!isLibreOfficeInstallComplete(loPath)) {
    throw unavailable(
      'libreoffice',
      'LibreOffice runtime is incomplete (missing program libraries). Install a full LibreOffice or run npm run setup:tools.',
    );
  }
  if (opts.isCancelled?.()) throw badRequest('Cancelled');

  fs.mkdirSync(opts.outputDir, { recursive: true });

  const runId = `${(opts.jobId || randomBytes(4).toString('hex')).replace(/[^\w.-]/g, '_')}-${randomBytes(4).toString('hex')}`;
  const tempRoot = fs.existsSync(config.tempDir) ? config.tempDir : os.tmpdir();

  // Isolated LO profile (never share the user's default profile)
  const profileDir = path.join(tempRoot, 'lo-profiles', `lo-${runId}`);
  // Per-invocation empty outdir — avoids multi-file batch picking leftover outputs
  const loOutDir = path.join(opts.outputDir, `lo-out-${runId}`);
  // Marker under outputDir so tests observe isolation
  const profileMarker = path.join(opts.outputDir, 'lo-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(loOutDir, { recursive: true });
  fs.mkdirSync(profileMarker, { recursive: true });

  const profileUrl = pathToFileURL(profileDir).href;
  const filter = loFilter(opts.outFormat);
  const expectedExt = `.${normalizeExt(opts.outFormat)}`;

  // Copy input into isolated dir so LO sees a simple ASCII basename (Unicode/spaces safe)
  const inputBase = path.basename(opts.inputPath);
  const safeInputName = sanitizeLoInputName(inputBase, expectedExt);
  const isolatedInput = path.join(loOutDir, safeInputName);
  fs.copyFileSync(opts.inputPath, isolatedInput);

  // Working directory = LO program dir so relative library lookup works
  const loCwd = path.dirname(loPath);

  const args = [
    '-env:UserInstallation=' + profileUrl,
    '--headless',
    '--nologo',
    '--nofirststartwizard',
    '--norestore',
    '--nodefault',
    '--convert-to',
    filter,
    '--outdir',
    loOutDir,
    isolatedInput,
  ];

  let stdout = '';
  let stderr = '';
  let exitCode: number | null = null;

  // Enrich env so Windows LO finds its program/ prefix libraries
  const loEnv: NodeJS.ProcessEnv = {
    ...process.env,
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '',
    // Avoid inheriting a broken URE_BOOTSTRAP from a partial install
  };
  if (process.platform === 'win32') {
    const programDir = loCwd;
    const pathKey = Object.keys(loEnv).find((k) => k.toLowerCase() === 'path') || 'Path';
    loEnv[pathKey] = `${programDir}${path.delimiter}${loEnv[pathKey] || ''}`;
  }

  try {
    const result = await execFileTracked(loPath, args, {
      jobId: opts.jobId,
      timeout: opts.timeoutMs ?? 180_000,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      cwd: loCwd,
      env: loEnv,
    });
    stdout = String(result?.stdout || '');
    stderr = String(result?.stderr || '');
    exitCode = 0;
  } catch (e) {
    try {
      fs.rmSync(loOutDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    if (opts.isCancelled?.()) throw badRequest('Cancelled');
    const err = e as Error & { stderr?: string; stdout?: string; code?: number | string };
    stderr = String(err.stderr || err.message || '');
    stdout = String(err.stdout || '');
    exitCode = typeof err.code === 'number' ? err.code : null;
    const snippet = sanitizeUserError(
      stderr.slice(0, 800).trim() || err.message || 'LibreOffice conversion failed',
    );
    // Map classic incomplete-install error to capability message
    if (/platform independent libraries|URE_BOOTSTRAP|javaldx|cannot find/i.test(stderr + snippet)) {
      logger.warn({ jobId: opts.jobId, exitCode }, 'LibreOffice runtime incomplete');
      throw unavailable(
        'libreoffice',
        'LibreOffice runtime is incomplete. Install a full LibreOffice or run npm run setup:tools.',
      );
    }
    logger.warn(
      { jobId: opts.jobId, exitCode, stderr: stderr.slice(0, 500) },
      'LibreOffice conversion failed',
    );
    throw badRequest(
      `Office conversion failed (exit=${exitCode ?? 'n/a'}): ${snippet}`,
    );
  } finally {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  if (opts.isCancelled?.()) {
    try {
      fs.rmSync(loOutDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw badRequest('Cancelled');
  }

  // Enumerate ONLY the isolated outdir (never assume a single filename)
  const found = pickLoOutput(loOutDir, safeInputName, expectedExt);
  if (!found) {
    const listed = safeReaddir(loOutDir).join(', ') || '(empty)';
    try {
      fs.rmSync(loOutDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    throw badRequest(
      sanitizeUserError(
        `LibreOffice produced no output file (expected ${expectedExt}). files=[${listed}] stderr=${stderr.slice(0, 200)}`,
      ),
    );
  }

  const produced = path.join(loOutDir, found);
  try {
    assertValidOutput(produced, {
      label: 'LibreOffice output',
      expectedExt,
    });
    assertMagicForFormat(produced, expectedExt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'invalid output';
    try {
      fs.rmSync(loOutDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    throw badRequest(`Office conversion failed validation: ${sanitizeUserError(msg)}`);
  }

  const finalName = randomServerName(expectedExt);
  const finalPath = path.join(opts.outputDir, finalName);
  fs.copyFileSync(produced, finalPath);

  try {
    assertValidOutput(finalPath, { label: 'Office output', expectedExt });
    assertMagicForFormat(finalPath, expectedExt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'invalid output';
    try {
      fs.rmSync(loOutDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    throw badRequest(`Office conversion failed validation: ${sanitizeUserError(msg)}`);
  }

  // Cleanup isolated outdir (best-effort; keep profile marker for tests)
  try {
    fs.rmSync(loOutDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const displayBase =
    (opts.originalBaseName && opts.originalBaseName.trim()) ||
    path.basename(opts.inputPath, path.extname(opts.inputPath));

  void stdout;
  void exitCode;

  return {
    outputPath: finalPath,
    outputName: `${displayBase}${expectedExt}`,
  };
}

/** Pick best LO output file from an isolated directory. */
export function pickLoOutput(
  outDir: string,
  inputFileName: string,
  expectedExt: string,
): string | null {
  const files = safeReaddir(outDir).filter((f) => {
    if (f === 'lo-profile' || f.startsWith('lo-profile')) return false;
    // Skip the copied input itself
    if (f === inputFileName) return false;
    try {
      return fs.statSync(path.join(outDir, f)).isFile();
    } catch {
      return false;
    }
  });
  if (!files.length) return null;

  const base = path.basename(inputFileName, path.extname(inputFileName));
  const ext = expectedExt.toLowerCase();

  // 1. Exact basename + ext
  const exact = files.find(
    (f) => f.toLowerCase() === `${base.toLowerCase()}${ext}`,
  );
  if (exact) return exact;

  // 2. Same base prefix + correct ext
  const sameBase = files.filter(
    (f) =>
      f.toLowerCase().startsWith(base.toLowerCase()) &&
      f.toLowerCase().endsWith(ext),
  );
  if (sameBase.length === 1) return sameBase[0];
  if (sameBase.length > 1) {
    // Prefer newest mtime
    return newestByMtime(outDir, sameBase);
  }

  // 3. Any file with expected ext — prefer newest (only files written by this run)
  const byExt = files.filter((f) => f.toLowerCase().endsWith(ext));
  if (byExt.length === 1) return byExt[0];
  if (byExt.length > 1) return newestByMtime(outDir, byExt);

  return null;
}

function newestByMtime(dir: string, names: string[]): string {
  let best = names[0];
  let bestM = -1;
  for (const n of names) {
    try {
      const m = fs.statSync(path.join(dir, n)).mtimeMs;
      if (m >= bestM) {
        bestM = m;
        best = n;
      }
    } catch {
      /* skip */
    }
  }
  return best;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Validate magic bytes for common office/PDF outputs.
 * Throws Error on mismatch (caller wraps as badRequest).
 */
export function assertMagicForFormat(filePath: string, expectedExt: string): void {
  const ext = expectedExt.startsWith('.')
    ? expectedExt.toLowerCase()
    : `.${expectedExt.toLowerCase()}`;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    if (n < 4) throw new Error(`file too small for magic check (${n} bytes)`);

    if (ext === '.pdf') {
      if (buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('expected PDF magic %PDF-');
      }
      return;
    }
    // OOXML / ODF / many LO exports are ZIP-based
    const zipExts = new Set([
      '.docx',
      '.xlsx',
      '.pptx',
      '.odt',
      '.ods',
      '.odp',
      '.epub',
    ]);
    if (zipExts.has(ext)) {
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
        throw new Error(`expected ZIP/OOXML magic PK for ${ext}`);
      }
      return;
    }
    if (ext === '.png') {
      const sig = [0x89, 0x50, 0x4e, 0x47];
      if (!sig.every((b, i) => buf[i] === b)) {
        throw new Error('expected PNG magic');
      }
      return;
    }
    if (ext === '.jpg' || ext === '.jpeg') {
      if (buf[0] !== 0xff || buf[1] !== 0xd8) {
        throw new Error('expected JPEG magic FF D8');
      }
      return;
    }
    // txt/csv/html/rtf — no strict magic; size already checked
  } finally {
    fs.closeSync(fd);
  }
}

function sanitizeLoInputName(original: string, expectedOutExt: string): string {
  const ext = path.extname(original) || expectedOutExt;
  // Keep only safe ASCII for LO argv portability; preserve extension
  const base = path
    .basename(original, path.extname(original))
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 80) || 'input';
  return `${base}${ext.startsWith('.') ? ext : `.${ext}`}`;
}

function normalizeExt(fmt: string): string {
  const f = fmt.toLowerCase() === 'jpg' ? 'jpeg' : fmt.toLowerCase();
  if (f === 'jpeg') return 'jpg';
  return f;
}

function loFilter(outFormat: string): string {
  const f = outFormat.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'pdf',
    docx: 'docx',
    doc: 'doc',
    odt: 'odt',
    rtf: 'rtf',
    txt: 'txt:Text',
    html: 'html:HTML',
    xlsx: 'xlsx',
    xls: 'xls',
    ods: 'ods',
    csv: 'csv',
    pptx: 'pptx',
    ppt: 'ppt',
    odp: 'odp',
    png: 'png',
    jpeg: 'jpg',
    jpg: 'jpg',
  };
  return map[f] || f;
}

/** True when input and output formats are the same (normalized). */
export function isSameFormatPair(inputFormat: string, outputFormat: string): boolean {
  const a = normalizeExt(String(inputFormat || ''));
  const b = normalizeExt(String(outputFormat || ''));
  return Boolean(a && b && a === b);
}
