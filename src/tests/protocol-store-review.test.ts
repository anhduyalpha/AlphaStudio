/**
 * Second regression suite for `src/protocol/store.ts` (PLAN B2) — the findings
 * from the spec review of the *fixed* diff. Each is written as the hazard it
 * kills:
 *
 *  1. §6.4 / §6.5 item 4 — a first-seen epoch was adopted silently, so a cold
 *     boot that raced a server restart wedged on the dead epoch forever.
 *  2. §6.3 — a delete tombstone accepted a TIE, so an in-flight poll carrying
 *     the row exactly as it died put it back on screen.
 *  3. §6.4 — a failed `createWorkspace` discarded a suppressed epoch resync
 *     instead of replaying it.
 *  4. §6.5 item 2 — resolving the resume pointer before hydrate erased it, so
 *     a reload never re-attached to a job the server was still running.
 *  5. §6.2 — `delete`/`convert` flags were refused on terminal rows, which is
 *     exactly where those two buttons live.
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
  isRequested,
  optimisticRequest,
  readActiveJobId,
  rememberActiveJob,
  resetStore,
  resolveActiveJob,
  selectFile,
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

/** An envelope carrying `epoch`, used to drive the §6.4 branches. */
const eventAt = (epoch: string, seq: number) => ({
  type: 'job.updated',
  workspaceId: 'ws-1',
  jobId: 'job-1',
  status: 'running',
  progress: 10,
  updatedAt: iso(20),
  epoch,
  seq,
  job: jobDto({ status: 'running', progress: 10, updatedAt: iso(20) }),
});

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

describe('an unknown epoch is treated like a changed one (§6.4, §6.5 item 4)', () => {
  it('requests a re-hydrate for a first-seen epoch instead of adopting it silently', () => {
    expect(recoverWorkspace).not.toHaveBeenCalled();

    applyEvent(eventAt('epoch-1', 3));

    expect(getSnapshot().epoch).toBe('epoch-1');
    expect(recoverWorkspace).toHaveBeenCalledTimes(1);
  });

  it('recovers when a pre-restart snapshot lands after the stream moved on', async () => {
    let settle: (value: unknown) => void = () => {};
    recoverWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const inFlight = hydrate(); // issued against the pre-restart process

    // The reconnected stream reports the POST-restart epoch while the first
    // snapshot is still in flight, so the store has no epoch of its own yet.
    applyEvent(eventAt('epoch-2', 1));
    expect(recoverWorkspace).toHaveBeenCalledTimes(1); // suppressed, not dropped

    settle(snapshotBody()); // the stale epoch-1 snapshot finally lands
    await inFlight;

    // Silently adopting epoch-2 left nothing to disagree with the stale
    // snapshot, and on an idle workspace no further event ever arrived.
    expect(recoverWorkspace).toHaveBeenCalledTimes(2);
  });
});

describe('a tombstone is not beaten by a tie (§6.3)', () => {
  it('refuses an unversioned poll carrying the row exactly as it died', async () => {
    await hydrate();
    expect(selectFile(getSnapshot(), 'file-1')).toBeTruthy();

    // A snapshot prunes the row; its tombstone keeps the row's own last time.
    recoverWorkspace.mockResolvedValue(snapshotBody({ files: [], jobs: [], seq: 20 }));
    await hydrate();
    expect(selectFile(getSnapshot(), 'file-1')).toBeFalsy();

    // A poll issued before the delete, carrying the row unchanged. It has no
    // epoch/seq, so only `updatedAt` can order it — and it ties.
    applyPoll({ files: [fileDto({ updatedAt: iso(0) })] });

    expect(selectFile(getSnapshot(), 'file-1')).toBeFalsy();
  });
});

describe('a suppressed resync survives workspace creation (§6.4)', () => {
  it('replays it when creation throws', async () => {
    await hydrate();
    let fail: (reason?: unknown) => void = () => {};
    createWorkspaceCall.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    const creating = createWorkspace();
    applyEvent(eventAt('epoch-2', 1)); // suppressed while the create is in flight
    fail(new Error('offline'));
    await expect(creating).rejects.toThrow('offline');

    // Nothing landed, so the epoch change still needs its re-hydrate.
    expect(recoverWorkspace).toHaveBeenCalledTimes(2);
  });

  it('treats it as satisfied when creation succeeded', async () => {
    await hydrate();
    let finish: (value: unknown) => void = () => {};
    createWorkspaceCall.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    getWorkspaceCall.mockResolvedValue(snapshotBody({ id: 'ws-2' }));

    const creating = createWorkspace();
    applyEvent(eventAt('epoch-2', 1));
    finish({ id: 'ws-2' });
    await creating;

    // The freshly created workspace's snapshot already carries server truth.
    expect(recoverWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe('the resume pointer survives a pre-hydrate read (§6.5 item 2)', () => {
  it('does not forget a pointer just because the mirror is still empty', async () => {
    rememberActiveJob('convert', 'image', 'job-1');

    // The natural place to resolve is a mount effect, which runs before the
    // first snapshot lands. This used to erase the pointer outright.
    expect(resolveActiveJob('convert', 'image', 'convert')).toBeNull();
    expect(readActiveJobId('convert', 'image')).toBe('job-1');

    await hydrate();
    expect(resolveActiveJob('convert', 'image', 'convert')?.id).toBe('job-1');
  });
});

describe('optimistic flags on a finished row (§6.2)', () => {
  const completed = () =>
    recoverWorkspace.mockResolvedValue(
      snapshotBody({ jobs: [jobDto({ status: 'completed', progress: 100, finishedAt: iso(2) })] }),
    );

  it('records delete and convert, the two actions a finished row offers', async () => {
    completed();
    await hydrate();

    optimisticRequest('convert', 'job-1');
    optimisticRequest('delete', 'job-1');

    // Refusing these left the button with no busy state, so a second click
    // started a second attempt the server could not dedupe.
    expect(isRequested(getSnapshot(), 'convert', 'job-1')).toBe(true);
    expect(isRequested(getSnapshot(), 'delete', 'job-1')).toBe(true);
  });

  it('still refuses cancel, the one flag that contradicts a terminal status', async () => {
    completed();
    await hydrate();

    optimisticRequest('cancel', 'job-1');

    expect(isRequested(getSnapshot(), 'cancel', 'job-1')).toBe(false);
  });
});
