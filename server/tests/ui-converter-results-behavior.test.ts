/**
 * Behavioral tests for Converted Files visibility helpers + structural wiring
 * for format filter, Remove, preview, scoped cancel/retry in ConverterView.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyResultVisibility,
  jobTouchesFileIds,
} from '../../src/lib/converterGroups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

describe('Converted Files visibility (real helpers)', () => {
  it('Clear completed path: hideCompleted filters completed rows out of visible list', () => {
    const rows = [
      { id: '1', status: 'completed', outputFormat: 'webp', createdAt: 't2' },
      { id: '2', status: 'failed', outputFormat: 'png', createdAt: 't3' },
    ];
    // Before clear
    assert.equal(applyResultVisibility(rows, { hideCompleted: false }).length, 2);
    // After Clear completed (persisted hideCompleted=true)
    const after = applyResultVisibility(rows, { hideCompleted: true });
    assert.equal(after.length, 1);
    assert.equal(after[0].status, 'failed');
  });

  it('per-result Remove uses hiddenIds', () => {
    const rows = [
      { id: 'keep', status: 'completed', createdAt: 'a' },
      { id: 'gone', status: 'completed', createdAt: 'b' },
    ];
    const vis = applyResultVisibility(rows, { hiddenIds: ['gone'] });
    assert.deepEqual(
      vis.map((r) => r.id),
      ['keep'],
    );
  });
});

describe('ConverterView results wiring (structural, shipped file)', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/ConverterView.jsx'), 'utf8');

  it('wires hideCompleted into applyResultVisibility / visibleResults', () => {
    assert.match(view, /hideCompleted/);
    assert.match(view, /applyResultVisibility/);
    assert.match(view, /setHideCompleted\(Boolean\(conv\.hideCompleted\)\)/);
    assert.match(view, /clearCompleted/);
  });

  it('has format filter UI bound to resultFilter.format', () => {
    assert.match(view, /label="Format"/);
    assert.match(view, /resultFilter\.format/);
    assert.match(view, /All formats/);
  });

  it('has per-result Remove and preview rendering', () => {
    assert.match(view, /removeResultRow/);
    assert.match(view, /converted-preview/);
    assert.match(view, /row\.previewUrl/);
  });

  it('scopes cancel to jobTouchesFileIds and retry to jobIds', () => {
    assert.match(view, /jobTouchesFileIds/);
    assert.match(view, /retryFailed\(\[row\.jobId/);
    // cancelGroupJobs must not cancel all converter jobs from hydrate without intersection
    const cancelFn = view.split('const cancelGroupJobs')[1]?.slice(0, 900) || '';
    assert.match(cancelFn, /jobTouchesFileIds/);
    assert.ok(!/filter\(\s*\(j\)\s*=>\s*\['queued',\s*'running'\]\.includes\(j\.status\)\s*&&\s*j\.type\s*===\s*'converter'\s*\)/.test(cancelFn));
  });
});

describe('jobTouchesFileIds pure', () => {
  it('does not match jobs without upload ids (avoids cancel-all)', () => {
    assert.equal(
      jobTouchesFileIds({ options: {}, type: 'converter', status: 'running' }, ['a']),
      false,
    );
  });
});
