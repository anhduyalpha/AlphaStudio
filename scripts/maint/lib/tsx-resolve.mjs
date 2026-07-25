/**
 * Resolve tsx under npm workspaces (root hoist) or nested server install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * @param {string} root project root
 * @returns {string|null} absolute path to tsx CLI entry, or null
 */
export function resolveTsxCli(root) {
  const candidates = [
    path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(root, 'node_modules', 'tsx', 'dist', 'cli.js'),
    path.join(root, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(root, 'server', 'node_modules', 'tsx', 'dist', 'cli.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * True when `node --import tsx` can resolve the package from root (workspaces).
 * @param {string} root
 */
export function canResolveTsxPackage(root) {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    require.resolve('tsx');
    return true;
  } catch {
    return resolveTsxCli(root) != null;
  }
}
