/**
 * Optional external binaries for PDF pipeline (not required for core app).
 * Resolved from PATH + common install locations; cached briefly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type OptionalBinary = {
  name: string;
  path: string;
  available: boolean;
  version?: string;
};

const NAMES = [
  'pdftotext',
  'pdftoppm',
  'mutool',
  'tesseract',
  'gs',
  'gswin64c',
  'gswin32c',
  'qpdf',
] as const;

export type OptionalBinaryName =
  | 'pdftotext'
  | 'pdftoppm'
  | 'mutool'
  | 'tesseract'
  | 'ghostscript'
  | 'qpdf';

let cache: { at: number; map: Record<string, OptionalBinary> } | null = null;
const TTL_MS = 60_000;

function whichAll(name: string): string[] {
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [`${name}.exe`, name, `${name}.cmd`, `${name}.bat`]
    : [name];
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const hits: string[] = [];
  for (const dir of dirs) {
    for (const n of candidates) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) hits.push(p);
    }
  }
  // Common Windows install locations
  if (isWin) {
    const extras: string[] = [];
    if (name === 'tesseract') {
      extras.push(
        'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
        'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe',
      );
    }
    if (name === 'pdftotext' || name === 'pdftoppm') {
      extras.push(
        `C:\\Program Files\\poppler\\Library\\bin\\${name}.exe`,
        `C:\\poppler\\Library\\bin\\${name}.exe`,
        `C:\\Program Files\\Git\\mingw64\\bin\\${name}.exe`,
      );
    }
    if (name === 'gswin64c' || name === 'gs') {
      extras.push(
        'C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin64c.exe',
        'C:\\Program Files\\gs\\gs10.02.1\\bin\\gswin64c.exe',
      );
      // glob-ish: scan Program Files\gs
      try {
        const gsRoot = 'C:\\Program Files\\gs';
        if (fs.existsSync(gsRoot)) {
          for (const d of fs.readdirSync(gsRoot)) {
            const p = path.join(gsRoot, d, 'bin', 'gswin64c.exe');
            if (fs.existsSync(p)) extras.push(p);
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (name === 'mutool') {
      extras.push(
        'C:\\Program Files\\mupdf\\mutool.exe',
        'C:\\mupdf\\mutool.exe',
      );
    }
    if (name === 'qpdf') {
      extras.push(
        'C:\\Program Files\\qpdf\\bin\\qpdf.exe',
        'C:\\Program Files\\qpdf\\qpdf.exe',
      );
    }
    for (const p of extras) {
      if (fs.existsSync(p) && !hits.includes(p)) hits.push(p);
    }
  }
  return hits;
}

function probeVersion(execPath: string, name: string): string | undefined {
  const argSets: string[][] = [['-v'], ['--version'], ['-version'], ['version']];
  if (name === 'tesseract') argSets.unshift(['--version']);
  if (name.startsWith('gs')) argSets.unshift(['--version']);
  for (const args of argSets) {
    try {
      const out = execFileSync(execPath, args, {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const first = String(out).split(/\r?\n/)[0]?.trim();
      if (first) return first.slice(0, 120);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      const msg = String(err.stdout || err.stderr || '');
      if (msg.trim()) return msg.split(/\r?\n/)[0]?.trim().slice(0, 120);
    }
  }
  // Binary exists — treat available without version
  return undefined;
}

function resolveOne(logical: OptionalBinaryName): OptionalBinary {
  const searchNames: string[] =
    logical === 'ghostscript'
      ? process.platform === 'win32'
        ? ['gswin64c', 'gswin32c', 'gs']
        : ['gs']
      : [logical];

  for (const n of searchNames) {
    const hits = whichAll(n);
    for (const p of hits) {
      const version = probeVersion(p, n);
      // Accept if file exists (probe may fail on some CLI tools that print to stderr only)
      if (fs.existsSync(p)) {
        return { name: logical, path: p, available: true, version: version || n };
      }
    }
  }
  return { name: logical, path: '', available: false };
}

export function resolveOptionalBinary(
  name: OptionalBinaryName,
  force = false,
): OptionalBinary {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS && cache.map[name]) {
    return cache.map[name];
  }
  const all = resolveAllOptionalBinaries(force);
  return all[name] || { name, path: '', available: false };
}

export function resolveAllOptionalBinaries(
  force = false,
): Record<OptionalBinaryName, OptionalBinary> {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS) {
    return cache.map as Record<OptionalBinaryName, OptionalBinary>;
  }
  const map: Record<string, OptionalBinary> = {
    pdftotext: resolveOne('pdftotext'),
    pdftoppm: resolveOne('pdftoppm'),
    mutool: resolveOne('mutool'),
    tesseract: resolveOne('tesseract'),
    ghostscript: resolveOne('ghostscript'),
    qpdf: resolveOne('qpdf'),
  };
  cache = { at: now, map };
  return map as Record<OptionalBinaryName, OptionalBinary>;
}

export function invalidateOptionalBinaries(): void {
  cache = null;
}

/** True when any PDF rasterizer is present. */
export function hasPdfRasterizer(): boolean {
  const all = resolveAllOptionalBinaries();
  return (
    all.pdftoppm.available ||
    all.mutool.available ||
    all.ghostscript.available
  );
}

/** True when OCR stack can run (tesseract + rasterizer). */
export function hasOcrStack(): boolean {
  const all = resolveAllOptionalBinaries();
  return all.tesseract.available && hasPdfRasterizer();
}

// Keep NAMES referenced for future expansion
void NAMES;
