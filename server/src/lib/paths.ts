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
  const normalizedRoot = path.resolve(root) + path.sep;
  const resolved = path.resolve(target);
  if (resolved !== path.resolve(root) && !resolved.startsWith(normalizedRoot)) {
    throw badRequest('Path traversal rejected');
  }
}
