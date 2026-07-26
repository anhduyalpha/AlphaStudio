/**
 * Regression suite for `src/protocol/store.ts` (PLAN B2).
 *
 * One describe per defect the unit's spec review confirmed. Each was reachable
 * from an ordinary user path, none was covered by the two suites written with
 * the implementation, and each is written here as the hazard it kills:
 *
 *  1. §6.5 item 3 / §2.2 — a successful retry lost ownership of its file back
 *     to the failed attempt, so the composed value fell off 99 and never hit 100.
 *  2. §6.4 — the in-flight-load flag could strand, permanently disabling every
 *     later epoch resync.
 *  3. §6.3 — a removed row left no recorded position, so a provably older write
 *     resurrected it.
 *  4. §6.4 — `applySnapshot` adopted a new epoch but kept the OLD epoch's `seq`.
 *
 * Note for the §6.4 cases: `applyEvent` only treats an epoch as *changed* when
 * the store already holds one, so every one of them hydrates first to establish
 * `epoch-1`. An event carrying a first-ever epoch takes a different branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  applyEvent,
  applyPoll,
  createWorkspace,
  getSnapshot,
  hydrate,
  resetStore,
  selectComposedProgress,
  selectFile,
  selectRunProgress,
} = await import('../protocol/store.js');

const iso = (minute: number): string => new Date(Date.UTC(2026, 6, 26, 12, minute, 0)).toISOString();

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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
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

/** Drive a retry attempt over `file-1` from queued to the given terminal state. */
function runRetry(finalStatus: string, finalProgress: number): void {
  const retry = (status: string, progress: number, seq: number, minute: number) =>
    applyEvent({
      type: status === 'queued' ? 'job.created' : 'job.updated',
      workspaceId: 'ws-1',
      jobId: 'job-2',
      status,
      progress,
      updatedAt: iso(minute),
      epoch: 'epoch-1',
      seq,
      job: jobDto({
        id: 'job-2',
        status,
        progress,
        createdAt: iso(7),
        updatedAt: iso(minute),
        finishedAt: status === 'completed' || status === 'failed' ? iso(minute) : null,
      }),
    });

  retry('queued', 0, 9, 7);
  retry('running', 98, 10, 8);
  retry(finalStatus, finalProgress, 11, 9);
}

describe('a successful retry keeps ownership of its file (§6.5 item 3, §2.2)', () => {
  it('reaches 100 rather than falling back to the failed attempt', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto({ status: 'failed', progress: 0, finishedAt: iso(2) })] }),
    );
    await hydrate();
    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(30);

    runRetry('completed', 100);

    // Ranking `completed` below `failed` handed file-1 back to job-1 here: the
    // composed value dropped 99 -> 30 and could never reach 100.
    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(100);
    expect(selectFile(getSnapshot(), 'file-1')?.jobId).toBe('job-2');
    expect(selectRunProgress(getSnapshot(), ['file-1'])).toBe(100);
  });

  it('does not hand the file back to a cancelled predecessor either', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto({ status: 'cancelled', progress: 12, finishedAt: iso(2) })] }),
    );
    await hydrate();

    runRetry('completed', 100);

    expect(selectComposedProgress(getSnapshot(), 'file-1')).toBe(100);
    expect(selectFile(getSnapshot(), 'file-1')?.jobId).toBe('job-2');
  });

  it('still lets the newest attempt own the file when the retry also fails', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto({ status: 'failed', progress: 0, finishedAt: iso(2) })] }),
    );
    await hydrate();

    runRetry('failed', 40);

    expect(selectFile(getSnapshot(), 'file-1')?.jobId).toBe('job-2');
  });
});

describe('the in-flight-load flag is always released (§6.4)', () => {
  const epochChange = () =>
    applyEvent({
      type: 'job.updated',
      workspaceId: 'ws-1',
      jobId: 'job-1',
      status: 'running',
      progress: 10,
      updatedAt: iso(20),
      epoch: 'epoch-2',
      seq: 1,
      job: jobDto({ status: 'running', progress: 10, updatedAt: iso(20) }),
    });

  it('releases it when createWorkspace overtakes an in-flight hydrate', async () => {
    let settle: (value: unknown) => void = () => {};
    recoverWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const inFlight = hydrate();

    createWorkspaceCall.mockResolvedValue({ id: 'ws-2' });
    getWorkspaceCall.mockResolvedValue(snapshotBody({ id: 'ws-2' }));
    await createWorkspace();

    settle(snapshotBody());
    await inFlight;

    // With a plain boolean cleared only by the generation-owning hydrate, the
    // flag stranded at true here and every later resync was swallowed.
    const before = recoverWorkspace.mock.calls.length;
    epochChange();
    expect(recoverWorkspace.mock.calls.length).toBe(before + 1);
  });

  it('replays a resync that arrived while a hydrate was in flight', async () => {
    await hydrate(); // establishes epoch-1, so epoch-2 below reads as a CHANGE

    let settle: (value: unknown) => void = () => {};
    recoverWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const inFlight = hydrate();

    epochChange();
    const during = recoverWorkspace.mock.calls.length;

    settle(snapshotBody());
    await inFlight;

    // The suppressed resync is not dropped: the load in flight was issued
    // before the epoch changed, so its payload may predate it.
    expect(recoverWorkspace.mock.calls.length).toBe(during + 1);
  });

  it('releases it when workspace creation throws', async () => {
    await hydrate(); // establishes epoch-1

    createWorkspaceCall.mockRejectedValue(new Error('offline'));
    await expect(createWorkspace()).rejects.toThrow('offline');

    const before = recoverWorkspace.mock.calls.length;
    epochChange();
    expect(recoverWorkspace.mock.calls.length).toBe(before + 1);
  });
});

describe('a removed row keeps its position (§6.3)', () => {
  it('refuses to resurrect a deleted file from an older write', async () => {
    await hydrate();
    expect(selectFile(getSnapshot(), 'file-1')).toBeTruthy();

    applyPoll({
      epoch: 'epoch-1',
      seq: 10,
      files: [fileDto({ status: 'deleted', updatedAt: iso(10) })],
    });
    expect(selectFile(getSnapshot(), 'file-1')).toBeFalsy();

    // Older than the delete — dropping the version along with the row let this
    // through, because the merge gate only ran `if (prev)`.
    applyPoll({
      epoch: 'epoch-1',
      seq: 7,
      files: [fileDto({ updatedAt: iso(7) })],
    });
    expect(selectFile(getSnapshot(), 'file-1')).toBeFalsy();
  });

  it('still accepts a genuinely newer write for the same id', async () => {
    await hydrate();
    applyPoll({
      epoch: 'epoch-1',
      seq: 10,
      files: [fileDto({ status: 'deleted', updatedAt: iso(10) })],
    });

    applyPoll({
      epoch: 'epoch-1',
      seq: 12,
      files: [fileDto({ updatedAt: iso(12) })],
    });
    expect(selectFile(getSnapshot(), 'file-1')).toBeTruthy();
  });

  it('does not let a stale row survive a snapshot that dropped it', async () => {
    await hydrate();
    recoverWorkspace.mockResolvedValue(snapshotBody({ files: [], jobs: [], seq: 20 }));
    await hydrate();
    expect(selectFile(getSnapshot(), 'file-1')).toBeFalsy();

    applyPoll({
      epoch: 'epoch-1',
      seq: 15,
      files: [fileDto({ updatedAt: iso(15) })],
    });
    expect(selectFile(getSnapshot(), 'file-1')).toBeFalsy();
  });
});

describe('a snapshot adopts its epoch AND its seq (§6.4)', () => {
  it('takes the new epoch position instead of carrying the old one forward', async () => {
    await hydrate();
    expect(getSnapshot().epoch).toBe('epoch-1');
    expect(getSnapshot().seq).toBe(5);

    recoverWorkspace.mockResolvedValue(snapshotBody({ epoch: 'epoch-2', seq: 2 }));
    await hydrate();

    // `state.epoch` was reassigned before the comparison, so the reset branch
    // was unreachable and the store kept the old epoch's 5.
    expect(getSnapshot().epoch).toBe('epoch-2');
    expect(getSnapshot().seq).toBe(2);
  });

  it('keeps taking the high-water mark within one epoch', async () => {
    await hydrate();
    recoverWorkspace.mockResolvedValue(snapshotBody({ seq: 3 }));
    await hydrate();
    expect(getSnapshot().seq).toBe(5);
  });
});
