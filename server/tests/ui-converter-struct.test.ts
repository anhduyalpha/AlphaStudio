import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

describe('Converter UI structural', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/ConverterView.jsx'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src/api/client.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  it('uses inspect API and detect-driven outputs (not static-only list)', () => {
    assert.match(client, /inspect:/);
    // Prefer upload detect + grouping; inspect may refine in background
    assert.ok(
      /api\.inspect/.test(view) || /buildConversionGroups/.test(view),
      'converter must use inspect API and/or buildConversionGroups',
    );
    assert.match(view, /outputs|recommendedOutput|groupSettings/);
  });

  it('disables convert until group has valid format + files', () => {
    assert.ok(
      /canConvertGroup/.test(view) || /canStart/.test(view),
      'must gate convert with canConvertGroup or canStart',
    );
    assert.ok(
      /disabled=\{.*canConvertGroup|disabled=\{!canStart|disabled=\{busyGroup/.test(view),
      'convert actions must be disabled when invalid/busy',
    );
  });

  it('no demo success-only convert path — real job create', () => {
    assert.ok(!/frontend demo|simulated|demo mode/i.test(view));
    assert.ok(
      /createJob|run\('converter'/.test(view),
      'must call createJob or run(converter) for real conversion',
    );
  });

  it('tool scripts registered', () => {
    assert.equal(typeof pkg.scripts['setup:tools'], 'string');
    assert.equal(typeof pkg.scripts['check:tools'], 'string');
    assert.equal(typeof pkg.scripts['repair:tools'], 'string');
    assert.ok(fs.existsSync(path.join(root, 'scripts/setup-tools.mjs')));
    assert.ok(fs.existsSync(path.join(root, 'scripts/check-tools.mjs')));
    assert.ok(fs.existsSync(path.join(root, 'scripts/repair-tools.mjs')));
  });

  it('.tools is gitignored', () => {
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.match(gi, /\.tools/);
  });
});
