import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from '../lib/magic.js';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { badRequest, unsupported } from '../lib/errors.js';
import { resolveTool } from '../tools/registry.js';
import {
  type DetectedKind,
  type Family,
  type OutputOption,
  type PublicEngineRoute,
  listOutputsFor,
  recommendedOutput,
  getToolsSnapshot,
} from './matrix.js';

const execFileAsync = promisify(execFile);

/** Bytes typically sufficient for file-type magic + PDF/WAV headers */
export const MAGIC_HEAD_BYTES = 4100;

const EXT_FAMILY: Record<string, { family: Family; format: string }> = {
  '.png': { family: 'image', format: 'png' },
  '.jpg': { family: 'image', format: 'jpeg' },
  '.jpeg': { family: 'image', format: 'jpeg' },
  '.webp': { family: 'image', format: 'webp' },
  '.avif': { family: 'image', format: 'avif' },
  '.gif': { family: 'image', format: 'gif' },
  '.tif': { family: 'image', format: 'tiff' },
  '.tiff': { family: 'image', format: 'tiff' },
  '.bmp': { family: 'image', format: 'bmp' },
  '.ico': { family: 'image', format: 'ico' },
  '.svg': { family: 'image', format: 'svg' },
  '.heic': { family: 'image', format: 'heic' },
  '.heif': { family: 'image', format: 'heif' },
  '.mp3': { family: 'audio', format: 'mp3' },
  '.wav': { family: 'audio', format: 'wav' },
  '.flac': { family: 'audio', format: 'flac' },
  '.aac': { family: 'audio', format: 'aac' },
  '.m4a': { family: 'audio', format: 'm4a' },
  '.ogg': { family: 'audio', format: 'ogg' },
  '.opus': { family: 'audio', format: 'opus' },
  '.wma': { family: 'audio', format: 'wma' },
  '.mp4': { family: 'video', format: 'mp4' },
  '.mkv': { family: 'video', format: 'mkv' },
  '.webm': { family: 'video', format: 'webm' },
  '.mov': { family: 'video', format: 'mov' },
  '.avi': { family: 'video', format: 'avi' },
  '.mpeg': { family: 'video', format: 'mpeg' },
  '.mpg': { family: 'video', format: 'mpg' },
  '.wmv': { family: 'video', format: 'wmv' },
  '.m4v': { family: 'video', format: 'm4v' },
  '.flv': { family: 'video', format: 'flv' },
  '.pdf': { family: 'pdf', format: 'pdf' },
  '.doc': { family: 'document', format: 'doc' },
  '.docx': { family: 'document', format: 'docx' },
  '.odt': { family: 'document', format: 'odt' },
  '.rtf': { family: 'document', format: 'rtf' },
  '.xls': { family: 'spreadsheet', format: 'xls' },
  '.xlsx': { family: 'spreadsheet', format: 'xlsx' },
  '.ods': { family: 'spreadsheet', format: 'ods' },
  '.csv': { family: 'spreadsheet', format: 'csv' },
  '.tsv': { family: 'spreadsheet', format: 'tsv' },
  '.ppt': { family: 'presentation', format: 'ppt' },
  '.pptx': { family: 'presentation', format: 'pptx' },
  '.odp': { family: 'presentation', format: 'odp' },
  '.zip': { family: 'archive', format: 'zip' },
  '.tar': { family: 'archive', format: 'tar' },
  '.gz': { family: 'archive', format: 'gz' },
  '.tgz': { family: 'archive', format: 'tgz' },
  '.bz2': { family: 'archive', format: 'bz2' },
  '.xz': { family: 'archive', format: 'xz' },
  '.7z': { family: 'archive', format: '7z' },
  '.txt': { family: 'text', format: 'txt' },
  '.md': { family: 'text', format: 'md' },
  '.html': { family: 'text', format: 'html' },
  '.htm': { family: 'text', format: 'html' },
  '.rst': { family: 'text', format: 'rst' },
  '.adoc': { family: 'text', format: 'asciidoc' },
  '.asciidoc': { family: 'text', format: 'asciidoc' },
  '.epub': { family: 'ebook', format: 'epub' },
  '.mobi': { family: 'ebook', format: 'mobi' },
  '.azw': { family: 'ebook', format: 'azw3' },
  '.azw3': { family: 'ebook', format: 'azw3' },
  '.fb2': { family: 'ebook', format: 'fb2' },
  '.htmlz': { family: 'ebook', format: 'htmlz' },
  '.json': { family: 'text', format: 'json' },
};

const MIME_TO_FORMAT: Record<string, { family: Family; format: string }> = {
  'image/png': { family: 'image', format: 'png' },
  'image/jpeg': { family: 'image', format: 'jpeg' },
  'image/webp': { family: 'image', format: 'webp' },
  'image/avif': { family: 'image', format: 'avif' },
  'image/gif': { family: 'image', format: 'gif' },
  'image/tiff': { family: 'image', format: 'tiff' },
  'image/bmp': { family: 'image', format: 'bmp' },
  'image/x-icon': { family: 'image', format: 'ico' },
  'image/vnd.microsoft.icon': { family: 'image', format: 'ico' },
  'image/heic': { family: 'image', format: 'heic' },
  'image/heif': { family: 'image', format: 'heif' },
  'audio/mpeg': { family: 'audio', format: 'mp3' },
  'audio/wav': { family: 'audio', format: 'wav' },
  'audio/x-wav': { family: 'audio', format: 'wav' },
  'audio/flac': { family: 'audio', format: 'flac' },
  'audio/aac': { family: 'audio', format: 'aac' },
  'audio/mp4': { family: 'audio', format: 'm4a' },
  'audio/ogg': { family: 'audio', format: 'ogg' },
  'audio/opus': { family: 'audio', format: 'opus' },
  'audio/vnd.wave': { family: 'audio', format: 'wav' },
  'video/mp4': { family: 'video', format: 'mp4' },
  'video/webm': { family: 'video', format: 'webm' },
  'video/x-matroska': { family: 'video', format: 'mkv' },
  'video/quicktime': { family: 'video', format: 'mov' },
  'video/x-msvideo': { family: 'video', format: 'avi' },
  'application/pdf': { family: 'pdf', format: 'pdf' },
  'application/zip': { family: 'archive', format: 'zip' },
  'application/x-tar': { family: 'archive', format: 'tar' },
  'application/gzip': { family: 'archive', format: 'gz' },
  'application/x-7z-compressed': { family: 'archive', format: '7z' },
  'application/epub+zip': { family: 'ebook', format: 'epub' },
  'application/x-mobipocket-ebook': { family: 'ebook', format: 'mobi' },
  'application/vnd.amazon.ebook': { family: 'ebook', format: 'azw3' },
  'application/x-fictionbook+xml': { family: 'ebook', format: 'fb2' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    family: 'document',
    format: 'docx',
  },
  'application/msword': { family: 'document', format: 'doc' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    family: 'spreadsheet',
    format: 'xlsx',
  },
  'application/vnd.ms-excel': { family: 'spreadsheet', format: 'xls' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    family: 'presentation',
    format: 'pptx',
  },
  'application/vnd.ms-powerpoint': { family: 'presentation', format: 'ppt' },
  'application/vnd.oasis.opendocument.text': { family: 'document', format: 'odt' },
  'application/vnd.oasis.opendocument.spreadsheet': { family: 'spreadsheet', format: 'ods' },
  'application/vnd.oasis.opendocument.presentation': { family: 'presentation', format: 'odp' },
  'text/plain': { family: 'text', format: 'txt' },
  'text/markdown': { family: 'text', format: 'md' },
  'text/html': { family: 'text', format: 'html' },
  'text/x-rst': { family: 'text', format: 'rst' },
  'text/asciidoc': { family: 'text', format: 'asciidoc' },
  'text/csv': { family: 'spreadsheet', format: 'csv' },
};

const TEXT_LIKE = new Set([
  '.txt',
  '.md',
  '.html',
  '.htm',
  '.rst',
  '.adoc',
  '.asciidoc',
  '.fb2',
  '.csv',
  '.tsv',
  '.json',
  '.svg',
  '.rtf',
]);

export type DetectDepth = 'quick' | 'deep';

export type InspectResult = {
  originalName: string;
  size: number;
  ext: string;
  mime: string;
  detectedMime: string | null;
  family: Family;
  format: string;
  match: boolean | null;
  /** Lightweight for quick; full probe/sharp/pdf for deep */
  meta: Record<string, unknown>;
  outputs: OutputOption[];
  recommendedOutput: string | null;
  preferredEngine?: PublicEngineRoute;
  tools: Record<string, { available: boolean; version?: string; profile?: string }>;
  /** Detection depth used to produce this result */
  depth?: DetectDepth;
  /** Content checksum when known (cache key) */
  checksum?: string;
};

export type DetectOptions = {
  /** Precomputed SHA-256 hex; used as cache key when provided */
  checksum?: string;
  /** Reuse a prior InspectResult (e.g. parsed from files.detect_json) */
  reuseDetect?: InspectResult | Partial<InspectResult> | null;
  /** When true, skip memory cache read (still writes) */
  bypassCache?: boolean;
};

// ─── head / magic helpers ───────────────────────────────────────────────────

/**
 * Read only the first `nBytes` of a file (for magic / MIME sniffing).
 * Does not load the full file into memory.
 */
export function readFileHead(filePath: string, nBytes: number = MAGIC_HEAD_BYTES): Buffer {
  if (!fs.existsSync(filePath)) throw badRequest('File not found');
  const stat = fs.statSync(filePath);
  const len = Math.min(Math.max(0, nBytes), stat.size);
  const buf = Buffer.alloc(len);
  if (len === 0) return buf;
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, len, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

/** Hex preview of magic head (first 16 bytes) for debug / lightweight meta */
export function magicHeadHex(head: Buffer, bytes = 16): string {
  return head.subarray(0, Math.min(bytes, head.length)).toString('hex');
}

/** Full-file hash without loading entire file into one Buffer (for cache keys). */
export function checksumFilePath(filePath: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const chunk = Buffer.alloc(Math.min(1024 * 1024, Math.max(size, 1)));
    let offset = 0;
    while (offset < size) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), offset);
      if (n <= 0) break;
      hash.update(chunk.subarray(0, n));
      offset += n;
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// ─── in-memory detect cache (by checksum) ───────────────────────────────────

type CacheEntry = {
  quick?: InspectResult;
  deep?: InspectResult;
  at: number;
};

const detectCache = new Map<string, CacheEntry>();
const DETECT_CACHE_MAX = 256;

function cacheGet(checksum: string | undefined): CacheEntry | undefined {
  if (!checksum) return undefined;
  return detectCache.get(checksum);
}

function cachePut(checksum: string | undefined, depth: DetectDepth, result: InspectResult): void {
  if (!checksum) return;
  const prev = detectCache.get(checksum) || { at: Date.now() };
  const next: CacheEntry = {
    ...prev,
    at: Date.now(),
    [depth]: { ...result, checksum, depth },
  };
  // LRU-ish: drop oldest when oversized
  if (detectCache.size >= DETECT_CACHE_MAX && !detectCache.has(checksum)) {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [k, v] of detectCache) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) detectCache.delete(oldestKey);
  }
  detectCache.set(checksum, next);
}

/** Test / admin helper */
export function clearDetectCache(): void {
  detectCache.clear();
}

export function getDetectCacheStats(): { size: number; keys: string[] } {
  return { size: detectCache.size, keys: [...detectCache.keys()] };
}

type DbGetter = () => {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => { detect_json: string | null } | undefined;
  };
};

let dbGetter: DbGetter | null | undefined;

async function loadDbGetter(): Promise<DbGetter | null> {
  if (dbGetter !== undefined) return dbGetter;
  try {
    const mod = await import('../db/index.js');
    dbGetter = mod.getDb as DbGetter;
  } catch {
    dbGetter = null;
  }
  return dbGetter;
}

/**
 * Optional DB reuse: look up a prior detect_json for the same checksum.
 * Soft-fails if DB is unavailable or no row found.
 */
async function tryReuseFromDb(checksum: string): Promise<InspectResult | null> {
  try {
    const getDb = await loadDbGetter();
    if (!getDb) return null;
    const row = getDb()
      .prepare(
        `SELECT detect_json FROM files WHERE checksum = ? AND detect_json IS NOT NULL AND status != 'deleted' LIMIT 1`,
      )
      .get(checksum) as { detect_json: string | null } | undefined;
    if (!row?.detect_json) return null;
    const parsed = JSON.parse(row.detect_json) as InspectResult;
    if (parsed && typeof parsed === 'object' && parsed.family && parsed.format) {
      return parsed;
    }
  } catch {
    /* db not ready or no match */
  }
  return null;
}

function isDeepResult(ins: InspectResult | Partial<InspectResult> | null | undefined): boolean {
  if (!ins || typeof ins !== 'object') return false;
  if (ins.depth === 'deep') return true;
  if (ins.depth === 'quick') return false;
  const meta = ins.meta || {};
  // Heuristic: deep collectors set these keys
  return (
    meta.depth === 'deep' ||
    typeof meta.width === 'number' ||
    typeof meta.pages === 'number' ||
    typeof meta.duration !== 'undefined' ||
    typeof meta.streams !== 'undefined' ||
    meta.imageError !== undefined ||
    meta.pagesError !== undefined ||
    meta.probeError !== undefined
  );
}

function toolsPublic(
  tools: ReturnType<typeof getToolsSnapshot>,
): Record<string, { available: boolean; version?: string; profile?: string }> {
  return Object.fromEntries(
    Object.entries(tools).map(([k, v]) => [
      k,
      { available: v.available, version: v.version, profile: profileForTool(k) },
    ]),
  );
}

function withOutputs(
  base: Omit<InspectResult, 'outputs' | 'recommendedOutput' | 'preferredEngine' | 'tools'>,
): InspectResult {
  const tools = getToolsSnapshot();
  const kind: DetectedKind = {
    family: base.family,
    format: base.format,
    ext: base.ext,
    mime: base.mime,
  };
  const outputs = listOutputsFor(kind, tools);
  const recommended = recommendedOutput(kind, outputs);
  return {
    ...base,
    outputs,
    recommendedOutput: recommended,
    preferredEngine: outputs.find((output) => output.format === recommended)?.engine,
    tools: toolsPublic(tools),
  };
}

function profileForTool(tool: string): string {
  if (['ffmpeg', 'ffprobe'].includes(tool)) return 'media';
  if (['libreoffice', 'pandoc'].includes(tool)) return 'documents';
  if (tool === 'calibre') return 'ebooks';
  return 'core';
}

// ─── public detect API ──────────────────────────────────────────────────────

/**
 * Quick detection: extension + MIME from first bytes + magic checks.
 * Lists outputs/recommended without ffprobe, full PDF load, or sharp metadata.
 */
export async function detectFileQuick(
  filePath: string,
  originalName: string,
  opts: DetectOptions = {},
): Promise<InspectResult> {
  const checksum = opts.checksum;
  if (!opts.bypassCache && checksum) {
    const hit = cacheGet(checksum);
    if (hit?.deep) return { ...hit.deep, depth: 'deep', checksum };
    if (hit?.quick) return { ...hit.quick, depth: 'quick', checksum };
  }

  // Optional reuse from caller (DB detect_json) or same-checksum DB row
  const reuse = opts.reuseDetect || (checksum ? await tryReuseFromDb(checksum) : null);
  if (reuse && reuse.family && reuse.format && !opts.bypassCache) {
    const restored = withOutputs({
      originalName: originalName || String(reuse.originalName || ''),
      size: typeof reuse.size === 'number' ? reuse.size : fs.statSync(filePath).size,
      ext: String(reuse.ext || path.extname(originalName).toLowerCase()),
      mime: String(reuse.mime || 'application/octet-stream'),
      detectedMime: reuse.detectedMime ?? null,
      family: reuse.family as Family,
      format: String(reuse.format),
      match: (reuse.match as boolean | null) ?? null,
      meta: { ...(reuse.meta || {}), depth: isDeepResult(reuse) ? 'deep' : 'quick' },
      depth: isDeepResult(reuse) ? 'deep' : 'quick',
      checksum,
    });
    cachePut(checksum, restored.depth === 'deep' ? 'deep' : 'quick', restored);
    return restored;
  }

  const classified = await classifyQuick(filePath, originalName);
  const result = withOutputs({
    ...classified,
    depth: 'quick',
    checksum,
  });
  cachePut(checksum, 'quick', result);
  return result;
}

/**
 * Deep detection: quick classify + full meta (ffprobe / sharp / PDF page count).
 * Reuses quick cache entry when present.
 */
export async function detectFileDeep(
  filePath: string,
  originalName: string,
  opts: DetectOptions = {},
): Promise<InspectResult> {
  return detectFile(filePath, originalName, opts);
}

/**
 * Full inspect (backward-compatible). Uses quick classification when possible,
 * then collects expensive metadata.
 */
export async function detectFile(
  filePath: string,
  originalName: string,
  opts: DetectOptions = {},
): Promise<InspectResult> {
  let checksum = opts.checksum;

  if (!opts.bypassCache && checksum) {
    const hit = cacheGet(checksum);
    if (hit?.deep) return { ...hit.deep, depth: 'deep', checksum };
  }

  // Reuse deep result from DB / caller
  const reuse = opts.reuseDetect || (checksum ? await tryReuseFromDb(checksum) : null);
  if (reuse && isDeepResult(reuse) && !opts.bypassCache) {
    const restored = withOutputs({
      originalName: originalName || String(reuse.originalName || ''),
      size: typeof reuse.size === 'number' ? reuse.size : fs.statSync(filePath).size,
      ext: String(reuse.ext || path.extname(originalName).toLowerCase()),
      mime: String(reuse.mime || 'application/octet-stream'),
      detectedMime: reuse.detectedMime ?? null,
      family: reuse.family as Family,
      format: String(reuse.format),
      match: (reuse.match as boolean | null) ?? null,
      meta: { ...(reuse.meta || {}), depth: 'deep' },
      depth: 'deep',
      checksum,
    });
    cachePut(checksum, 'deep', restored);
    return restored;
  }

  // Prefer quick result (memory / just-computed) for classification
  let quick: InspectResult;
  if (!opts.bypassCache && checksum) {
    const hit = cacheGet(checksum);
    if (hit?.quick) {
      quick = hit.quick;
    } else if (reuse && reuse.family && reuse.format) {
      quick = withOutputs({
        originalName: originalName || String(reuse.originalName || ''),
        size: typeof reuse.size === 'number' ? reuse.size : fs.statSync(filePath).size,
        ext: String(reuse.ext || path.extname(originalName).toLowerCase()),
        mime: String(reuse.mime || 'application/octet-stream'),
        detectedMime: reuse.detectedMime ?? null,
        family: reuse.family as Family,
        format: String(reuse.format),
        match: (reuse.match as boolean | null) ?? null,
        meta: { ...(reuse.meta || {}), depth: 'quick' },
        depth: 'quick',
        checksum,
      });
    } else {
      quick = await detectFileQuick(filePath, originalName, { ...opts, checksum });
    }
  } else {
    quick = await detectFileQuick(filePath, originalName, opts);
    checksum = quick.checksum || checksum;
  }

  const kind: DetectedKind = {
    family: quick.family,
    format: quick.format,
    ext: quick.ext,
    mime: quick.mime,
  };
  const meta = await collectMeta(filePath, kind);
  meta.depth = 'deep';
  // Preserve lightweight magic head from quick if present
  if (quick.meta?.magicHead && !meta.magicHead) meta.magicHead = quick.meta.magicHead;

  const deepKind: DetectedKind = {
    ...kind,
    codecs: codecsFromMeta(meta),
  };
  const deep: InspectResult = {
    ...quick,
    meta,
    depth: 'deep',
    checksum,
    // refresh tools/outputs (cached snapshot)
    ...(() => {
      const tools = getToolsSnapshot();
      const outputs = listOutputsFor(deepKind, tools);
      const recommended = recommendedOutput(deepKind, outputs);
      return {
        outputs,
        recommendedOutput: recommended,
        preferredEngine: outputs.find((output) => output.format === recommended)?.engine,
        tools: toolsPublic(tools),
      };
    })(),
  };

  cachePut(checksum, 'deep', deep);
  // also keep quick side populated
  if (checksum && !cacheGet(checksum)?.quick) {
    cachePut(checksum, 'quick', { ...quick, depth: 'quick', checksum });
  }
  return deep;
}

// ─── classification (quick path only) ───────────────────────────────────────

async function classifyQuick(
  filePath: string,
  originalName: string,
): Promise<Omit<InspectResult, 'outputs' | 'recommendedOutput' | 'tools' | 'depth' | 'checksum'>> {
  if (!fs.existsSync(filePath)) throw badRequest('File not found');
  const stat = fs.statSync(filePath);
  if (stat.size === 0) throw badRequest('Empty file rejected');

  const ext = path.extname(originalName).toLowerCase() || path.extname(filePath).toLowerCase();
  const head = readFileHead(filePath, MAGIC_HEAD_BYTES);

  let detectedMime: string | null = null;
  let detectedExt: string | null = null;
  try {
    const ft = await fileTypeFromBuffer(head);
    detectedMime = ft?.mime || null;
    detectedExt = ft?.ext ? `.${ft.ext}` : null;
  } catch {
    detectedMime = null;
  }

  const kind = classify(ext, detectedMime, detectedExt, head, originalName, filePath);
  if (kind.family === 'unknown') {
    throw unsupported(`Unsupported or unrecognized file type (${ext || 'no extension'})`);
  }

  const match = computeMatch(ext, detectedMime, detectedExt, kind, originalName);
  if (match === false && ['image', 'audio', 'video', 'pdf', 'archive'].includes(kind.family)) {
    throw unsupported(
      `File content does not match extension ${ext || '(none)'} (detected ${detectedMime || detectedExt || 'unknown'})`,
      { ext, detectedMime, detectedExt },
    );
  }

  // PDF magic from head only
  if (kind.format === 'pdf') {
    if (head.length < 5 || head.subarray(0, 5).toString('utf8') !== '%PDF-') {
      throw unsupported('Corrupted or invalid PDF (bad magic bytes)');
    }
  }

  return {
    originalName,
    size: stat.size,
    ext,
    mime: detectedMime || mimeFromKind(kind),
    detectedMime,
    family: kind.family,
    format: kind.format,
    match,
    meta: {
      size: stat.size,
      family: kind.family,
      format: kind.format,
      magicHead: magicHeadHex(head),
      depth: 'quick',
    },
  };
}

function mimeFromKind(kind: DetectedKind): string {
  for (const [mime, v] of Object.entries(MIME_TO_FORMAT)) {
    if (v.format === kind.format) return mime;
  }
  return 'application/octet-stream';
}

function classify(
  ext: string,
  detectedMime: string | null,
  detectedExt: string | null,
  head: Buffer,
  originalName: string,
  filePath: string,
): DetectedKind {
  const nameLower = (originalName || path.basename(filePath)).toLowerCase();

  // Prefer magic when available
  if (detectedMime && MIME_TO_FORMAT[detectedMime]) {
    const m = MIME_TO_FORMAT[detectedMime];
    // OOXML stored as zip
    if (
      detectedMime === 'application/zip' &&
      ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.epub', '.htmlz'].includes(ext)
    ) {
      const byExt = EXT_FAMILY[ext];
      if (byExt) return { family: byExt.family, format: byExt.format, ext, mime: detectedMime };
    }
    // gzip magic + .tgz / .tar.gz extension → tgz (not plain gz)
    if (
      (detectedMime === 'application/gzip' || detectedMime === 'application/x-gzip') &&
      (ext === '.tgz' || nameLower.endsWith('.tgz') || nameLower.endsWith('.tar.gz'))
    ) {
      return {
        family: 'archive',
        format: 'tgz',
        ext: ext === '.gz' ? '.tgz' : ext || '.tgz',
        mime: detectedMime,
      };
    }
    return { family: m.family, format: m.format, ext: detectedExt || ext, mime: detectedMime };
  }

  if (ext && EXT_FAMILY[ext]) {
    const byExt = EXT_FAMILY[ext];
    // text-like without magic
    if (TEXT_LIKE.has(ext) || !detectedMime) {
      if (TEXT_LIKE.has(ext)) {
        // reject binary as text — use head only
        const sample = head.subarray(0, Math.min(512, head.length));
        if (sample.includes(0) && ext !== '.svg') {
          throw unsupported('File content does not match text extension');
        }
      }
      return {
        family: byExt.family,
        format: byExt.format,
        ext,
        mime: detectedMime || 'application/octet-stream',
      };
    }
    return {
      family: byExt.family,
      format: byExt.format,
      ext,
      mime: detectedMime || 'application/octet-stream',
    };
  }

  if (detectedExt && EXT_FAMILY[detectedExt]) {
    const by = EXT_FAMILY[detectedExt];
    return {
      family: by.family,
      format: by.format,
      ext: detectedExt,
      mime: detectedMime || 'application/octet-stream',
    };
  }

  return {
    family: 'unknown',
    format: 'unknown',
    ext,
    mime: detectedMime || 'application/octet-stream',
  };
}

function computeMatch(
  ext: string,
  detectedMime: string | null,
  detectedExt: string | null,
  kind: DetectedKind,
  originalName?: string,
): boolean | null {
  if (!detectedMime && !detectedExt) {
    if (TEXT_LIKE.has(ext)) return true;
    if (
      [
        '.doc',
        '.docx',
        '.xls',
        '.xlsx',
        '.ppt',
        '.pptx',
        '.odt',
        '.ods',
        '.odp',
        '.rtf',
        '.epub',
        '.mobi',
        '.azw',
        '.azw3',
        '.htmlz',
      ].includes(ext)
    ) {
      return null; // often no simple magic
    }
    return null;
  }
  // gzip payload is expected for .tgz / .gz / .tar.gz
  if (
    (detectedMime === 'application/gzip' ||
      detectedMime === 'application/x-gzip' ||
      detectedExt === '.gz') &&
    (ext === '.tgz' || ext === '.gz' || (originalName || '').toLowerCase().endsWith('.tar.gz'))
  ) {
    return true;
  }
  if (detectedExt) {
    const det = detectedExt.toLowerCase();
    const aliases: Record<string, string[]> = {
      '.jpg': ['.jpg', '.jpeg'],
      '.jpeg': ['.jpg', '.jpeg'],
      '.tif': ['.tif', '.tiff'],
      '.tiff': ['.tif', '.tiff'],
      '.tgz': ['.tgz', '.gz'],
      '.gz': ['.gz', '.tgz'],
    };
    const allowed = aliases[ext] || [ext];
    // zip container for office
    if (
      det === '.zip' &&
      ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.epub', '.htmlz', '.zip'].includes(ext)
    ) {
      return true;
    }
    if (allowed.includes(det)) return true;
    if (ext && det && ext !== det) {
      // format from magic vs ext family
      const extKind = EXT_FAMILY[ext];
      if (extKind && extKind.format === kind.format) return true;
      // same archive family (gz/tgz/tar containers)
      if (extKind && extKind.family === kind.family && kind.family === 'archive') return true;
      if (extKind && extKind.family !== kind.family) return false;
      return false;
    }
  }
  return true;
}

async function collectMeta(filePath: string, kind: DetectedKind): Promise<Record<string, unknown>> {
  const meta: Record<string, unknown> = {
    size: fs.statSync(filePath).size,
    family: kind.family,
    format: kind.format,
  };

  if (kind.family === 'image' && kind.format !== 'svg') {
    try {
      const img = await sharp(filePath).metadata();
      meta.width = img.width;
      meta.height = img.height;
      meta.space = img.space;
      meta.hasAlpha = img.hasAlpha;
      meta.density = img.density;
    } catch {
      meta.imageError = 'Unable to read image metadata';
    }
  }

  if (kind.family === 'audio' || kind.family === 'video') {
    const ffprobe = resolveTool('ffprobe');
    if (ffprobe.available) {
      try {
        const { stdout } = await execFileAsync(
          ffprobe.path,
          ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
          { timeout: 30_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
        );
        const data = JSON.parse(stdout);
        meta.duration = data.format?.duration ? Number(data.format.duration) : undefined;
        meta.bitRate = data.format?.bit_rate;
        meta.formatName = data.format?.format_name;
        meta.streams = (data.streams || []).map(
          (s: { codec_type?: string; codec_name?: string; width?: number; height?: number }) => ({
            type: s.codec_type,
            codec: s.codec_name,
            width: s.width,
            height: s.height,
          }),
        );
        const video = (data.streams || []).find(
          (s: { codec_type?: string }) => s.codec_type === 'video',
        );
        if (video) {
          meta.width = video.width;
          meta.height = video.height;
          meta.codec = video.codec_name;
        }
        const audio = (data.streams || []).find(
          (s: { codec_type?: string }) => s.codec_type === 'audio',
        );
        if (audio) meta.audioCodec = audio.codec_name;
      } catch {
        meta.probeError = 'ffprobe failed';
      }
    }
  }

  if (kind.format === 'pdf') {
    try {
      const { validatePdfInput } = await import('./pdfInspect.js');
      const ins = await validatePdfInput(filePath, { allowEncrypted: true });
      meta.pages = ins.pageCount;
      meta.encrypted = ins.encrypted;
      meta.scannedLikely = ins.scannedLikely;
      meta.textCharCount = ins.textCharCount;
      meta.pageSize = ins.pageSize;
      meta.pdfMetadata = ins.metadata;
      meta.checksum = ins.checksum;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unable to inspect PDF';
      meta.pagesError = msg;
      // Fallback page count only
      try {
        const { PDFDocument } = await import('pdf-lib');
        const bytes = fs.readFileSync(filePath);
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        meta.pages = doc.getPageCount();
      } catch {
        /* ignore */
      }
    }
  }

  return meta;
}

export function kindFromInspect(ins: InspectResult): DetectedKind {
  return {
    family: ins.family,
    format: ins.format,
    ext: ins.ext,
    mime: ins.mime,
    codecs: codecsFromMeta(ins.meta),
  };
}

function codecsFromMeta(meta: Record<string, unknown> | undefined): string[] | undefined {
  const streams = meta?.streams;
  if (!Array.isArray(streams)) return undefined;
  const codecs = streams
    .map((stream) =>
      stream && typeof stream === 'object' && 'codec' in stream
        ? String((stream as { codec?: unknown }).codec || '').toLowerCase()
        : '',
    )
    .filter(Boolean);
  return codecs.length ? [...new Set(codecs)] : undefined;
}
