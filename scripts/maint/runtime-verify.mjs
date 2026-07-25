#!/usr/bin/env node
/**
 * npm run runtime:verify
 *
 * Single maintenance entry: tools check (full profile) + python check (core)
 * + optional self-host hints. Never downloads. Never runs during conversion jobs.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const force = process.argv.includes('--force') || process.argv.includes('--no-cache');

function run(label, args) {
  console.log(`\n== ${label} ==`);
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  return r.status ?? 1;
}

let code = 0;
const toolsArgs = ['scripts/maint/tools.mjs', 'check', '--profile', 'full'];
if (force) toolsArgs.push('--force');
code = run('tools:check --profile full', toolsArgs) || code;

code =
  run('python:check --profile core', [
    'scripts/maint/python.mjs',
    'check',
    '--profile',
    'core',
  ]) || code;

console.log('\n== runtime:verify summary ==');
if (code === 0) {
  console.log('OK: full tools profile + python core reported healthy.');
  console.log('Optional: npm run python:install -- --profile data');
  console.log('Optional: npm run python:install -- --profile documents');
  console.log('PDF stack (poppler/gs/qpdf/tesseract): install via OS packages or future pdf profile.');
  process.exit(0);
}
console.error('FAILED: one or more runtime checks failed. See output above.');
console.error('Repair: npm run tools:repair && npm run python:repair');
process.exit(code);
