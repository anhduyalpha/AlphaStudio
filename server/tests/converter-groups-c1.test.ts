import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateJobProgress,
  buildConvertAllPlans,
  buildConvertSelectionPlan,
  canConvertSelection,
  setGroupFileSelection,
  settingsSchemaForEngine,
  toggleFileSelection,
} from '../../src/lib/converterGroups.js';

function file(id: string, format: string, outputs: Array<{ format: string; available: boolean; label?: string }>) {
  return {
    id,
    detect: {
      format,
      family: format === 'png' ? 'image' : 'text',
      outputs: outputs.map((o) => ({ label: o.format.toUpperCase(), ...o })),
    },
  };
}

describe('converter C1 selection + convert plans', () => {
  it('toggleFileSelection adds and removes ids immutably', () => {
    const a = toggleFileSelection(new Set(), 'f1');
    assert.equal(a.has('f1'), true);
    const b = toggleFileSelection(a, 'f1');
    assert.equal(b.has('f1'), false);
    assert.equal(a.has('f1'), true);
  });

  it('setGroupFileSelection selects and clears group members', () => {
    const group = { fileIds: ['a', 'b', 'c'] };
    const selected = setGroupFileSelection(new Set(['x']), group, true);
    assert.deepEqual([...selected].sort(), ['a', 'b', 'c', 'x']);
    const cleared = setGroupFileSelection(selected, group, false);
    assert.deepEqual([...cleared], ['x']);
  });

  it('buildConvertAllPlans skips invalid groups and keeps valid ones', () => {
    const groups = [
      {
        id: 'format:png',
        format: 'png',
        family: 'image',
        fileIds: ['1', '2'],
        valid: true,
        outputs: [{ format: 'webp', available: true, label: 'WEBP' }],
        recommendedOutput: 'webp',
      },
      {
        id: 'format:xyz',
        format: 'xyz',
        family: 'unknown',
        fileIds: ['3'],
        valid: false,
        outputs: [],
        recommendedOutput: null,
      },
    ];
    const plans = buildConvertAllPlans(groups, {
      'format:png': { format: 'webp', quality: 'high', preserveMetadata: false },
    });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].format, 'webp');
    assert.deepEqual(plans[0].fileIds, ['1', '2']);
    assert.equal(plans[0].quality, 'high');
    assert.equal(plans[0].preserveMetadata, false);
  });

  it('buildConvertSelectionPlan requires shared available format', () => {
    const files = [
      file('1', 'png', [
        { format: 'webp', available: true },
        { format: 'jpeg', available: true },
      ]),
      file('2', 'png', [
        { format: 'webp', available: true },
        { format: 'jpeg', available: false },
      ]),
    ];
    assert.equal(canConvertSelection(files, ['1', '2'], 'webp'), true);
    assert.equal(canConvertSelection(files, ['1', '2'], 'jpeg'), false);
    const plan = buildConvertSelectionPlan(files, new Set(['1', '2']), 'webp', {
      quality: 'fast',
    });
    assert.ok(plan);
    assert.equal(plan.format, 'webp');
    assert.equal(plan.quality, 'fast');
    assert.equal(buildConvertSelectionPlan(files, ['1', '2'], 'jpeg'), null);
  });

  it('aggregateJobProgress uses real averages or honest indeterminate', () => {
    assert.equal(aggregateJobProgress({}).indeterminate, false);
    assert.equal(aggregateJobProgress({ a: { status: 'queued' } }).indeterminate, true);
    const running = aggregateJobProgress({
      a: { status: 'running', progress: 20 },
      b: { status: 'running', progress: 40 },
    });
    assert.equal(running.indeterminate, false);
    assert.equal(running.value, 30);
    const noPct = aggregateJobProgress({ a: { status: 'running', progress: 0 } });
    assert.equal(noPct.indeterminate, true);
  });

  it('settingsSchemaForEngine hides quality for LibreOffice and shows it for media', () => {
    const office = settingsSchemaForEngine('LibreOffice', 'document');
    assert.equal(office.some((s) => s.id === 'quality'), false);
    const media = settingsSchemaForEngine('FFmpeg', 'audio');
    assert.equal(media.some((s) => s.id === 'quality'), true);
    assert.equal(media.some((s) => s.id === 'preserveMetadata'), true);
  });
});
