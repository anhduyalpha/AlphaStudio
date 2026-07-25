import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { badRequest } from './errors.js';

export function ensureDataDirs(): void {
  for (const dir of [config.dataDir, config.uploadsDir, config.outputsDir, config.tempDir, config.uploadSessionsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function randomServerName(ext = ''): string {
  const id = randomBytes(16).toString('hex');
  const cleanExt = ext && ext.startsWith('.') ? ext : ext ? `.${ext}` : '';
  return `${id}${cleanExt}`;
}

/** Resolve a path under a root; reject traversal. */
export function safeJoin(root: string, ...segments: string[]): string {
  const joined = path.resolve(root, ...segments);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (joined !== path.resolve(root) && !joined.startsWith(normalizedRoot)) {
    throw badRequest('Path traversal rejected');
  }
  return joined;
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()[\]]+/g, '_');
  if (!base || base === '.' || base === '..') return 'file';
  return base.slice(0, 180);
}

export function assertInsideRoot(root: string, target: string): void {
  if (!isPathInside(root, target)) {
    throw badRequest('Path traversal rejected');
  }
}

/** True when `candidate` resolves to `root` or a path strictly under it. */
export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Runtime re-confinement for download/preview streams.
 * Paths must live under uploads, outputs, or temp (all under DATA_DIR layout).
 * Rejects poisoned DB paths that escape data roots (S-01).
 */
export function assertDownloadablePath(target: string): void {
  const roots = [config.uploadsDir, config.outputsDir, config.tempDir];
  if (roots.some((root) => isPathInside(root, target))) return;
  throw badRequest('Path traversal rejected');
}

/** Active content that must not be inlined on the app origin (S-02). */
const ACTIVE_PREVIEW_EXTS = new Set(['.html', '.htm', '.svg', '.xhtml', '.xml']);
const ACTIVE_PREVIEW_MIMES = new Set([
  'text/html',
  'image/svg+xml',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
]);

export function isActivePreviewContent(filename: string, mime?: string | null): boolean {
  const ext = path.extname(filename || '').toLowerCase();
  if (ACTIVE_PREVIEW_EXTS.has(ext)) return true;
  const m = String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return ACTIVE_PREVIEW_MIMES.has(m);
}
