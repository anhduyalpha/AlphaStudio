import fs from 'node:fs';
import path from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import * as tar from 'tar';
import { badRequest, unavailable } from '../lib/errors.js';
import { randomServerName, safeJoin } from '../lib/paths.js';
import { assertSafeArchiveEntry } from '../security/validation.js';
import { detectCapabilities } from '../capabilities.js';
import { execFileTracked } from '../lib/child-registry.js';
import { config } from '../config.js';
import type { ProcessContext, ProcessResult } from './types.js';

export class ExtractionQuota {
  private entries = 0;
  private bytes = 0;

  constructor(
    private readonly maxEntries = config.maxArchiveEntries,
    private readonly maxBytes = config.maxExtractedBytes,
  ) {}

  add(entryName: string, uncompressedBytes = 0): void {
    const size = Number(uncompressedBytes);
    if (!Number.isFinite(size) || size < 0) {
      throw badRequest(`Invalid archive entry size: ${entryName}`);
    }
    this.entries += 1;
    if (this.entries > this.maxEntries) {
      throw badRequest(`Archive has too many entries (limit ${this.maxEntries})`);
    }
    this.addBytes(entryName, size);
  }

  addBytes(entryName: string, uncompressedBytes: number): void {
    const size = Number(uncompressedBytes);
    if (!Number.isFinite(size) || size < 0) {
      throw badRequest(`Invalid archive entry size: ${entryName}`);
    }
    this.bytes += size;
    if (this.bytes > this.maxBytes) {
      throw badRequest(`Archive expands beyond ${this.maxBytes} bytes`);
    }
  }
}

function extractionMeter(quota: ExtractionQuota, entryName: string): Transform {
  quota.add(entryName, 0);
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        quota.addBytes(entryName, Buffer.byteLength(chunk));
        callback(null, chunk);
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

export async function processArchive(ctx: ProcessContext): Promise<ProcessResult> {
  const op = String(ctx.options.operation || 'create');
  const format = String(ctx.options.format || 'zip').toLowerCase();
  ctx.onProgress(10, `Archive ${op} (${format})`);

  if (op === 'create') return createArchive(ctx, format);
  if (op === 'extract') return extractArchive(ctx, format);
  if (op === 'inspect') return inspectArchive(ctx);
  throw badRequest(`Unknown archive operation: ${op}`);
}

async function createArchive(ctx: ProcessContext, format: string): Promise<ProcessResult> {
  if (!ctx.inputPaths.length) throw badRequest('Files required to create archive');

  if (format === 'zip') {
    const name = randomServerName('.zip');
    const outputPath = path.join(ctx.outputDir, name);
    await zipFiles(ctx.inputPaths, ctx.inputNames, outputPath, (p) => ctx.onProgress(10 + p * 0.8));
    if (ctx.isCancelled()) throw badRequest('Cancelled');
    ctx.onProgress(100, 'ZIP ready');
    return { outputPath, outputName: 'archive.zip', outputMime: 'application/zip' };
  }

  if (format === 'tar') {
    const name = randomServerName('.tar');
    const outputPath = path.join(ctx.outputDir, name);
    // tar pack from a staging dir of hardlinks/copies with safe basenames
    const stage = path.join(ctx.workDir, 'stage');
    fs.mkdirSync(stage, { recursive: true });
    const entries: string[] = [];
    ctx.inputPaths.forEach((p, i) => {
      const base = path.basename(ctx.inputNames[i] || p);
      const dest = path.join(stage, base);
      fs.copyFileSync(p, dest);
      entries.push(base);
    });
    await tar.c({ file: outputPath, cwd: stage }, entries);
    ctx.onProgress(100, 'TAR ready');
    return { outputPath, outputName: 'archive.tar', outputMime: 'application/x-tar' };
  }

  if (format === 'gz' || format === 'gzip') {
    if (ctx.inputPaths.length !== 1) throw badRequest('GZ compress accepts a single file');
    const name = randomServerName('.gz');
    const outputPath = path.join(ctx.outputDir, name);
    await pipeline(createReadStream(ctx.inputPaths[0]), createGzip(), createWriteStream(outputPath));
    ctx.onProgress(100, 'GZ ready');
    return {
      outputPath,
      outputName: `${path.basename(ctx.inputNames[0] || 'file')}.gz`,
      outputMime: 'application/gzip',
    };
  }

  if (format === '7z') {
    const caps = detectCapabilities();
    if (!caps.binaries['7z']?.available) {
      throw unavailable('archive.7z', '7z binary not found on PATH');
    }
    const name = randomServerName('.7z');
    const outputPath = path.join(ctx.outputDir, name);
    const bin = caps.binaries['7z'].path || '7z';
    await execFileTracked(bin, ['a', '-y', outputPath, ...ctx.inputPaths], {
      jobId: ctx.jobId,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    ctx.onProgress(100, '7Z ready');
    return { outputPath, outputName: 'archive.7z', outputMime: 'application/x-7z-compressed' };
  }

  throw badRequest(`Unsupported archive format: ${format}`);
}

async function extractArchive(ctx: ProcessContext, format: string): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('Archive required');
  const archivePath = ctx.inputPaths[0];
  const extractRoot = path.join(ctx.workDir, 'extract');
  fs.mkdirSync(extractRoot, { recursive: true });

  const detected =
    format === 'auto' || !format ? detectArchiveFormat(archivePath) : format.toLowerCase();

  if (detected === 'zip') {
    // Fail closed: any unsafe entry aborts the whole extract (zip-slip / symlink).
    const quota = new ExtractionQuota();
    try {
      await extractZip(archivePath, {
        dir: extractRoot,
        onEntry: (entry) => {
          assertSafeArchiveEntry(extractRoot, entry.fileName);
          quota.add(entry.fileName, Number(entry.uncompressedSize) || 0);
          // Unix symlink: high 16 bits are mode; S_IFLNK = 0o120000 (exact match)
          const attrs = (entry as { externalFileAttributes?: number }).externalFileAttributes;
          if (attrs != null && attrs !== 0) {
            const mode = (attrs >>> 16) & 0o170000;
            if (mode === 0o120000) {
              throw badRequest(`Symlink archive entry rejected: ${entry.fileName}`);
            }
          }
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unsafe or invalid ZIP';
      if (/traversal|zip-slip|Unsafe|Path|Symlink|hardlink/i.test(msg)) throw badRequest(msg);
      throw err;
    }
    assertExtractTreeSafe(extractRoot);
  } else if (detected === 'tar') {
    await extractTarSafe(archivePath, extractRoot, false);
    assertExtractTreeSafe(extractRoot);
  } else if (detected === 'tgz' || detected === 'tar.gz') {
    await extractTarSafe(archivePath, extractRoot, true);
    assertExtractTreeSafe(extractRoot);
  } else if (detected === 'gz' || detected === 'gzip') {
    const outFile = path.join(
      extractRoot,
      path.basename(ctx.inputNames[0] || 'file', '.gz').replace(/\.tar$/i, '') || 'decompressed',
    );
    try {
      await extractTarSafe(archivePath, extractRoot, true);
    } catch (error) {
      if ((error as { code?: string })?.code === 'BAD_REQUEST') throw error;
      fs.rmSync(extractRoot, { recursive: true, force: true });
      fs.mkdirSync(extractRoot, { recursive: true });
      const quota = new ExtractionQuota();
      await pipeline(
        createReadStream(archivePath),
        createGunzip(),
        extractionMeter(quota, path.basename(outFile)),
        createWriteStream(outFile),
      );
    }
    assertExtractTreeSafe(extractRoot);
  } else if (detected === 'bz2' || detected === 'xz' || detected === '7z') {
    const caps = detectCapabilities();
    if (!caps.binaries['7z']?.available) {
      throw unavailable(
        'archive.7z',
        `Cannot extract ${detected}: 7z binary not found. Run npm run setup:tools or install 7-Zip.`,
      );
    }
    const bin = caps.binaries['7z'].path || '7z';
    await extract7zSafe(bin, archivePath, extractRoot, ctx.jobId);
    assertExtractTreeSafe(extractRoot);
  } else {
    throw badRequest(`Unsupported extract format: ${detected}`);
  }

  const files = listFiles(extractRoot);
  // Optional: leave extracted tree in place for re-pack to another archive format
  if (ctx.options.leaveExtracted === true) {
    ctx.onProgress(100, 'Extracted to workdir');
    return {
      outputPath: extractRoot,
      outputName: 'extract-root',
      outputMime: 'inode/directory',
      meta: {
        files: files.length,
        format: detected,
        extractRoot,
        entries: files.map((f) => path.relative(extractRoot, f)),
      },
    };
  }

  // Re-pack extracted contents as ZIP for single download (safe listing)
  const outZip = path.join(ctx.outputDir, randomServerName('.zip'));
  await zipFiles(
    files,
    files.map((f) => path.relative(extractRoot, f)),
    outZip,
    (p) => ctx.onProgress(50 + p * 0.4),
  );
  ctx.onProgress(100, 'Extracted');
  return {
    outputPath: outZip,
    outputName: 'extracted.zip',
    outputMime: 'application/zip',
    meta: { files: files.length, format: detected },
  };
}

async function inspectArchive(ctx: ProcessContext): Promise<ProcessResult> {
  if (!ctx.inputPaths[0]) throw badRequest('Archive required');
  const p = ctx.inputPaths[0];
  const format = detectArchiveFormat(p);
  const listing: { name: string; size?: number }[] = [];

  if (format === 'zip') {
    // lightweight: extract to temp listing via extract-zip is heavy; use unzip list via reading central dir is complex
    // Use extract-zip to temp with dry approach: stage extract then list (size-limited)
    const tmp = path.join(ctx.workDir, 'inspect');
    fs.mkdirSync(tmp, { recursive: true });
    const quota = new ExtractionQuota();
    await extractZip(p, {
      dir: tmp,
      onEntry: (entry) => {
        assertSafeArchiveEntry(tmp, entry.fileName);
        quota.add(entry.fileName, Number(entry.uncompressedSize) || 0);
        listing.push({ name: entry.fileName, size: entry.uncompressedSize });
      },
    });
  } else if (format === 'tar') {
    const quota = new ExtractionQuota();
    await tar.t({
      file: p,
      onentry: (entry) => {
        const size = Number(entry.size) || 0;
        quota.add(entry.path, size);
        listing.push({ name: entry.path, size: size || undefined });
      },
    });
  } else {
    listing.push({ name: path.basename(p), size: fs.statSync(p).size });
  }

  const name = randomServerName('.json');
  const outputPath = path.join(ctx.outputDir, name);
  const meta = { format, entries: listing, count: listing.length };
  fs.writeFileSync(outputPath, JSON.stringify(meta, null, 2));
  ctx.onProgress(100, 'Inspected');
  return {
    outputPath,
    outputName: 'archive-listing.json',
    outputMime: 'application/json',
    meta,
  };
}

/** Detect format from magic bytes first, then extension */
export function detectArchiveFormat(filePath: string): string {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    // ZIP: PK
    if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
    // 7z: 37 7A BC AF 27 1C
    if (buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return '7z';
    // GZIP
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      const base = path.basename(filePath).toLowerCase();
      if (base.endsWith('.tgz') || base.endsWith('.tar.gz')) return 'tgz';
      return 'gz';
    }
    // XZ
    if (buf[0] === 0xfd && buf[1] === 0x37 && buf[2] === 0x7a) return 'xz';
    // BZip2
    if (buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68) return 'bz2';
    // USTAR tar at offset 257
    const tarBuf = Buffer.alloc(5);
    const fd2 = fs.openSync(filePath, 'r');
    fs.readSync(fd2, tarBuf, 0, 5, 257);
    fs.closeSync(fd2);
    if (tarBuf.toString('ascii') === 'ustar') return 'tar';
  } catch {
    /* fall through to extension */
  }
  return guessFormat(filePath);
}

function guessFormat(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base.endsWith('.tar.gz') || base.endsWith('.tgz')) return 'tgz';
  if (base.endsWith('.tar.bz2') || base.endsWith('.tbz2')) return 'bz2';
  if (base.endsWith('.tar.xz') || base.endsWith('.txz')) return 'xz';
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip') return 'zip';
  if (ext === '.tar') return 'tar';
  if (ext === '.gz') return 'gz';
  if (ext === '.tgz') return 'tgz';
  if (ext === '.bz2') return 'bz2';
  if (ext === '.xz') return 'xz';
  if (ext === '.7z') return '7z';
  return 'zip';
}

async function extractTarSafe(archivePath: string, extractRoot: string, gzip: boolean): Promise<void> {
  // Fail closed: reject any unsafe or link entry.
  // node-tar may not convert filter throws into promise rejections — use a flag.
  let rejectReason: string | null = null;
  const quota = new ExtractionQuota();
  await tar.x({
    file: archivePath,
    cwd: extractRoot,
    gzip,
    filter: (p, entry) => {
      if (rejectReason) return false;
      try {
        assertSafeArchiveEntry(extractRoot, p);
      } catch (e) {
        rejectReason = e instanceof Error ? e.message : `Unsafe tar entry rejected: ${p}`;
        return false;
      }
      const type = String((entry as { type?: string }).type || '');
      // node-tar: SymbolicLink / Link — never extract links
      if (type === 'SymbolicLink' || type === 'Link' || /SymbolicLink|HardLink/i.test(type)) {
        rejectReason = `Symlink/hardlink tar entry rejected: ${p}`;
        return false;
      }
      try {
        quota.add(p, Number((entry as { size?: number }).size) || 0);
      } catch (e) {
        rejectReason = e instanceof Error ? e.message : `Archive quota exceeded: ${p}`;
        return false;
      }
      return true;
    },
  });
  if (rejectReason) throw badRequest(rejectReason);
}

/**
 * List 7z entries, validate paths, then extract only after validation.
 */
export async function extract7zSafe(
  bin: string,
  archivePath: string,
  extractRoot: string,
  jobId?: string,
): Promise<void> {
  // 7z l -slt for technical listing
  let listing = '';
  try {
    const r = await execFileTracked(bin, ['l', '-slt', '-y', archivePath], {
      jobId,
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    listing = r.stdout + '\n' + r.stderr;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // some 7z still print listing on non-zero
    if ((e as { stdout?: string }).stdout) listing = String((e as { stdout?: string }).stdout);
    else throw badRequest(`7z list failed: ${msg}`);
  }

  const entries = parse7zEntries(listing);
  const quota = new ExtractionQuota();
  for (const entry of entries) {
    assertSafe7zEntry(entry.path);
    assertSafeArchiveEntry(extractRoot, entry.path);
    quota.add(entry.path, entry.size);
  }

  await execFileTracked(bin, ['x', `-o${extractRoot}`, '-y', '-snl', '-snh', archivePath], {
    jobId,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

/** Parse Path = lines from 7z -slt listing */
export function parse7zListPaths(listing: string): string[] {
  return parse7zEntries(listing).map((entry) => entry.path);
}

export function parse7zEntries(listing: string): Array<{ path: string; size: number }> {
  const entries: Array<{ path: string; size: number }> = [];
  let currentPath = '';
  let currentSize = 0;
  const flush = () => {
    if (currentPath) entries.push({ path: currentPath, size: currentSize });
    currentPath = '';
    currentSize = 0;
  };
  for (const line of listing.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const m = line.match(/^Path\s*=\s*(.+)$/i);
    if (m) {
      if (currentPath) flush();
      currentPath = m[1].trim();
    }
    const size = line.match(/^Size\s*=\s*(\d+)\s*$/i);
    if (size) {
      currentSize = Number(size[1]);
    }
    if (/^Symbolic Link\s*=\s*\+/i.test(line) || /^Hard Link\s*=\s*\+/i.test(line)) {
      throw badRequest('7z archive contains symlink/hardlink entries (rejected)');
    }
  }
  flush();
  // Drop first path if it looks like the archive container name only once
  return entries.filter(
    (entry, i) =>
      !(i === 0 && /\.(7z|zip|rar)$/i.test(entry.path) && !entry.path.includes('/') && !entry.path.includes('\\')),
  );
}

export function assertSafe7zEntry(entryName: string): void {
  const n = entryName.replace(/\\/g, '/');
  if (!n || n.includes('\0')) throw badRequest(`Unsafe 7z entry: ${entryName}`);
  if (path.isAbsolute(n) || /^[A-Za-z]:/.test(n) || n.startsWith('//') || n.startsWith('\\\\')) {
    throw badRequest(`Absolute/drive 7z entry rejected: ${entryName}`);
  }
  if (n.split('/').includes('..')) throw badRequest(`Path traversal 7z entry rejected: ${entryName}`);
}

/**
 * Realpath-check every extracted file remains under extractRoot; reject symlinks.
 */
export function assertExtractTreeSafe(extractRoot: string): void {
  const rootReal = fs.realpathSync(extractRoot);
  const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  const quota = new ExtractionQuota();

  function walk(dir: string): void {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) {
        throw badRequest(`Symlink rejected under extract tree: ${path.relative(extractRoot, full)}`);
      }
      // Also reject if lstat says link
      try {
        const st = fs.lstatSync(full);
        if (st.isSymbolicLink()) {
          throw badRequest(`Symlink rejected: ${path.relative(extractRoot, full)}`);
        }
      } catch (e) {
        if (e instanceof Error && /Symlink rejected/.test(e.message)) throw e;
      }
      let real: string;
      try {
        real = fs.realpathSync(full);
      } catch {
        throw badRequest(`Cannot resolve extracted path: ${path.relative(extractRoot, full)}`);
      }
      if (real !== rootReal && !real.startsWith(rootPrefix)) {
        throw badRequest(`Extracted path escaped job directory: ${path.relative(extractRoot, full)}`);
      }
      // safeJoin belt-and-suspenders
      safeJoin(extractRoot, path.relative(extractRoot, full));
      if (ent.isDirectory()) {
        quota.add(path.relative(extractRoot, full), 0);
        walk(full);
      } else {
        quota.add(path.relative(extractRoot, full), fs.statSync(full).size);
      }
    }
  }
  walk(extractRoot);
}

async function zipFiles(
  paths: string[],
  names: string[],
  outputPath: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const output = createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('error', reject);
  });
  archive.pipe(output);
  paths.forEach((p, i) => {
    const entryName = sanitizeEntry(names[i] || path.basename(p));
    archive.file(p, { name: entryName });
    onProgress?.(((i + 1) / paths.length) * 100);
  });
  await archive.finalize();
  await done;
}

function sanitizeEntry(name: string): string {
  return name.replace(/\\/g, '/').split('/').filter((s) => s && s !== '..').join('/') || 'file';
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function walkSafe(root: string, current: string): void {
  assertExtractTreeSafe(root);
  void current;
}
