/**
 * Pure unit tests for realtime live-state helpers.
 * Source: src/lib/liveState.js (ESM, no DOM/network).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertById,
  isNewerEvent,
  mergeProgressEvent,
  mergeWorkspaceSnapshot,
  computeUploadMetrics,
  applyWorkspaceEvent,
  normalizeWorkspaceEvent,
} from '../../src/lib/liveState.js';

describe('upsertById', () => {
  it('adds a new item when id is not present', () => {
    const list = [{ id: 'a', name: 'A' }];
    const next = upsertById(list, { id: 'b', name: 'B' });
    assert.equal(next.length, 2);
    assert.deepEqual(next[1], { id: 'b', name: 'B' });
    // original list unchanged
    assert.equal(list.length, 1);
  });

  it('updates by id not index (same id, different position semantics)', () => {
    const list = [
      { id: 'first', name: 'one', idx: 0 },
      { id: 'second', name: 'two', idx: 1 },
      { id: 'third', name: 'three', idx: 2 },
    ];
    // Update the middle id while carrying fields that would look like a new row by index
    const next = upsertById(list, { id: 'second', name: 'TWO-UPDATED', idx: 99 });
    assert.equal(next.length, 3);
    assert.equal(next[0].id, 'first');
    assert.equal(next[1].id, 'second');
    assert.equal(next[1].name, 'TWO-UPDATED');
    assert.equal(next[1].idx, 99);
    assert.equal(next[2].id, 'third');
    // Position of other ids preserved
    assert.equal(next[0].name, 'one');
    assert.equal(next[2].name, 'three');
  });

  it('uses mergeFn when provided', () => {
    const list = [{ id: 'x', a: 1, b: 2 }];
    const next = upsertById(list, { id: 'x', a: 9 }, (existing, incoming) => ({
      ...existing,
      ...incoming,
      b: existing.b,
    }));
    assert.deepEqual(next[0], { id: 'x', a: 9, b: 2 });
  });

  it('returns copy of list when item has no id', () => {
    const list = [{ id: 'a' }];
    const next = upsertById(list, { name: 'nope' } as { id: string });
    assert.deepEqual(next, list);
    assert.notEqual(next, list);
  });
});

describe('isNewerEvent', () => {
  it('higher version wins', () => {
    assert.equal(
      isNewerEvent({ version: 1, updatedAt: '2020-01-01T00:00:00.000Z' }, { version: 2, updatedAt: '2019-01-01T00:00:00.000Z' }),
      true,
    );
    assert.equal(
      isNewerEvent({ version: 5, updatedAt: '2025-01-01T00:00:00.000Z' }, { version: 3, updatedAt: '2026-01-01T00:00:00.000Z' }),
      false,
    );
  });

  it('older updatedAt cannot overwrite when versions are equal or absent', () => {
    const current = { updatedAt: '2024-06-01T12:00:00.000Z', progress: 50 };
    const older = { updatedAt: '2024-06-01T11:00:00.000Z', progress: 90 };
    assert.equal(isNewerEvent(current, older), false);

    // Same version, older timestamp
    assert.equal(
      isNewerEvent(
        { version: 1, updatedAt: '2024-06-01T12:00:00.000Z' },
        { version: 1, updatedAt: '2024-06-01T11:00:00.000Z' },
      ),
      false,
    );
  });

  it('later updatedAt wins when versions equal', () => {
    assert.equal(
      isNewerEvent(
        { version: 1, updatedAt: '2024-01-01T00:00:00.000Z' },
        { version: 1, updatedAt: '2024-01-02T00:00:00.000Z' },
      ),
      true,
    );
  });

  it('null current accepts anything; null incoming is rejected', () => {
    assert.equal(isNewerEvent(null, { version: 1 }), true);
    assert.equal(isNewerEvent({ version: 1 }, null), false);
  });
});

describe('mergeProgressEvent', () => {
  it('inserts new event by id', () => {
    const map = mergeProgressEvent({}, { id: 'job-1', version: 1, progress: 10 });
    assert.equal(map['job-1'].progress, 10);
    assert.equal(map['job-1'].version, 1);
  });

  it('drops stale version (does not regress progress)', () => {
    let map = mergeProgressEvent({}, { id: 'j1', version: 3, progress: 80, updatedAt: '2024-01-03T00:00:00.000Z' });
    map = mergeProgressEvent(map, { id: 'j1', version: 2, progress: 20, updatedAt: '2024-01-04T00:00:00.000Z' });
    assert.equal(map['j1'].version, 3);
    assert.equal(map['j1'].progress, 80);
  });

  it('accepts higher version', () => {
    let map = mergeProgressEvent({}, { id: 'j1', version: 1, progress: 10 });
    map = mergeProgressEvent(map, { id: 'j1', version: 2, progress: 55 });
    assert.equal(map['j1'].version, 2);
    assert.equal(map['j1'].progress, 55);
  });

  it('returns same map reference when event has no id', () => {
    const map = { a: { id: 'a' } };
    const next = mergeProgressEvent(map, { progress: 1 });
    assert.equal(next, map);
  });
});

describe('mergeWorkspaceSnapshot', () => {
  it('keeps optimistic uploading row not present in snapshot', () => {
    const live = [
      {
        id: 'local-1',
        originalName: 'uploading.bin',
        uiStatus: 'uploading',
        localOnly: true,
        uploadProgress: 42,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const snapshot = [
      {
        id: 'server-1',
        originalName: 'ready.pdf',
        status: 'ready',
        createdAt: '2024-01-01T01:00:00.000Z',
      },
    ];
    const merged = mergeWorkspaceSnapshot(live, snapshot);
    const ids = merged.map((f: { id: string }) => f.id);
    assert.ok(ids.includes('local-1'), 'optimistic uploading row kept');
    assert.ok(ids.includes('server-1'), 'snapshot file present');
    const local = merged.find((f: { id: string }) => f.id === 'local-1');
    assert.equal(local.uiStatus, 'uploading');
    assert.equal(local.uploadProgress, 42);
  });

  it('merges snapshot into live for same id', () => {
    const live = [
      {
        id: 'f1',
        originalName: 'pending.bin',
        uiStatus: 'uploading',
        uploadProgress: 60,
        localProgress: true,
        version: 2,
        updatedAt: '2024-01-02T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const snapshot = [
      {
        id: 'f1',
        originalName: 'real-name.pdf',
        status: 'ready',
        detect: { format: 'pdf' },
        version: 1,
        updatedAt: '2024-01-01T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const merged = mergeWorkspaceSnapshot(live, snapshot);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'f1');
    // Snapshot identity fields available; terminal ready is authoritative
    assert.equal(merged[0].originalName, 'real-name.pdf');
    assert.deepEqual(merged[0].detect, { format: 'pdf' });
    assert.equal(merged[0].status, 'ready');
    assert.equal(merged[0].uiStatus, 'ready');
  });

  it('uploading live row + ready snapshot same id → single ready row (no duplicate)', () => {
    // Reconnect case: client still shows optimistic uploading; server already finalized.
    const live = [
      {
        id: 'file-abc',
        originalName: 'photo.png',
        uiStatus: 'uploading',
        localOnly: true,
        uploadProgress: 75,
        createdAt: '2024-03-01T10:00:00.000Z',
      },
      {
        id: 'other-ready',
        originalName: 'note.txt',
        status: 'ready',
        uiStatus: 'ready',
        createdAt: '2024-03-01T09:00:00.000Z',
      },
    ];
    const snapshot = [
      {
        id: 'file-abc',
        originalName: 'photo.png',
        status: 'ready',
        detect: { format: 'png', family: 'image' },
        createdAt: '2024-03-01T10:00:00.000Z',
        updatedAt: '2024-03-01T10:00:05.000Z',
      },
      {
        id: 'other-ready',
        originalName: 'note.txt',
        status: 'ready',
        createdAt: '2024-03-01T09:00:00.000Z',
      },
    ];
    const merged = mergeWorkspaceSnapshot(live, snapshot);
    const matches = merged.filter((f: { id: string }) => f.id === 'file-abc');
    assert.equal(matches.length, 1, 'same id must not duplicate');
    assert.equal(merged.length, 2, 'other files preserved, no extra rows');
    assert.equal(matches[0].status, 'ready');
    assert.equal(matches[0].uiStatus, 'ready');
    assert.equal(matches[0].localOnly, false);
    assert.deepEqual(matches[0].detect, { format: 'png', family: 'image' });
  });

  it('keeps two files with the same originalName when ids differ', () => {
    const live = [
      {
        id: 'id-a',
        originalName: 'report.pdf',
        uiStatus: 'uploading',
        localOnly: true,
        createdAt: '2024-04-01T00:00:00.000Z',
      },
    ];
    const snapshot = [
      {
        id: 'id-b',
        originalName: 'report.pdf',
        status: 'ready',
        createdAt: '2024-04-01T00:01:00.000Z',
      },
    ];
    const merged = mergeWorkspaceSnapshot(live, snapshot);
    assert.equal(merged.length, 2);
    const ids = merged.map((f: { id: string }) => f.id).sort();
    assert.deepEqual(ids, ['id-a', 'id-b']);
  });

  it('uses snapshot as base when no live files', () => {
    const snapshot = [{ id: 's1', originalName: 'a.txt', createdAt: '2024-01-01T00:00:00.000Z' }];
    const merged = mergeWorkspaceSnapshot([], snapshot);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 's1');
  });
});

describe('computeUploadMetrics', () => {
  it('computes percent correctly', () => {
    const m = computeUploadMetrics(50, 200, 1000);
    assert.equal(m.loaded, 50);
    assert.equal(m.total, 200);
    assert.equal(m.percent, 25);
  });

  it('computes speed in bytes per second', () => {
    // 1000 bytes in 2000 ms → 500 B/s
    const m = computeUploadMetrics(1000, 4000, 2000);
    assert.equal(m.speedBps, 500);
    assert.equal(m.percent, 25);
    // remaining 3000 bytes at 500 B/s → 6s
    assert.equal(m.etaSeconds, 6);
  });

  it('caps percent at 100 and handles zero total', () => {
    assert.equal(computeUploadMetrics(150, 100, 1000).percent, 100);
    assert.equal(computeUploadMetrics(10, 0, 1000).percent, 0);
  });
});

describe('normalizeWorkspaceEvent', () => {
  it('normalizes snake_case fields', () => {
    const ev = normalizeWorkspaceEvent({
      event: 'file.created',
      workspace_id: 'ws1',
      file_id: 'f1',
      updated_at: '2024-01-01T00:00:00.000Z',
      seq: 7,
    });
    assert.equal(ev!.type, 'file.created');
    assert.equal(ev!.workspaceId, 'ws1');
    assert.equal(ev!.fileId, 'f1');
    assert.equal(ev!.version, 7);
    assert.equal(ev!.updatedAt, '2024-01-01T00:00:00.000Z');
  });

  it('returns null for invalid input', () => {
    assert.equal(normalizeWorkspaceEvent(null), null);
    assert.equal(normalizeWorkspaceEvent('x'), null);
  });
});

describe('applyWorkspaceEvent', () => {
  it('file.created adds file to list', () => {
    const state = { files: [] as Record<string, unknown>[], jobs: {} as Record<string, unknown> };
    const next = applyWorkspaceEvent(state, {
      type: 'file.created',
      file: {
        id: 'file-new',
        originalName: 'doc.pdf',
        status: 'ready',
      },
      version: 1,
      updatedAt: '2024-05-01T00:00:00.000Z',
    });
    assert.equal(next.files.length, 1);
    assert.equal(next.files[0].id, 'file-new');
    assert.equal(next.files[0].originalName, 'doc.pdf');
    assert.equal(next.files[0].uiStatus, 'ready');
  });

  it('old job.progress cannot regress newer progress', () => {
    let state = {
      files: [] as Record<string, unknown>[],
      jobs: {} as Record<string, unknown>,
    };

    state = applyWorkspaceEvent(state, {
      type: 'job.progress',
      jobId: 'job-1',
      status: 'running',
      progress: 70,
      version: 5,
      updatedAt: '2024-05-01T12:00:00.000Z',
    });
    assert.equal(state.jobs['job-1'].progress, 70);
    assert.equal(state.jobs['job-1'].version, 5);

    // Stale lower version with lower progress must not overwrite
    state = applyWorkspaceEvent(state, {
      type: 'job.progress',
      jobId: 'job-1',
      status: 'running',
      progress: 20,
      version: 3,
      updatedAt: '2024-05-01T13:00:00.000Z',
    });
    assert.equal(state.jobs['job-1'].progress, 70);
    assert.equal(state.jobs['job-1'].version, 5);
  });

  it('newer job.progress updates progress', () => {
    let state = {
      files: [] as Record<string, unknown>[],
      jobs: {
        'job-1': { id: 'job-1', progress: 40, version: 2, status: 'running' },
      } as Record<string, unknown>,
    };
    state = applyWorkspaceEvent(state, {
      type: 'job.progress',
      jobId: 'job-1',
      status: 'running',
      progress: 90,
      version: 4,
      updatedAt: '2024-05-02T00:00:00.000Z',
    });
    assert.equal(state.jobs['job-1'].progress, 90);
    assert.equal(state.jobs['job-1'].version, 4);
  });

  it('file.deleted removes id from list (no ghost card after remove)', () => {
    let state = {
      files: [
        { id: 'f-keep', originalName: 'a.png', status: 'ready' },
        { id: 'f-gone', originalName: 'b.png', status: 'ready' },
      ] as Record<string, unknown>[],
      jobs: {} as Record<string, unknown>,
    };
    // Simulate UI remove then SSE catch-up with deleted payload including file DTO
    state = applyWorkspaceEvent(state, {
      type: 'file.deleted',
      workspaceId: 'ws1',
      fileId: 'f-gone',
      status: 'deleted',
      file: { id: 'f-gone', status: 'deleted', originalName: 'b.png' },
      version: 10,
      updatedAt: '2024-06-01T00:00:00.000Z',
    });
    assert.equal(state.files.length, 1);
    assert.equal(state.files[0].id, 'f-keep');
    assert.ok(!state.files.some((f) => f.id === 'f-gone'));
  });

  it('status deleted without type still drops the file', () => {
    let state = {
      files: [{ id: 'x', status: 'ready' }] as Record<string, unknown>[],
      jobs: {},
    };
    state = applyWorkspaceEvent(state, {
      type: 'file.updated',
      fileId: 'x',
      status: 'deleted',
      file: { id: 'x', status: 'deleted' },
      version: 2,
    });
    assert.equal(state.files.length, 0);
  });
});
