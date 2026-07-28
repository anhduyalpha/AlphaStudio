import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import convertHub from '../hubs/convert';
import {
  buildConvertJobOptions,
  buildConvertJobRequest,
  buildConvertJobRequests,
  buildConvertRetryRequest,
} from '../lib/convertJobOptions.js';
import {
  aggregateJobProgress,
  buildConversionGroups,
  buildConvertAllPlans,
  buildConvertSelectionPlan,
  hasActiveDuplicateJob,
} from '../lib/converterGroups.js';
import { validateHubReferences } from '../workbench/registry.jsx';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/App.jsx', import.meta.url)),
  'utf8',
);
const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/hooks/useConvertWorkbench.js', import.meta.url)),
  'utf8',
);

const output = (format, available = true) => ({
  format,
  label: format.toUpperCase(),
  available,
  engine: { name: 'Test engine' },
});

const detectedFile = (
  id,
  format,
  family,
  outputs,
) => ({
  id,
  originalName: `source-${id}`,
  status: 'ready',
  detect: { format, family, outputs, recommendedOutput: outputs.find((item) => item.available)?.format },
});

describe('E1 Convert hub config', () => {
  it('declares the complete data-only workbench contract', () => {
    const mode = convertHub.modes[0];
    expect(mode).toMatchObject({
      id: 'convert',
      capabilityIds: ['converter.batch'],
      input: { kind: 'files', multiple: true },
      run: { job: { jobType: 'converter', buildOptions: 'buildConvertJobOptions' } },
      results: { kind: 'files' },
    });
    expect(mode.options.map((item) => item.id)).toEqual([
      'format',
      'quality',
      'preserveMetadata',
    ]);
    expect(JSON.stringify(convertHub)).not.toMatch(/\.(png|jpg|pdf|mp4)\b/i);
  });

  it('resolves every normative reference without adding a client accept list', () => {
    expect(validateHubReferences(convertHub, {
      hasCapability: (id) => id === 'converter.batch',
      hasAcceptList: () => false,
      hasBuilder: (id) => id === 'buildConvertJobOptions',
      hasCompute: () => false,
    })).toEqual([]);
    expect(convertHub.modes[0].input).not.toHaveProperty('acceptFrom');
  });

  it('wires hydrate, one workspace event owner, and the protocol upload orchestrator', () => {
    expect(APP_SOURCE).toContain('connectWorkspaceEvents(snapshot.workspaceId');
    expect(APP_SOURCE).toContain('applyEvent(event)');
    expect(APP_SOURCE).toContain('isTerminalStatus(job?.status)');
    expect(APP_SOURCE).toContain('void hydrate(');
    expect(CONTROLLER_SOURCE).toContain('createUploadTask(file');
    expect(CONTROLLER_SOURCE).toContain('buildConvertRetryRequest');
    expect(CONTROLLER_SOURCE).not.toMatch(/\b(fetch|XMLHttpRequest|EventSource)\b/);
  });
});

describe('E1 converter job builder', () => {
  it('creates the canonical payload and normalizes duplicate ids and format casing', () => {
    expect(buildConvertJobRequest({
      workspaceId: 'ws-1',
      clientRequestId: 'attempt-1',
      plan: {
        fileIds: [42, '42', 'f-2'],
        format: ' WEBP ',
        quality: 'balanced',
        preserveMetadata: false,
        inputFamily: 'image',
        inputFileNames: ['one', 'two'],
      },
    })).toEqual({
      type: 'converter',
      workspaceId: 'ws-1',
      uploadIds: ['42', 'f-2'],
      clientRequestId: 'attempt-1',
      options: {
        operation: 'batch',
        format: 'webp',
        quality: 'balanced',
        preserveMetadata: false,
        _uploadIds: ['42', 'f-2'],
        inputFamily: 'image',
        inputFileNames: ['one', 'two'],
      },
    });
  });

  it('fails closed without a workspace, input, or detect-derived target', () => {
    expect(() => buildConvertJobRequest({ plan: { fileIds: ['f'], format: 'x' } }))
      .toThrow(/workspace/i);
    expect(() => buildConvertJobOptions({ fileIds: [], format: 'x' }))
      .toThrow(/input/i);
    expect(() => buildConvertJobOptions({ fileIds: ['f'] }))
      .toThrow(/output format/i);
  });

  it('builds one immutable request per compatible group', () => {
    const files = [
      detectedFile('a', 'one', 'image', [output('shared')]),
      detectedFile('b', 'two', 'document', [output('shared')]),
    ];
    const { groups } = buildConversionGroups(files);
    const plans = buildConvertAllPlans(groups, Object.fromEntries(
      groups.map((group) => [group.id, { format: 'shared', quality: 'high' }]),
    ));
    const requests = buildConvertJobRequests({
      workspaceId: 'ws',
      plans,
      requestIdFor: (_plan, index) => `attempt-${index}`,
    });
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.clientRequestId)).toEqual([
      'attempt-0',
      'attempt-1',
    ]);
  });

  it('retries a failed job as a new request and rejects terminal misuse', () => {
    const failed = {
      id: 'old',
      status: 'failed',
      options: { _uploadIds: ['f-1'], format: 'target', quality: 'high' },
    };
    const retry = buildConvertRetryRequest({
      workspaceId: 'ws',
      job: failed,
      clientRequestId: 'new-attempt',
    });
    expect(retry.clientRequestId).toBe('new-attempt');
    expect(retry.uploadIds).toEqual(['f-1']);
    expect(() => buildConvertRetryRequest({
      workspaceId: 'ws',
      job: { ...failed, status: 'completed' },
      clientRequestId: 'newer',
    })).toThrow(/failed conversion/i);
  });
});

describe('E1 grouping adaptations', () => {
  it('normalizes id types and format casing for duplicate prevention', () => {
    expect(hasActiveDuplicateJob([
      {
        type: 'converter',
        status: 'running',
        options: { _uploadIds: [1, '2'], format: 'WEBP' },
      },
    ], { uploadIds: ['2', '1'], format: 'webp' })).toBe(true);
  });

  it('deduplicates selection ids and rejects targets not shared by every member', () => {
    const files = [
      detectedFile('a', 'one', 'image', [output('shared')]),
      detectedFile('b', 'two', 'document', [output('other')]),
    ];
    expect(buildConvertSelectionPlan(files, ['a', 'a'], 'shared')).toMatchObject({
      fileIds: ['a'],
      format: 'shared',
    });
    expect(buildConvertSelectionPlan(files, ['a', 'b'], 'shared')).toBeNull();
  });

  it('accepts the store array representation for aggregate progress', () => {
    expect(aggregateJobProgress([
      { status: 'running', progress: 20 },
      { status: 'running', progress: 60 },
      { status: 'completed', progress: 100 },
    ])).toEqual({ value: 40, indeterminate: false, label: '2 running · 40%' });
  });
});
