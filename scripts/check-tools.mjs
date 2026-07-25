#!/usr/bin/env node
/**
 * Legacy entrypoint. Forwards to scripts/maint/tools.mjs (canonical).
 * Prefer: npm run tools:check / npm run check:tools
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, 'maint', 'tools.mjs');
const args = process.argv.slice(2);
const forwarded = args.length ? args : ['check', '--profile', 'full'];
const r = spawnSync(process.execPath, [target, ...forwarded], {
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(r.status ?? 1);
