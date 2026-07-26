/**
 * Merge-semantics suite for `src/protocol/store.ts` (PLAN B2, SPEC §6.3).
 *
 * Written BEFORE the merge implementation (PLAN B2 characterization row): the
 * modules this store supersedes — `lib/liveState.js`, `hooks/useJobRunner.js`,
 * `hooks/useWorkspace.js` — have no tests at all, so SPEC §6 is the only
 * contract, and it is pinned here.
 *
 * The list is SPEC §7.2's: epoch change, seq regression, monotonic progress,
 * terminal immutability, optimistic overlay. Each case is written as the
 * hazard it kills, not as a description of the code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { recoverWorkspace, createWorkspaceCall } = vi.hoisted(() => ({
  recoverWorkspace: vi.fn(),
  createWorkspaceCall: vi.fn(),
}));

vi.mock('../api/client.js', () => ({
  api: {
    recoverWorkspace,
    createWorkspace: createWorkspaceCall,
    getWorkspace: vi.fn(),
  },
}));

const {
  applyEvent,
  applyPoll,
  getSnapshot,
  hydrate,
  isRequested,
  optimisticRequest,
  optimisticUpload,
  resolveOptimisticUpload,
  resolveRequest,
  resetStore,
  selectFile,
  selectJob,
  subscribe,
} = await import('../protocol/store.js');

/* ---------------------------------------------------------------- *
 * Fixtures — shaped exactly like the server DTOs this store merges:
 * `jobPublicDto` / `filePublic` / `versionedSnapshot` (A2).
 * ---------------------------------------------------------------- */

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

/** A workspace SSE envelope exactly as `emitWorkspaceEvent` mints it (A2). */
function jobEvent(overrides: Record<string, unknown> = {}) {
  const job = overrides.job === undefined ? jobDto() : overrides.job;
  return {
    type: 'job.progress',
    workspaceId: 'ws-1',
    jobId: 'job-1',
    status: (job as { status?: string } | null)?.status ?? 'running',
    stage: null,
    progress: (job as { progress?: number } | null)?.progress ?? 0,
    message: null,
    updatedAt: iso(2),
    version: 1,
    epoch: 'epoch-1',
    seq: 7,
    ...overrides,
    job,
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
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
  recoverWorkspace.mockResolvedValue(snapshotBody());
  resetStore();
});

afterEach(() => {
  resetStore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('store hydrate — the baseline every merge case starts from', () => {
  it('mirrors the snapshot and adopts its (epoch, seq)', async () => {
    await hydrate({ route: 'convert' });
    const state = getSnapshot();
    expect(state.status).toBe('ready');
    expect(state.workspaceId).toBe('ws-1');
    expect(state.epoch).toBe('epoch-1');
    expect(state.seq).toBe(5);
    expect(state.jobs).toHaveLength(1);
    expect(state.files).toHaveLength(1);
  });

  it('never mirrors activity — §3.2 makes it a view concern, not store state', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ activity: [{ id: 'a1', jobId: 'job-1', tool: 't', action: 'a', status: 's' }] }),
    );
    await hydrate();
    expect(Object.keys(getSnapshot())).not.toContain('activity');
  });
});

describe('epoch change (SPEC §6.3, §6.4)', () => {
  it('adopts the new epoch, drops ordering state and re-hydrates wholesale', async () => {
    await hydrate();
    expect(recoverWorkspace).toHaveBeenCalledTimes(1);

    // A restarted server mints a new epoch and restarts seq at 1. Under the old
    // ordering state that seq=1 would look ancient and every event would be
    // dropped — the wedge §6.4 exists to kill.
    recoverWorkspace.mockResolvedValue(
      snapshotBody({
        epoch: 'epoch-2',
        seq: 1,
        jobs: [jobDto({ progress: 55, updatedAt: iso(5) })],
      }),
    );
    applyEvent(jobEvent({ epoch: 'epoch-2', seq: 1, job: jobDto({ progress: 55, updatedAt: iso(5) }) }));

    expect(getSnapshot().epoch).toBe('epoch-2');
    await vi.waitFor(() => expect(recoverWorkspace).toHaveBeenCalledTimes(2));
    expect(selectJob(getSnapshot(), 'job-1')?.progress).toBe(55);
  });

  it('does not stack a re-hydrate per event once the new epoch is adopted', async () => {
    await hydrate();
    recoverWorkspace.mockResolvedValue(snapshotBody({ epoch: 'epoch-2', seq: 3 }));

    applyEvent(jobEvent({ epoch: 'epoch-2', seq: 1 }));
    applyEvent(jobEvent({ epoch: 'epoch-2', seq: 2 }));
    applyEvent(jobEvent({ epoch: 'epoch-2', seq: 3 }));

    await vi.waitFor(() => expect(recoverWorkspace).toHaveBeenCalledTimes(2));
    expect(recoverWorkspace).toHaveBeenCalledTimes(2);
  });

  it('keeps live rows that overtook an in-flight hydrate response', async () => {
    await hydrate();
    // Event at seq 9 creates a job the seq-5 snapshot never knew about.
    applyEvent(
      jobEvent({
        seq: 9,
        jobId: 'job-late',
        job: jobDto({ id: 'job-late', progress: 10, updatedAt: iso(9) }),
      }),
    );
    // A late re-hydrate response carrying the OLD snapshot must not erase it.
    recoverWorkspace.mockResolvedValue(snapshotBody({ seq: 5 }));
    await hydrate();

    expect(selectJob(getSnapshot(), 'job-late')?.progress).toBe(10);
  });

  it('drops rows the authoritative snapshot no longer contains', async () => {
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto(), jobDto({ id: 'job-2', updatedAt: iso(1) })] }),
    );
    await hydrate();
    expect(getSnapshot().jobs).toHaveLength(2);

    recoverWorkspace.mockResolvedValue(snapshotBody({ seq: 12, jobs: [jobDto({ updatedAt: iso(3) })] }));
    await hydrate();

    expect(getSnapshot().jobs).toHaveLength(1);
    expect(selectJob(getSnapshot(), 'job-2')).toBeNull();
  });
});

describe('seq regression (SPEC §6.3)', () => {
  it('discards a lower seq in the same epoch even when it carries higher progress', async () => {
    await hydrate();
    applyEvent(jobEvent({ seq: 7, job: jobDto({ progress: 60, updatedAt: iso(2) }) }));
    expect(selectJob(getSnapshot(), 'job-1')?.progress).toBe(60);

    // Out-of-order delivery: seq 6 is older than what the row already applied.
    // Only the version gate can reject it — its progress is HIGHER.
    applyEvent(jobEvent({ seq: 6, job: jobDto({ progress: 80, updatedAt: iso(3) }) }));

    expect(selectJob(getSnapshot(), 'job-1')?.progress).toBe(60);
  });

  it('discards an event older than the snapshot that seeded the row', async () => {
    await hydrate(); // snapshot seq = 5
    applyEvent(jobEvent({ seq: 4, job: jobDto({ progress: 90, status: 'running', updatedAt: iso(4) }) }));
    expect(selectJob(getSnapshot(), 'job-1')?.progress).toBe(0);
  });

  it('does not notify subscribers when a write is discarded', async () => {
    await hydrate();
    applyEvent(jobEvent({ seq: 7, job: jobDto({ progress: 60 }) }));

    const listener = vi.fn();
    const before = getSnapshot();
    const unsubscribe = subscribe(listener);
    applyEvent(jobEvent({ seq: 6, job: jobDto({ progress: 80 }) }));

    expect(listener).not.toHaveBeenCalled();
    expect(getSnapshot()).toBe(before);
    unsubscribe();
  });
});

describe('poll and SSE cannot regress each other (SPEC §6.3)', () => {
  it('discards a poll payload older than the row (row-level updatedAt fallback)', async () => {
    await hydrate();
    applyEvent(jobEvent({ seq: 7, job: jobDto({ progress: 60, status: 'running', updatedAt: iso(4) }) }));

    // The pre-rebuild poll path skipped the version gate entirely (F2-H2/F3-H6/
    // F3-H7): this stale poll would have reset the row to queued/20.
    applyPoll({ jobs: [jobDto({ progress: 20, status: 'queued', updatedAt: iso(2) })] });

    const job = selectJob(getSnapshot(), 'job-1');
    expect(job?.progress).toBe(60);
    expect(job?.status).toBe('running');
  });

  it('accepts a poll payload newer than the row', async () => {
    await hydrate();
    applyEvent(jobEvent({ seq: 7, job: jobDto({ progress: 60, updatedAt: iso(4) }) }));
    applyPoll({ jobs: [jobDto({ progress: 75, updatedAt: iso(6) })] });

    expect(selectJob(getSnapshot(), 'job-1')?.progress).toBe(75);
  });

  it('does not let a stale SSE event regress a newer poll result', async () => {
    await hydrate();
    applyPoll({ jobs: [jobDto({ progress: 80, updatedAt: iso(8) })] });
    applyEvent(jobEvent({ seq: 6, job: jobDto({ progress: 30, updatedAt: iso(3) }) }));

    expect(selectJob(getSnapshot(), 'job-1')?.progress).toBe(80);
  });
});

describe('monotonic progress (SPEC §6.3, §6.5 item 3)', () => {
  it('never lowers progress within one attempt', async () => {
    await hydrate();
    applyEvent(jobEvent({ seq: 7, job: jobDto({ progress: 60, updatedAt: iso(4) }) }));
    applyEvent(jobEvent({ seq: 8, job: jobDto({ progress: 45, updatedAt: iso(5) }) }));

    expect(selectJob(getSnapshot(), 'job-1')?.progress).toBe(60);
  });

  it('still applies the rest of a newer write whose progress regressed', async () => {
    await hydrate();
    applyEvent(jobEvent({ seq: 7, job: jobDto({ progress: 60, updatedAt: iso(4) }) }));
    // A failure event commonly reports progress 0 — the status must land even
    // though the number is dropped, or the row wedges at "running" forever.
    applyEvent(
      jobEvent({
        seq: 8,
        status: 'failed',
        job: jobDto({ progress: 0, status: 'failed', error: 'boom', updatedAt: iso(5) }),
      }),
    );

    const job = selectJob(getSnapshot(), 'job-1');
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('boom');
    expect(job?.progress).toBe(60);
  });

  it('starts a retry attempt at 0 — the floor is per job row, not per input', async () => {
    await hydrate();
    applyEvent(jobEvent({ seq: 7, job: jobDto({ progress: 60, updatedAt: iso(4) }) }));
    applyEvent(
      jobEvent({
        seq: 8,
        jobId: 'job-2',
        job: jobDto({ id: 'job-2', progress: 0, status: 'queued', updatedAt: iso(5) }),
      }),
    );

    expect(selectJob(getSnapshot(), 'job-2')?.progress).toBe(0);
    expect(selectJob(getSnapshot(), 'job-1')?.progress).toBe(60);
  });

  it('keeps upload progress monotonic on optimistic file rows', async () => {
    await hydrate();
    optimisticUpload({ clientId: 'c1', name: 'big.mp4', size: 10, progress: 70, status: 'uploading' });
    optimisticUpload({ clientId: 'c1', name: 'big.mp4', size: 10, progress: 40, status: 'uploading' });

    expect(selectFile(getSnapshot(), 'c1')?.uploadProgress).toBe(70);
  });
});

describe('terminal immutability (SPEC §6.3)', () => {
  it('discards a late progress event for a completed job', async () => {
    await hydrate();
    applyEvent(
      jobEvent({
        seq: 7,
        status: 'completed',
        job: jobDto({ status: 'completed', progress: 100, finishedAt: iso(4), updatedAt: iso(4) }),
      }),
    );
    applyEvent(jobEvent({ seq: 8, job: jobDto({ status: 'running', progress: 50, updatedAt: iso(5) }) }));

    const job = selectJob(getSnapshot(), 'job-1');
    expect(job?.status).toBe('completed');
    expect(job?.progress).toBe(100);
  });

  it('refuses a second terminal status — cancelled never becomes completed', async () => {
    await hydrate();
    applyEvent(
      jobEvent({
        seq: 7,
        status: 'cancelled',
        job: jobDto({ status: 'cancelled', progress: 30, finishedAt: iso(4), updatedAt: iso(4) }),
      }),
    );
    applyEvent(
      jobEvent({
        seq: 8,
        status: 'completed',
        job: jobDto({ status: 'completed', progress: 100, updatedAt: iso(5) }),
      }),
    );

    expect(selectJob(getSnapshot(), 'job-1')?.status).toBe('cancelled');
  });

  it('still merges late enrichment of a terminal row (result metadata)', async () => {
    await hydrate();
    applyEvent(
      jobEvent({
        seq: 7,
        status: 'completed',
        job: jobDto({ status: 'completed', progress: 100, updatedAt: iso(4) }),
      }),
    );
    applyPoll({
      jobs: [
        jobDto({
          status: 'completed',
          progress: 100,
          downloadUrl: '/api/jobs/job-1/download',
          outputName: 'out.pdf',
          updatedAt: iso(6),
        }),
      ],
    });

    const job = selectJob(getSnapshot(), 'job-1');
    expect(job?.downloadUrl).toBe('/api/jobs/job-1/download');
    expect(job?.outputName).toBe('out.pdf');
    expect(job?.status).toBe('completed');
  });
});

describe('optimistic overlay (SPEC §6.2)', () => {
  it('shows a local-only upload row before the server knows the file', async () => {
    await hydrate();
    optimisticUpload({ clientId: 'c1', name: 'clip.mov', size: 9_000_000, progress: 12, status: 'uploading' });

    const row = selectFile(getSnapshot(), 'c1');
    expect(row?.localOnly).toBe(true);
    expect(row?.originalName).toBe('clip.mov');
    expect(row?.uploadProgress).toBe(12);
  });

  it('re-applies the overlay on top after a wholesale re-hydrate', async () => {
    await hydrate();
    optimisticUpload({ clientId: 'c1', name: 'clip.mov', size: 9_000_000, progress: 12, status: 'uploading' });
    await hydrate();

    expect(selectFile(getSnapshot(), 'c1')?.uploadProgress).toBe(12);
  });

  it('collapses to exactly one row when the server file arrives', async () => {
    await hydrate();
    optimisticUpload({ clientId: 'c1', name: 'clip.mov', size: 9_000_000, progress: 99, status: 'uploading' });
    applyEvent({
      type: 'file.created',
      workspaceId: 'ws-1',
      fileId: 'file-2',
      status: 'ready',
      updatedAt: iso(4),
      epoch: 'epoch-1',
      seq: 7,
      file: fileDto({ id: 'file-2', originalName: 'clip.mov' }),
    });
    resolveOptimisticUpload('c1', 'file-2');

    const state = getSnapshot();
    expect(selectFile(state, 'c1')).toBeNull();
    expect(state.files.filter((f) => f.originalName === 'clip.mov')).toHaveLength(1);
  });

  it('flags a requested cancel without patching the job status', async () => {
    await hydrate();
    applyEvent(jobEvent({ seq: 7, job: jobDto({ status: 'running', progress: 40, updatedAt: iso(4) }) }));
    optimisticRequest('cancel', 'job-1');

    expect(isRequested(getSnapshot(), 'cancel', 'job-1')).toBe(true);
    // §6.2: the client never patches job status — it requests, the server decides.
    expect(selectJob(getSnapshot(), 'job-1')?.status).toBe('running');
  });

  it('refuses an optimistic flag on a server-terminal job', async () => {
    await hydrate();
    applyEvent(
      jobEvent({
        seq: 7,
        status: 'completed',
        job: jobDto({ status: 'completed', progress: 100, updatedAt: iso(4) }),
      }),
    );
    optimisticRequest('cancel', 'job-1');

    expect(isRequested(getSnapshot(), 'cancel', 'job-1')).toBe(false);
  });

  it('clears the flag when the server response resolves it', async () => {
    await hydrate();
    const key = optimisticRequest('cancel', 'job-1');
    resolveRequest(key);

    expect(isRequested(getSnapshot(), 'cancel', 'job-1')).toBe(false);
  });

  it('clears the flag when the job reaches a terminal state', async () => {
    await hydrate();
    optimisticRequest('cancel', 'job-1');
    applyEvent(
      jobEvent({
        seq: 7,
        status: 'cancelled',
        job: jobDto({ status: 'cancelled', progress: 40, updatedAt: iso(4) }),
      }),
    );

    expect(isRequested(getSnapshot(), 'cancel', 'job-1')).toBe(false);
  });

  it('times the flag out when no response ever arrives', async () => {
    vi.useFakeTimers();
    await hydrate();
    optimisticRequest('cancel', 'job-1');
    expect(isRequested(getSnapshot(), 'cancel', 'job-1')).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(isRequested(getSnapshot(), 'cancel', 'job-1')).toBe(false);
  });
});
