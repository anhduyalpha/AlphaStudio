/**
 * Non-merge acceptance for `src/protocol/store.ts` (PLAN B2): the sanctioned
 * storage keys (SPEC §6.1), workspace-recovery policy (§6.5 item 5), the
 * per-hub+mode job-resume pointer (§6.5 item 2), and the composed progress
 * value §6.3 makes monotonic (§2.2).
 *
 * Also written before the implementation. The recovery case is the one that
 * changes behavior rather than porting it: `hooks/useWorkspace.js` auto-created
 * a replacement workspace when recovery failed, silently orphaning the old one
 * (hazard F3-H3). SPEC §6.5 item 5 forbids that, so it is pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { recoverWorkspace, createWorkspaceCall, getWorkspaceCall } = vi.hoisted(() => ({
  recoverWorkspace: vi.fn(),
  createWorkspaceCall: vi.fn(),
  getWorkspaceCall: vi.fn(),
}));

vi.mock('../api/client.js', () => ({
  api: {
    recoverWorkspace,
    createWorkspace: createWorkspaceCall,
    getWorkspace: getWorkspaceCall,
  },
}));

const {
  WORKSPACE_ID_KEY,
  activeJobKey,
  applyEvent,
  createWorkspace,
  forgetActiveJob,
  getSnapshot,
  hydrate,
  optimisticUpload,
  rememberActiveJob,
  readActiveJobId,
  resetStore,
  resolveActiveJob,
  retryHydrate,
  selectActiveJobs,
  selectComposedProgress,
  selectFile,
  selectRunProgress,
  setUploadSessions,
} = await import('../protocol/store.js');

const iso = (minute: number): string =>
  new Date(Date.UTC(2026, 6, 26, 12, minute, 0)).toISOString();

function jobDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    type: 'convert',
    tool: 'convert',
    status: 'running',
    progress: 0,
    message: null,
    error: null,
    options: { _uploadIds: ['file-1'] },
    meta: null,
    outputName: null,
    outputMime: null,
    downloadUrl: null,
    workspaceId: 'ws-1',
    createdAt: iso(0),
    updatedAt: iso(1),
    startedAt: iso(1),
    finishedAt: null,
    cancelRequested: false,
    category: 'general',
    ...overrides,
  };
}

function fileDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    originalName: 'input.png',
    mime: 'image/png',
    size: 1024,
    ext: '.png',
    checksum: 'abc',
    fingerprint: null,
    duplicateOf: null,
    status: 'ready',
    detect: null,
    downloadUrl: '/api/files/file-1/download',
    previewUrl: '/api/files/file-1/preview',
    createdAt: iso(0),
    updatedAt: iso(0),
    ...overrides,
  };
}

function snapshotBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    route: 'convert',
    status: 'active',
    selectedFileIds: [],
    ui: {},
    toolSettings: {},
    files: [fileDto()],
    jobs: [jobDto()],
    outputs: [],
    activity: [],
    epoch: 'epoch-1',
    seq: 5,
    createdAt: iso(0),
    updatedAt: iso(1),
    lastSeenAt: iso(1),
    ...overrides,
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

let local: ReturnType<typeof memoryStorage>;
let session: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  local = memoryStorage();
  session = memoryStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  recoverWorkspace.mockReset();
  createWorkspaceCall.mockReset();
  getWorkspaceCall.mockReset();
  recoverWorkspace.mockResolvedValue(snapshotBody());
  resetStore();
});

afterEach(() => {
  resetStore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sanctioned storage keys (SPEC §6.1)', () => {
  it('persists the workspace id under the pre-rebuild key and nothing else', async () => {
    await hydrate();
    expect([...local.map.keys()]).toEqual([WORKSPACE_ID_KEY]);
    expect(WORKSPACE_ID_KEY).toBe('alphastudio-workspace-id');
    expect(local.getItem(WORKSPACE_ID_KEY)).toBe('ws-1');
  });

  it('sends the persisted id back on the next hydrate', async () => {
    local.setItem(WORKSPACE_ID_KEY, 'ws-existing');
    await hydrate({ route: 'pdf' });
    expect(recoverWorkspace).toHaveBeenCalledWith({ id: 'ws-existing', route: 'pdf' });
  });

  it('uses only the §6.1 sessionStorage key shape for resume pointers', async () => {
    await hydrate();
    rememberActiveJob('convert', 'image', 'job-1');
    expect([...session.map.keys()]).toEqual(['alphastudio-active-job:convert:image']);
    expect(activeJobKey('convert', 'image')).toBe('alphastudio-active-job:convert:image');
  });

  it('never persists workspace, job, or file data client-side', async () => {
    await hydrate();
    optimisticUpload({ clientId: 'c1', name: 'clip.mov', size: 9_000_000, progress: 10, status: 'uploading' });
    rememberActiveJob('convert', 'image', 'job-1');

    const persisted = [...local.map.values(), ...session.map.values()].join('|');
    expect(persisted).not.toContain('clip.mov');
    expect(persisted).not.toContain('input.png');
    expect(persisted).not.toContain('convert');
  });

  it('degrades to memory when storage is unavailable instead of throwing', async () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    resetStore();

    await expect(hydrate()).resolves.toBeTruthy();
    expect(() => rememberActiveJob('convert', 'image', 'job-1')).not.toThrow();
    expect(readActiveJobId('convert', 'image')).toBe('job-1');
  });
});

describe('workspace is never silently replaced (SPEC §6.5 item 5)', () => {
  it('surfaces a persistent error and keeps the id when recovery fails', async () => {
    vi.useFakeTimers();
    local.setItem(WORKSPACE_ID_KEY, 'ws-existing');
    recoverWorkspace.mockRejectedValue(new Error('Network down'));

    await hydrate();

    const state = getSnapshot();
    expect(state.status).toBe('error');
    expect(state.error?.message).toContain('Network down');
    expect(local.getItem(WORKSPACE_ID_KEY)).toBe('ws-existing');
    expect(createWorkspaceCall).not.toHaveBeenCalled();
  });

  it('retries on its own and recovers the SAME workspace', async () => {
    vi.useFakeTimers();
    local.setItem(WORKSPACE_ID_KEY, 'ws-existing');
    recoverWorkspace.mockRejectedValueOnce(new Error('Network down'));
    recoverWorkspace.mockResolvedValue(snapshotBody({ id: 'ws-existing' }));

    await hydrate();
    expect(getSnapshot().status).toBe('error');

    await vi.advanceTimersByTimeAsync(5_000);

    expect(getSnapshot().status).toBe('ready');
    expect(getSnapshot().workspaceId).toBe('ws-existing');
    expect(createWorkspaceCall).not.toHaveBeenCalled();
  });

  it('offers an explicit retry action', async () => {
    vi.useFakeTimers();
    recoverWorkspace.mockRejectedValueOnce(new Error('Network down'));
    await hydrate();
    recoverWorkspace.mockResolvedValue(snapshotBody());

    await retryHydrate();

    expect(getSnapshot().status).toBe('ready');
  });

  it('creates a replacement workspace ONLY through the explicit action', async () => {
    createWorkspaceCall.mockResolvedValue({ id: 'ws-new' });
    getWorkspaceCall.mockResolvedValue(snapshotBody({ id: 'ws-new', jobs: [], files: [] }));

    await createWorkspace({ route: 'convert' });

    expect(createWorkspaceCall).toHaveBeenCalledTimes(1);
    expect(getSnapshot().workspaceId).toBe('ws-new');
    expect(local.getItem(WORKSPACE_ID_KEY)).toBe('ws-new');
  });
});

describe('job-resume pointer (SPEC §6.5 item 2)', () => {
  it('round-trips a pointer per hub+mode across a reload', async () => {
    await hydrate();
    rememberActiveJob('convert', 'image', 'job-1');

    resetStore(); // the reload
    await hydrate();

    expect(resolveActiveJob('convert', 'image', 'convert')?.id).toBe('job-1');
  });

  it('drops a pointer whose job is of the wrong type', async () => {
    await hydrate();
    rememberActiveJob('pdf', 'organize', 'job-1'); // job-1 is type 'convert'

    expect(resolveActiveJob('pdf', 'organize', 'pdf')).toBeNull();
    expect(readActiveJobId('pdf', 'organize')).toBeNull();
  });

  it('drops a pointer whose job the server no longer reports', async () => {
    await hydrate();
    rememberActiveJob('convert', 'image', 'job-gone');

    expect(resolveActiveJob('convert', 'image', 'convert')).toBeNull();
    expect(readActiveJobId('convert', 'image')).toBeNull();
  });

  it('keeps hub+mode pointers independent and forgettable', async () => {
    await hydrate();
    rememberActiveJob('convert', 'image', 'job-1');
    rememberActiveJob('convert', 'document', 'job-1');
    forgetActiveJob('convert', 'image');

    expect(readActiveJobId('convert', 'image')).toBeNull();
    expect(readActiveJobId('convert', 'document')).toBe('job-1');
  });
});

describe('composed progress (SPEC §2.2, monotonic per §6.3)', () => {
  it('maps upload to 0–30 before any job exists', async () => {
    recoverWorkspace.mockResolvedValue(snapshotBody({ jobs: [], files: [] }));
    await hydrate();
    optimisticUpload({ clientId: 'c1', name: 'clip.mov', size: 100, progress: 50, status: 'uploading' });

    expect(selectComposedProgress(getSnapshot(), 'c1')).toBe(15);
  });

  it('sits at 30 for an uploaded file with no job yet', async () => {
    recoverWorkspace.mockResolvedValue(snapshotBody({ jobs: [] }));
    await hydrate();

    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(30);
  });

  it('maps job execution to 30–99 and caps below 100 until completion', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto({ status: 'running', progress: 50 })] }),
    );
    await hydrate();
    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(65);

    applyEvent({
      type: 'job.progress',
      workspaceId: 'ws-1',
      jobId: 'job-1',
      status: 'running',
      progress: 99,
      updatedAt: iso(4),
      epoch: 'epoch-1',
      seq: 7,
      job: jobDto({ status: 'running', progress: 99, updatedAt: iso(4) }),
    });
    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(99);
  });

  it('reaches 100 only on completion', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto({ status: 'completed', progress: 100, finishedAt: iso(2) })] }),
    );
    await hydrate();

    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(100);
  });

  it('never regresses the displayed value within one attempt', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto({ status: 'running', progress: 80 })] }),
    );
    await hydrate();
    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(86);

    applyEvent({
      type: 'job.updated',
      workspaceId: 'ws-1',
      jobId: 'job-1',
      status: 'failed',
      progress: 0,
      updatedAt: iso(6),
      epoch: 'epoch-1',
      seq: 9,
      job: jobDto({ status: 'failed', progress: 0, error: 'boom', updatedAt: iso(6) }),
    });

    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(86);
  });

  it('restarts at the upload floor when a retry creates a new attempt', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto({ status: 'failed', progress: 90, finishedAt: iso(2) })] }),
    );
    await hydrate();
    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(93);

    applyEvent({
      type: 'job.created',
      workspaceId: 'ws-1',
      jobId: 'job-2',
      status: 'queued',
      progress: 0,
      updatedAt: iso(7),
      epoch: 'epoch-1',
      seq: 9,
      job: jobDto({ id: 'job-2', status: 'queued', progress: 0, createdAt: iso(7), updatedAt: iso(7) }),
    });

    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(30);
  });

  it('averages the batch for the run bar', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({
        files: [fileDto(), fileDto({ id: 'file-2', originalName: 'b.png' })],
        jobs: [jobDto({ status: 'completed', progress: 100, finishedAt: iso(2) })],
      }),
    );
    await hydrate();

    // file-1 completed (100), file-2 uploaded with no job (30) → mean 65.
    expect(selectRunProgress(getSnapshot(), ['file-1', 'file-2'])).toBe(65);
  });
});

describe('workspace mirror upkeep', () => {
  it('removes a deleted file instead of resurrecting a ghost row', async () => {
    await hydrate();
    applyEvent({
      type: 'file.deleted',
      workspaceId: 'ws-1',
      fileId: 'file-1',
      status: 'deleted',
      message: 'File removed',
      updatedAt: iso(4),
      epoch: 'epoch-1',
      seq: 7,
    });

    expect(selectFile(getSnapshot(), 'file-1')).toBeNull();
  });

  it('mirrors upload sessions reported by the server', async () => {
    await hydrate();
    setUploadSessions([
      {
        id: 'sess-1',
        workspaceId: 'ws-1',
        originalName: 'big.mp4',
        size: 40_000_000,
        receivedBytes: 8_000_000,
        status: 'paused',
        updatedAt: iso(3),
      },
    ]);

    const sessions = getSnapshot().uploadSessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe('paused');
    expect(sessions[0]?.receivedBytes).toBe(8_000_000);
  });

  it('reports active and queued jobs for the resume strip (§2.5)', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({
        jobs: [
          jobDto({ id: 'job-1', status: 'running' }),
          jobDto({ id: 'job-2', status: 'queued' }),
          jobDto({ id: 'job-3', status: 'completed', finishedAt: iso(2) }),
        ],
      }),
    );
    await hydrate();

    expect(selectActiveJobs(getSnapshot()).map((j) => j.id)).toEqual(['job-1', 'job-2']);
  });
});

describe('module boundaries (SPEC §3.1, §3.2)', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../protocol/store.ts', import.meta.url)),
    'utf8',
  );

  it('imports no React and no component', () => {
    expect(source).not.toMatch(/from\s+['"]react['"]/);
    expect(source).not.toMatch(/from\s+['"]\.\.\/components\//);
  });

  it('opens no network connection of its own — all HTTP goes through api/client.js', () => {
    expect(source).not.toMatch(/\bnew EventSource\b/);
    expect(source).not.toMatch(/\bnew XMLHttpRequest\b/);
    expect(source).not.toMatch(/(?<!\/\/[^\n]*)\bfetch\s*\(/);
  });
});
