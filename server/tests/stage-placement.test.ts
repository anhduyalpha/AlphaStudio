/**
 * Exclusive Input / Batch / Converted stage membership (pure helpers).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachJobsToFiles,
  fileStage,
  indexJobsByFileId,
  normalizeFileUiStatus,
  partitionFileStages,
  INPUT_STAGE_STATUSES,
  BATCH_STAGE_STATUSES,
} from '../../src/lib/liveState.js';
import { assertPairAllowed, isSameFormat } from '../src/convert/matrix.js';
import { isSameFormatPair } from '../src/convert/office.js';

describe('stage placement exclusivity', () => {
  it('maps server processing → inspecting (input stage)', () => {
    assert.equal(normalizeFileUiStatus({ status: 'processing' }, null), 'inspecting');
    assert.equal(fileStage({ id: '1', status: 'processing' }), 'input');
  });

  it('maps ready → batch', () => {
    assert.equal(normalizeFileUiStatus({ status: 'ready' }, null), 'ready');
    assert.equal(fileStage({ id: '1', status: 'ready' }), 'batch');
  });

  it('maps job queued/running to batch (not input)', () => {
    assert.equal(normalizeFileUiStatus({ status: 'ready' }, { status: 'queued' }), 'queued');
    assert.equal(fileStage({ id: '1', status: 'ready' }, { status: 'queued' }), 'batch');
    assert.equal(normalizeFileUiStatus({ status: 'ready' }, { status: 'running' }), 'processing');
    assert.equal(fileStage({ id: '1', status: 'ready' }, { status: 'running' }), 'batch');
  });

  it('maps job completed to converted (leaves batch)', () => {
    assert.equal(
      normalizeFileUiStatus({ status: 'ready' }, { status: 'completed' }),
      'completed',
    );
    assert.equal(fileStage({ id: '1', status: 'ready' }, { status: 'completed' }), 'converted');
  });

  it('maps job failed to conversion-failed (batch)', () => {
    assert.equal(
      normalizeFileUiStatus({ status: 'ready' }, { status: 'failed' }),
      'conversion-failed',
    );
    assert.equal(fileStage({ id: '1', status: 'ready' }, { status: 'failed' }), 'batch');
  });

  it('maps upload-failed / finalize failed to input', () => {
    assert.equal(
      normalizeFileUiStatus({ status: 'failed', localOnly: true, uiStatus: 'upload-failed' }, null),
      'upload-failed',
    );
    assert.equal(fileStage({ id: '1', status: 'failed', uiStatus: 'upload-failed' }), 'input');
  });

  it('partition never places same id in both input and batch', () => {
    const files = [
      { id: 'a', status: 'processing', uiStatus: 'inspecting' },
      { id: 'b', status: 'ready', uiStatus: 'ready' },
      { id: 'c', status: 'ready', uiStatus: 'processing', jobId: 'j1' },
      { id: 'd', status: 'ready', uiStatus: 'completed', jobId: 'j2' },
      { id: 'e', status: 'failed', uiStatus: 'upload-failed', localOnly: true },
    ];
    const jobs = {
      j1: { id: 'j1', status: 'running' },
      j2: { id: 'j2', status: 'completed' },
    };
    const { input, batch } = partitionFileStages(files, jobs);
    const inputIds = new Set(input.map((f) => f.id));
    const batchIds = new Set(batch.map((f) => f.id));
    for (const id of inputIds) {
      assert.ok(!batchIds.has(id), `id ${id} in both stages`);
    }
    assert.ok(inputIds.has('a'));
    assert.ok(inputIds.has('e'));
    assert.ok(batchIds.has('b'));
    assert.ok(batchIds.has('c'));
    assert.ok(!inputIds.has('d') && !batchIds.has('d'), 'completed must leave both file panels');
  });

  it('INPUT and BATCH status sets are disjoint', () => {
    for (const s of INPUT_STAGE_STATUSES) {
      if (s === 'failed') continue; // legacy dual use resolved by job presence
      assert.ok(!BATCH_STAGE_STATUSES.has(s), `overlap on ${s}`);
    }
  });

  it('reload/hydrate: completed job via options._uploadIds only (no f.jobId) leaves Batch', () => {
    // Spot-check the real hydrate shape: PublicFile has status=ready, no jobId;
    // job is only in hydrated.jobs with options._uploadIds.
    const files = [
      {
        id: 'file-ready-only',
        status: 'ready',
        originalName: 'doc.pdf',
        // deliberately NO jobId, NO uiStatus — matches server filePublic()
      },
      {
        id: 'file-still-ready',
        status: 'ready',
        originalName: 'other.png',
      },
    ];
    const jobs = [
      {
        id: 'job-done',
        status: 'completed',
        updatedAt: '2026-07-16T12:00:00.000Z',
        options: { _uploadIds: ['file-ready-only'], format: 'png' },
      },
      // no job for file-still-ready → stays in Batch
    ];

    // Pure partition must reverse-index via _uploadIds
    const { input, batch } = partitionFileStages(files, jobs);
    const batchIds = batch.map((f) => f.id);
    const inputIds = input.map((f) => f.id);

    assert.ok(
      !batchIds.includes('file-ready-only'),
      `completed via _uploadIds must leave Batch, got batch=${batchIds.join(',')}`,
    );
    assert.ok(
      !inputIds.includes('file-ready-only'),
      'completed file must not reappear in Input either',
    );
    assert.ok(
      batchIds.includes('file-still-ready'),
      'ready without completed job stays in Batch',
    );
  });

  it('attachJobsToFiles + partition matches reload ConverterView path', () => {
    const rawFiles = [
      { id: 'f1', status: 'ready', originalName: 'a.txt' },
      { id: 'f2', status: 'ready', originalName: 'b.txt' },
      { id: 'f3', status: 'processing', originalName: 'c.txt' },
    ];
    const hydrateJobs = [
      {
        id: 'j-complete',
        status: 'completed',
        updatedAt: '2026-07-16T10:00:00.000Z',
        options: { _uploadIds: ['f1'], format: 'pdf' },
      },
      {
        id: 'j-fail',
        status: 'failed',
        updatedAt: '2026-07-16T11:00:00.000Z',
        options: { _uploadIds: ['f2'], format: 'pdf' },
      },
    ];
    // activeJobs after reload only keeps queued/running — empty here
    const activeJobs = {};
    // ConverterView merges active + hydrated.jobs for stages
    const jobsForStages = { ...activeJobs };
    for (const j of hydrateJobs) jobsForStages[j.id] = j;

    const enriched = attachJobsToFiles(rawFiles, hydrateJobs);
    assert.equal(enriched.find((f) => f.id === 'f1')?.uiStatus, 'completed');
    assert.equal(enriched.find((f) => f.id === 'f1')?.jobId, 'j-complete');
    assert.equal(enriched.find((f) => f.id === 'f2')?.uiStatus, 'conversion-failed');
    assert.equal(enriched.find((f) => f.id === 'f3')?.uiStatus, 'inspecting');

    const { input, batch } = partitionFileStages(enriched, jobsForStages);
    assert.deepEqual(
      batch.map((f) => f.id).sort(),
      ['f2'],
      'only conversion-failed stays in batch',
    );
    assert.deepEqual(
      input.map((f) => f.id).sort(),
      ['f3'],
      'inspecting stays in input',
    );
    assert.ok(!batch.some((f) => f.id === 'f1') && !input.some((f) => f.id === 'f1'));
  });

  it('indexJobsByFileId prefers active job over older completed for same file', () => {
    const map = indexJobsByFileId([
      {
        id: 'old',
        status: 'completed',
        updatedAt: '2026-07-16T09:00:00.000Z',
        options: { _uploadIds: ['fx'] },
      },
      {
        id: 'new',
        status: 'queued',
        updatedAt: '2026-07-16T12:00:00.000Z',
        options: { _uploadIds: ['fx'] },
      },
    ]);
    assert.equal(map.get('fx')?.id, 'new');
    const { batch } = partitionFileStages(
      [{ id: 'fx', status: 'ready' }],
      Object.fromEntries([...map.values()].map((j) => [j.id, j])),
    );
    assert.ok(batch.some((f) => f.id === 'fx'), 're-queued convert keeps file in Batch');
  });

  it('normalizeFileUiStatus keeps completed when job null but uiStatus/jobStatus set', () => {
    assert.equal(
      normalizeFileUiStatus({ status: 'ready', uiStatus: 'completed' }, null),
      'completed',
    );
    assert.equal(
      normalizeFileUiStatus({ status: 'ready', jobStatus: 'completed' }, null),
      'completed',
    );
  });
});

describe('same-format routing gates', () => {
  it('isSameFormat / isSameFormatPair treat pdf/pdf and jpg/jpeg as same', () => {
    assert.equal(isSameFormat('pdf', 'pdf'), true);
    assert.equal(isSameFormatPair('pdf', 'pdf'), true);
    assert.equal(isSameFormat('jpg', 'jpeg'), true);
    assert.equal(isSameFormatPair('docx', 'pdf'), false);
  });

  it('assertPairAllowed rejects PDF→PDF (never LibreOffice)', () => {
    assert.throws(
      () => assertPairAllowed({ family: 'pdf', format: 'pdf', ext: '.pdf', mime: 'application/pdf' }, 'pdf'),
      /pdf.*pdf|not supported/i,
    );
  });

  it('assertPairAllowed rejects docx→docx as no-op', () => {
    assert.throws(
      () =>
        assertPairAllowed(
          {
            family: 'document',
            format: 'docx',
            ext: '.docx',
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          'docx',
        ),
      /same-format|no-op|not supported/i,
    );
  });
});
