import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function readSrc(...parts: string[]) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

/**
 * Gating: conversion job path must never download/install tools mid-job.
 * Scans shipped worker + processor + engine modules for install/download entrypoints.
 */
describe('converter jobs never install tools mid-run', () => {
  const processor = readSrc('server/src/processors/converter.ts');
  const jobs = readSrc('server/src/workers/jobs.ts');
  const enginesIndex = readSrc('server/src/convert/engines/index.ts');
  const workersIndex = fs.existsSync(path.join(root, 'server/src/workers/pool.ts'))
    ? readSrc('server/src/workers/pool.ts')
    : '';

  const bundle = `${processor}\n${jobs}\n${enginesIndex}\n${workersIndex}`;

  it('does not invoke tools.mjs install/repair/update from job path', () => {
    assert.ok(!/tools\.mjs/.test(bundle));
    assert.ok(!/setup-tools\.mjs/.test(bundle));
    assert.ok(!/runtime-verify\.mjs/.test(bundle));
    assert.ok(!/tools:install|tools:repair|runtime:prepare/.test(bundle));
  });

  it('does not call npm install or fetch tool archives during conversion', () => {
    assert.ok(!/npm\s+install/.test(bundle));
    assert.ok(!/downloadTool|installPortable|fetch\(.*ffmpeg/i.test(bundle));
  });

  it('uses argv engine dispatch without shell', () => {
    assert.match(processor, /ENGINE_DISPATCH|convertWithPandoc|executeEngineFallback/);
    assert.ok(!/exec\(|spawn\([^)]*shell:\s*true/.test(processor));
  });
});
