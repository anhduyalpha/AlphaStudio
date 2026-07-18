/**
 * Safe path validation and deletion for maintenance scripts.
 * Never deletes outside project root.
 * Used by clear/clean and by tools installers when removing broken portable trees.
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, toolsRoot } from './platform.mjs';

/**
 * Resolve to absolute path and ensure it stays under root.
 * @param {string} target
 * @param {string} [root]
 * @returns {string} absolute resolved path
 * @throws if outside root or invalid
 */
export function assertUnderRoot(target, root = projectRoot) {
  if (target == null || target === '') {
    throw new Error('Empty path rejected');
  }
  // Treat both slash styles as separators on every host. A Windows traversal
  // string must remain dangerous when maintenance checks run on Linux/macOS.
  const normalizedTarget = String(target).replace(/[\\/]+/g, path.sep);
  if (process.platform !== 'win32' && /^[a-zA-Z]:/.test(normalizedTarget)) {
    throw new Error(`Refusing Windows absolute path: ${target}`);
  }
  const absRoot = path.resolve(root);
  const resolved = path.resolve(absRoot, normalizedTarget);
  const rootWithSep = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
  if (resolved !== absRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Refusing path outside project root: ${target}`);
  }
  // Block obvious traversal after resolve (defense in depth)
  if (target.includes('..') && !resolved.startsWith(rootWithSep) && resolved !== absRoot) {
    throw new Error(`Path traversal rejected: ${target}`);
  }
  return resolved;
}

/**
 * True if candidate is the root itself or a descendant.
 */
export function isUnderRoot(candidate, root = projectRoot) {
  try {
    assertUnderRoot(candidate, root);
    return true;
  } catch {
    return false;
  }
}

/**
 * Protected path segments that clear/clean must never remove.
 * Matched against relative path from root (posix-style).
 */
export const PROTECTED_REL_PREFIXES = [
  'src',
  'server/src',
  'server/tests',
  'public',
  'scripts',
  'fixtures',
  'mcps',
  'node_modules',
  'server/node_modules',
  '.git',
];

export const PROTECTED_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'server/package.json',
  'server/package-lock.json',
  'tsconfig.json',
  'server/tsconfig.json',
  'vite.config.js',
  'index.html',
  'README.md',
  'REGISTRY_FIX.md',
  'RUNTIME_VALIDATION.md',
  'V3_CHANGELOG.md',
  '.gitignore',
  '.env.example',
  '.env', // user config — never delete
]);

/**
 * Relative posix path from root for comparisons.
 */
export function toRelPosix(absPath, root = projectRoot) {
  const rel = path.relative(path.resolve(root), path.resolve(absPath));
  return rel.split(path.sep).join('/');
}

/**
 * True if absPath is protected (source, config, lockfiles, etc.).
 */
export function isProtectedPath(absPath, root = projectRoot) {
  const absRoot = path.resolve(root);
  const resolved = path.resolve(absPath);
  if (resolved === absRoot) return true;
  const rel = toRelPosix(resolved, root);
  if (!rel || rel.startsWith('..')) return true;
  if (PROTECTED_BASENAMES.has(rel)) return true;
  for (const prefix of PROTECTED_REL_PREFIXES) {
    if (rel === prefix || rel.startsWith(prefix + '/')) return true;
  }
  return false;
}

/**
 * Safely remove a file or directory after validating under root and not protected.
 * @returns {{ ok: boolean, path: string, error?: string, skipped?: string }}
 */
export function safeRemove(target, { root = projectRoot, dryRun = false, allowProtected = false } = {}) {
  let abs;
  try {
    abs = assertUnderRoot(target, root);
  } catch (e) {
    return { ok: false, path: String(target), error: e.message };
  }
  if (!allowProtected && isProtectedPath(abs, root)) {
    return { ok: false, path: abs, skipped: 'protected path' };
  }
  if (abs === path.resolve(root)) {
    return { ok: false, path: abs, error: 'refusing to delete project root' };
  }
  if (!fs.existsSync(abs)) {
    return { ok: true, path: abs, skipped: 'already absent' };
  }
  if (dryRun) {
    return { ok: true, path: abs, skipped: 'dry-run' };
  }
  try {
    fs.rmSync(abs, { recursive: true, force: true, maxRetries: 3 });
    return { ok: true, path: abs };
  } catch (e) {
    return { ok: false, path: abs, error: e.message };
  }
}

/**
 * Safe removal limited to `.runtime/**` or legacy `.tools/**` (portable tool trees).
 * Refuses anything outside those roots.
 */
export function safeRemoveUnderTools(target, { root = projectRoot, dryRun = false } = {}) {
  const allowed = [
    path.resolve(toolsRoot(root)),
    path.resolve(root, '.runtime'),
    path.resolve(root, '.tools'),
  ];
  let abs;
  try {
    abs = assertUnderRoot(target, root);
  } catch (e) {
    return { ok: false, path: String(target), error: e.message };
  }
  const under = allowed.some((tr) => {
    const trSep = tr.endsWith(path.sep) ? tr : tr + path.sep;
    return abs === tr || abs.startsWith(trSep);
  });
  if (!under) {
    return { ok: false, path: abs, error: 'refusing path outside .runtime/.tools' };
  }
  // Never delete the entire runtime/tools root by accident unless explicit
  if (allowed.includes(abs)) {
    return { ok: false, path: abs, error: 'refusing to delete entire tools root' };
  }
  return safeRemove(abs, { root, dryRun, allowProtected: true });
}
