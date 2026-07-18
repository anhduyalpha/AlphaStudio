/**
 * Durable unit tests for pure converter grouping / settings helpers.
 * Source: src/lib/converterGroups.js (ESM, no DOM/network).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConversionGroups,
  applySettingsToCompatible,
  applyResultVisibility,
  canConvertGroup,
  buildResultRows,
  engineForOutput,
  filterSortResults,
  hasActiveDuplicateJob,
  groupKeyForFile,
  jobTouchesFileIds,
} from '../../src/lib/converterGroups.js';

function file(partial: Record<string, unknown>) {
  return {
    id: 'f1',
    originalName: 'a.png',
    size: 100,
    mime: 'image/png',
    status: 'ready',
    detect: null as unknown,
    ...partial,
  };
}

function pngDetect(overrides: Record<string, unknown> = {}) {
  return {
    format: 'png',
    family: 'image',
    unsupported: false,
    recommendedOutput: 'jpg',
    outputs: [
      { format: 'jpg', available: true, label: 'JPEG' },
      { format: 'webp', available: true, label: 'WebP' },
      { format: 'pdf', available: false, label: 'PDF' },
    ],
    ...overrides,
  };
}

function pdfDetect(overrides: Record<string, unknown> = {}) {
  return {
    format: 'pdf',
    family: 'pdf',
    unsupported: false,
    recommendedOutput: 'png',
    outputs: [
      { format: 'png', available: true, label: 'PNG' },
      { format: 'jpg', available: true, label: 'JPEG' },
    ],
    ...overrides,
  };
}

describe('groupKeyForFile', () => {
  it('returns unknown without detect', () => {
    assert.equal(groupKeyForFile(file({ detect: null })), 'unknown');
  });

  it('returns format key when format is known', () => {
    assert.equal(groupKeyForFile(file({ detect: pngDetect() })), 'format:png');
  });

  it('returns unsupported when detect.unsupported', () => {
    assert.equal(
      groupKeyForFile(file({ detect: { unsupported: true, family: 'image', format: 'xyz' } })),
      'unsupported',
    );
  });
});

describe('buildConversionGroups', () => {
  it('same-format files → mode batch, one group', () => {
    const files = [
      file({ id: 'a', originalName: 'one.png', detect: pngDetect() }),
      file({ id: 'b', originalName: 'two.png', detect: pngDetect() }),
    ];
    const result = buildConversionGroups(files);
    assert.equal(result.mode, 'batch');
    assert.equal(result.groups.length, 1);
    assert.equal(result.unsupported.length, 0);
    assert.equal(result.groups[0].key, 'format:png');
    assert.deepEqual(result.groups[0].fileIds, ['a', 'b']);
    assert.equal(result.groups[0].members.length, 2);
    assert.ok(result.groups[0].outputs.some((o: { format: string }) => o.format === 'jpg'));
    assert.equal(result.groups[0].valid, true);
  });

  it('mixed formats → mode mixed, multiple groups', () => {
    const files = [
      file({ id: 'a', originalName: 'pic.png', detect: pngDetect() }),
      file({ id: 'b', originalName: 'doc.pdf', detect: pdfDetect() }),
    ];
    const result = buildConversionGroups(files);
    assert.equal(result.mode, 'mixed');
    assert.equal(result.groups.length, 2);
    assert.equal(result.unsupported.length, 0);
    const keys = result.groups.map((g: { key: string }) => g.key).sort();
    assert.deepEqual(keys, ['format:pdf', 'format:png']);
  });

  it('unsupported / no detect → unsupported array', () => {
    const files = [
      file({ id: 'u1', originalName: 'weird.bin', detect: null }),
      file({
        id: 'u2',
        originalName: 'bad.xyz',
        detect: { format: 'xyz', family: 'unknown', unsupported: true, outputs: [] },
      }),
      file({
        id: 'u3',
        originalName: 'no-family.dat',
        detect: { format: 'unknown', family: 'unknown', unsupported: false, outputs: [] },
      }),
      file({ id: 'ok', originalName: 'ok.png', detect: pngDetect() }),
    ];
    const result = buildConversionGroups(files);
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].key, 'format:png');
    assert.equal(result.unsupported.length, 3);
    const ids = result.unsupported.map((f: { id: string }) => f.id).sort();
    assert.deepEqual(ids, ['u1', 'u2', 'u3']);
    assert.equal(result.mode, 'batch');
  });

  it('empty / deleted files → mode empty', () => {
    assert.equal(buildConversionGroups([]).mode, 'empty');
    const deleted = buildConversionGroups([
      file({ id: 'd', status: 'deleted', detect: pngDetect() }),
      file({ id: 'm', status: 'missing', detect: pngDetect() }),
    ]);
    assert.equal(deleted.mode, 'empty');
    assert.equal(deleted.groups.length, 0);
  });

  it('uses registry engine metadata and follows the selected output', () => {
    const detected = pngDetect({
      recommendedOutput: 'webp',
      outputs: [
        {
          format: 'webp',
          available: true,
          label: 'WebP',
          engine: { id: 'alphastudio', name: 'AlphaStudio Built-in', profile: 'core' },
        },
        {
          format: 'mp4',
          available: true,
          label: 'MP4',
          engine: { id: 'ffmpeg', name: 'FFmpeg', profile: 'media' },
        },
      ],
    });
    const group = buildConversionGroups([file({ detect: detected })]).groups[0];
    assert.equal(group.engine, 'AlphaStudio Built-in');
    assert.equal(engineForOutput(group, 'mp4'), 'FFmpeg');
  });
});

describe('applySettingsToCompatible', () => {
  it('only applies when target group has the format available', () => {
    const groups = [
      {
        id: 'format:png',
        outputs: [
          { format: 'jpg', available: true },
          { format: 'webp', available: true },
        ],
        recommendedOutput: 'jpg',
      },
      {
        id: 'format:pdf',
        outputs: [
          { format: 'png', available: true },
          { format: 'jpg', available: true },
        ],
        recommendedOutput: 'png',
      },
      {
        id: 'format:mp3',
        outputs: [{ format: 'wav', available: true }],
        recommendedOutput: 'wav',
      },
    ];
    const sourceSettings = {
      'format:png': { format: 'jpg', quality: 'high', preserveMetadata: false },
    };
    const next = applySettingsToCompatible(sourceSettings, groups, 'format:png');
    assert.equal(next['format:png'].format, 'jpg');
    assert.equal(next['format:pdf'].format, 'jpg');
    assert.equal(next['format:pdf'].quality, 'high');
    assert.equal(next['format:pdf'].preserveMetadata, false);
    assert.equal(next['format:mp3'], undefined);
  });

  it('returns copy unchanged when source has no format', () => {
    const sourceSettings = { 'format:png': { quality: 'balanced' } };
    const next = applySettingsToCompatible(sourceSettings, [], 'format:png');
    assert.deepEqual(next, sourceSettings);
    assert.notEqual(next, sourceSettings);
  });
});

describe('canConvertGroup', () => {
  it('false without format', () => {
    const group = {
      valid: true,
      fileIds: ['a'],
      outputs: [{ format: 'jpg', available: true }],
    };
    assert.equal(canConvertGroup(group, {}), false);
    assert.equal(canConvertGroup(group, { format: '' }), false);
    assert.equal(canConvertGroup(group, null), false);
  });

  it('false when group invalid or empty fileIds', () => {
    assert.equal(
      canConvertGroup({ valid: false, fileIds: ['a'], outputs: [{ format: 'jpg', available: true }] }, { format: 'jpg' }),
      false,
    );
    assert.equal(
      canConvertGroup({ valid: true, fileIds: [], outputs: [{ format: 'jpg', available: true }] }, { format: 'jpg' }),
      false,
    );
  });

  it('true when format is available on group', () => {
    const group = {
      valid: true,
      fileIds: ['a'],
      outputs: [
        { format: 'jpg', available: true },
        { format: 'pdf', available: false },
      ],
    };
    assert.equal(canConvertGroup(group, { format: 'jpg' }), true);
    assert.equal(canConvertGroup(group, { format: 'pdf' }), false);
    assert.equal(canConvertGroup(group, { format: 'webp' }), false);
  });
});

describe('filterSortResults', () => {
  const rows = [
    { id: '1', status: 'completed', outputFormat: 'jpg', inputFormat: 'png', outputName: 'b.jpg', createdAt: '2024-01-02' },
    { id: '2', status: 'failed', outputFormat: 'png', inputFormat: 'pdf', outputName: 'a.png', createdAt: '2024-01-03' },
    { id: '3', status: 'completed', outputFormat: 'webp', inputFormat: 'png', outputName: 'c.webp', createdAt: '2024-01-01' },
    { id: '4', status: 'running', outputFormat: 'jpg', inputFormat: 'gif', outputName: 'd.jpg', createdAt: '2024-01-04' },
  ];

  it('filters by status', () => {
    const completed = filterSortResults(rows, { status: 'completed' });
    assert.equal(completed.length, 2);
    assert.ok(completed.every((r: { status: string }) => r.status === 'completed'));

    const failed = filterSortResults(rows, { status: 'failed' });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].id, '2');

    const all = filterSortResults(rows, { status: 'all' });
    assert.equal(all.length, 4);
  });

  it('filters by format and sorts', () => {
    const jpg = filterSortResults(rows, { format: 'jpg' });
    assert.equal(jpg.length, 2);
    assert.ok(jpg.every((r: { outputFormat: string; inputFormat: string }) =>
      r.outputFormat === 'jpg' || r.inputFormat === 'jpg',
    ));

    const byName = filterSortResults(rows, { sort: 'name' });
    assert.equal(byName[0].outputName, 'a.png');
  });
});

describe('hasActiveDuplicateJob', () => {
  it('true for queued same uploads+format', () => {
    const jobs = [
      {
        type: 'converter',
        status: 'queued',
        options: { uploadIds: ['u2', 'u1'], format: 'jpg' },
      },
    ];
    assert.equal(
      hasActiveDuplicateJob(jobs, { uploadIds: ['u1', 'u2'], format: 'jpg' }),
      true,
    );
  });

  it('true for running with _uploadIds and tool field', () => {
    const jobs = [
      {
        tool: 'converter',
        status: 'running',
        options: { _uploadIds: ['x'], format: 'webp' },
      },
    ];
    assert.equal(hasActiveDuplicateJob(jobs, { uploadIds: ['x'], format: 'webp' }), true);
  });

  it('false for completed, different format, or missing ids', () => {
    assert.equal(
      hasActiveDuplicateJob(
        [{ type: 'converter', status: 'completed', options: { uploadIds: ['u1'], format: 'jpg' } }],
        { uploadIds: ['u1'], format: 'jpg' },
      ),
      false,
    );
    assert.equal(
      hasActiveDuplicateJob(
        [{ type: 'converter', status: 'queued', options: { uploadIds: ['u1'], format: 'png' } }],
        { uploadIds: ['u1'], format: 'jpg' },
      ),
      false,
    );
    assert.equal(
      hasActiveDuplicateJob(
        [{ type: 'converter', status: 'queued', options: { format: 'jpg' } }],
        { uploadIds: ['u1'], format: 'jpg' },
      ),
      false,
    );
  });
});

describe('buildResultRows', () => {
  it('maps completed jobs with downloadUrl only when completed', () => {
    const jobs = [
      {
        id: 'j1',
        type: 'converter',
        status: 'completed',
        downloadUrl: '/api/jobs/j1/download',
        outputName: 'out.jpg',
        options: { uploadIds: ['f1'], format: 'jpg', inputFormat: 'png' },
        progress: 100,
        createdAt: '2024-06-02T00:00:00Z',
      },
      {
        id: 'j2',
        type: 'converter',
        status: 'running',
        downloadUrl: '/api/jobs/j2/download',
        options: { uploadIds: ['f1'], format: 'webp' },
        progress: 40,
        createdAt: '2024-06-01T00:00:00Z',
      },
      {
        id: 'j3',
        tool: 'converter',
        status: 'failed',
        options: { format: 'png' },
        error: 'boom',
        createdAt: '2024-05-01T00:00:00Z',
      },
      {
        id: 'other',
        type: 'qr',
        status: 'completed',
        downloadUrl: '/api/jobs/other/download',
      },
    ];
    const outputs = [
      {
        id: 'o1',
        jobId: 'j1',
        name: 'out.jpg',
        size: 1234,
        downloadUrl: '/api/outputs/o1/download',
        mime: 'image/jpeg',
      },
      {
        id: 'o2',
        jobId: 'j2',
        name: 'partial.webp',
        size: 50,
        downloadUrl: '/api/outputs/o2/download',
      },
    ];
    const files = [{ id: 'f1', originalName: 'source.png' }];

    const rows = buildResultRows({ jobs, outputs, files });
    assert.equal(rows.length, 3, 'non-converter jobs excluded');

    const completed = rows.find((r: { id: string }) => r.id === 'j1');
    assert.ok(completed);
    assert.equal(completed.status, 'completed');
    assert.ok(completed.downloadUrl, 'completed job gets downloadUrl');
    assert.equal(completed.sourceLabel, 'source.png');
    assert.equal(completed.outputFormat, 'jpg');
    assert.equal(completed.size, 1234);

    const running = rows.find((r: { id: string }) => r.id === 'j2');
    assert.ok(running);
    assert.equal(running.downloadUrl, null, 'non-completed has no downloadUrl');
    assert.equal(running.progress, 40);

    const failed = rows.find((r: { id: string }) => r.id === 'j3');
    assert.ok(failed);
    assert.equal(failed.downloadUrl, null);
    assert.equal(failed.error, 'boom');
  });

  it('withholds download when output size is zero', () => {
    const rows = buildResultRows({
      jobs: [
        {
          id: 'jz',
          type: 'converter',
          status: 'completed',
          downloadUrl: '/dl',
          options: { format: 'jpg' },
          createdAt: '2024-01-01',
        },
      ],
      outputs: [{ id: 'oz', jobId: 'jz', size: 0, downloadUrl: '/dl' }],
    });
    assert.equal(rows[0].downloadUrl, null);
  });

  it('resolves sourceLabel from _uploadIds + files list (hydrate shape)', () => {
    const rows = buildResultRows({
      jobs: [
        {
          id: 'j-up',
          type: 'converter',
          status: 'completed',
          downloadUrl: '/api/jobs/j-up/download',
          options: { _uploadIds: ['f-a', 'f-b'], format: 'webp' },
          createdAt: '2024-07-01T00:00:00Z',
        },
      ],
      outputs: [{ id: 'o-up', jobId: 'j-up', name: 'out.webp', size: 10 }],
      files: [
        { id: 'f-a', originalName: 'alpha.png' },
        { id: 'f-b', originalName: 'beta.png' },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceLabel, 'alpha.png, beta.png');
  });

  it('prefers options.inputFileNames over files list', () => {
    const rows = buildResultRows({
      jobs: [
        {
          id: 'j-names',
          type: 'converter',
          status: 'completed',
          downloadUrl: '/dl',
          options: {
            _uploadIds: ['gone'],
            inputFileNames: ['kept-name.pdf'],
            format: 'png',
          },
          createdAt: '2024-07-02T00:00:00Z',
        },
      ],
      outputs: [{ id: 'o-n', jobId: 'j-names', name: 'out.png', size: 5 }],
      files: [], // file may be deleted after job — names still come from hydrate
    });
    assert.equal(rows[0].sourceLabel, 'kept-name.pdf');
  });
});

describe('applyResultVisibility (Clear completed + remove)', () => {
  const rows = [
    { id: 'a', jobId: 'a', status: 'completed', outputFormat: 'webp', createdAt: '2024-01-02' },
    { id: 'b', jobId: 'b', status: 'failed', outputFormat: 'png', createdAt: '2024-01-03' },
    { id: 'c', jobId: 'c', status: 'running', outputFormat: 'jpg', createdAt: '2024-01-04' },
  ];

  it('hideCompleted removes completed from list but keeps failed/running', () => {
    const vis = applyResultVisibility(rows, { hideCompleted: true });
    assert.equal(vis.length, 2);
    assert.ok(vis.every((r) => r.status !== 'completed'));
  });

  it('hiddenIds removes specific rows (per-result Remove)', () => {
    const vis = applyResultVisibility(rows, { hiddenIds: ['b'] });
    assert.equal(vis.length, 2);
    assert.ok(!vis.some((r) => r.id === 'b'));
  });
});

describe('jobTouchesFileIds (scoped cancel)', () => {
  it('true only when upload ids intersect', () => {
    const job = { options: { _uploadIds: ['f1', 'f2'] } };
    assert.equal(jobTouchesFileIds(job, ['f2', 'f9']), true);
    assert.equal(jobTouchesFileIds(job, ['f9']), false);
    assert.equal(jobTouchesFileIds({ options: {} }, ['f1']), false);
  });
});
