/**
 * B4 acceptance suite, written before protocol/uploads.ts.
 * Covers the transport branch, pause/resume/cancel, crash recovery and the
 * lost-finalize completed-session adoption required by SPEC §6.5 item 1.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: {
    upload: vi.fn(),
    listUploadSessions: vi.fn(),
    getWorkspace: vi.fn(),
    createResumableUpload: vi.fn(),
  },
  optimisticUpload: vi.fn(),
  failOptimisticUpload: vi.fn(),
  resolveOptimisticUpload: vi.fn(),
  setUploadSessions: vi.fn(),
  applyPoll: vi.fn(),
}));

vi.mock('../api/client.js', () => ({ api: mocks.api }));
vi.mock('../protocol/store.js', () => ({
  optimisticUpload: mocks.optimisticUpload,
  failOptimisticUpload: mocks.failOptimisticUpload,
  resolveOptimisticUpload: mocks.resolveOptimisticUpload,
  setUploadSessions: mocks.setUploadSessions,
  applyPoll: mocks.applyPoll,
}));

const {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  createUploadTask,
  recoverUploadSessions,
} = await import('../protocol/uploads.js');

function fileOf(
  size: number,
  name = 'sample.bin',
  type = 'application/octet-stream',
): File {
  return {
    name,
    size,
    type,
    lastModified: 1_785_168_000_000,
    slice: vi.fn(),
  } as unknown as File;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.listUploadSessions.mockResolvedValue({ sessions: [] });
});

describe('transport branching and progress', () => {
  it('uses multipart below 8 MiB and resumable at 8 MiB', async () => {
    const small = fileOf(RESUMABLE_UPLOAD_THRESHOLD_BYTES - 1, 'small.bin');
    const large = fileOf(RESUMABLE_UPLOAD_THRESHOLD_BYTES, 'large.bin');
    const smallResult = { id: 'file-small', originalName: small.name, status: 'processing' };
    const largeResult = { id: 'file-large', originalName: large.name, status: 'processing' };
    mocks.api.upload.mockResolvedValue(smallResult);
    const resumable = {
      start: vi.fn().mockResolvedValue(largeResult),
      pause: vi.fn(),
      cancel: vi.fn(),
      lookupSession: vi.fn().mockResolvedValue(null),
    };
    mocks.api.createResumableUpload.mockReturnValue(resumable);

    await createUploadTask(small, { workspaceId: 'ws-1', clientId: 'small' }).start();
    await createUploadTask(large, { workspaceId: 'ws-1', clientId: 'large' }).start();

    expect(mocks.api.upload).toHaveBeenCalledTimes(1);
    expect(mocks.api.createResumableUpload).toHaveBeenCalledTimes(1);
    expect(resumable.start).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOptimisticUpload).toHaveBeenCalledWith('small', 'file-small');
    expect(mocks.resolveOptimisticUpload).toHaveBeenCalledWith('large', 'file-large');
  });

  it('clamps transport progress before reporting it to the store', async () => {
    const file = fileOf(100, 'progress.bin');
    mocks.api.upload.mockImplementation(async (_file: File, options: { onProgress: Function }) => {
      options.onProgress({ percent: -20 });
      options.onProgress({ percent: 140 });
      return { id: 'file-progress', originalName: file.name };
    });

    await createUploadTask(file, { workspaceId: 'ws-1', clientId: 'progress' }).start();

    const reported = mocks.optimisticUpload.mock.calls.map(([row]) => row.progress);
    expect(reported).toContain(0);
    expect(reported).toContain(100);
    expect(reported.every((value) => value >= 0 && value <= 100)).toBe(true);
  });
});

describe('resumable lifecycle', () => {
  it('pauses an active transfer, then resumes the same controller', async () => {
    let rejectRun!: (error: Error & { code?: string }) => void;
    const pausedError = Object.assign(new Error('paused'), { code: 'PAUSED' });
    const result = { id: 'file-resumed', originalName: 'resume.bin' };
    const controller = {
      start: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectRun = reject;
            }),
        )
        .mockResolvedValueOnce(result),
      pause: vi.fn().mockImplementation(async () => {
        rejectRun(pausedError);
        return { id: 'session-1', status: 'paused', receivedBytes: 64, size: 128 };
      }),
      cancel: vi.fn(),
      lookupSession: vi.fn().mockResolvedValue(null),
    };
    mocks.api.createResumableUpload.mockReturnValue(controller);
    const task = createUploadTask(fileOf(RESUMABLE_UPLOAD_THRESHOLD_BYTES, 'resume.bin'), {
      workspaceId: 'ws-1',
      clientId: 'resume',
    });

    const running = task.start();
    await vi.waitFor(() => expect(controller.start).toHaveBeenCalledTimes(1));
    await task.pause();
    await expect(running).rejects.toMatchObject({ code: 'PAUSED' });
    await expect(task.resume()).resolves.toEqual(result);

    expect(controller.pause).toHaveBeenCalledTimes(1);
    expect(controller.start).toHaveBeenCalledTimes(2);
  });

  it('cancels resumable transport and reports the terminal local state', async () => {
    const controller = {
      start: vi.fn(),
      pause: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      lookupSession: vi.fn().mockResolvedValue(null),
    };
    mocks.api.createResumableUpload.mockReturnValue(controller);
    const task = createUploadTask(fileOf(RESUMABLE_UPLOAD_THRESHOLD_BYTES, 'cancel.bin'), {
      workspaceId: 'ws-1',
      clientId: 'cancel',
    });

    await task.cancel();

    expect(controller.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.failOptimisticUpload).toHaveBeenCalledWith('cancel', 'Upload cancelled');
  });
});

describe('recovery and completed-session adoption', () => {
  it('mirrors resumable server sessions with their committed byte counts', async () => {
    const sessions = [
      {
        id: 'session-paused',
        originalName: 'large.bin',
        size: 10_000,
        receivedBytes: 4_096,
        status: 'paused',
        updatedAt: '2026-07-27T00:00:00.000Z',
      },
    ];
    mocks.api.listUploadSessions.mockResolvedValue({ sessions });

    const recovered = await recoverUploadSessions('ws-1');
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject(sessions[0]);

    expect(mocks.api.listUploadSessions).toHaveBeenCalledWith('ws-1', {
      includeCompleted: false,
    });
    expect(mocks.setUploadSessions).toHaveBeenCalledWith(recovered);
  });

  it('adopts a matching completed session before opening a new upload', async () => {
    const file = fileOf(RESUMABLE_UPLOAD_THRESHOLD_BYTES, 'already.bin', 'application/test');
    const completed = {
      id: 'session-completed',
      originalName: file.name,
      mime: file.type,
      size: file.size,
      receivedBytes: file.size,
      status: 'completed',
      fileId: 'file-existing',
      updatedAt: '2026-07-27T01:00:00.000Z',
    };
    const existingFile = {
      id: 'file-existing',
      originalName: file.name,
      size: file.size,
      status: 'ready',
      updatedAt: '2026-07-27T01:00:00.000Z',
    };
    const snapshot = { epoch: 'epoch-1', seq: 8, files: [existingFile], jobs: [] };
    const resumable = {
      start: vi.fn(),
      pause: vi.fn(),
      cancel: vi.fn(),
      lookupSession: vi.fn().mockResolvedValue(completed),
    };
    mocks.api.listUploadSessions.mockResolvedValue({ sessions: [completed] });
    mocks.api.getWorkspace.mockResolvedValue(snapshot);
    mocks.api.createResumableUpload.mockReturnValue(resumable);

    const result = await createUploadTask(file, {
      workspaceId: 'ws-1',
      clientId: 'adopt',
    }).start();

    expect(result).toEqual(existingFile);
    expect(mocks.api.listUploadSessions).toHaveBeenCalledWith('ws-1', {
      includeCompleted: true,
    });
    expect(resumable.start).not.toHaveBeenCalled();
    expect(mocks.api.upload).not.toHaveBeenCalled();
    expect(mocks.applyPoll).toHaveBeenCalledWith(snapshot);
    expect(mocks.resolveOptimisticUpload).toHaveBeenCalledWith('adopt', 'file-existing');
  });

  it('does not adopt a different file that merely shares name, size and MIME', async () => {
    const file = fileOf(RESUMABLE_UPLOAD_THRESHOLD_BYTES, 'collision.bin', 'application/test');
    const metadataCollision = {
      id: 'session-other-file',
      originalName: file.name,
      mime: file.type,
      size: file.size,
      receivedBytes: file.size,
      status: 'completed',
      fileId: 'file-other',
      updatedAt: '2026-07-27T01:00:00.000Z',
    };
    const uploaded = { id: 'file-new', originalName: file.name };
    const resumable = {
      start: vi.fn().mockResolvedValue(uploaded),
      pause: vi.fn(),
      cancel: vi.fn(),
      // No server session is bound to this file's exact local identity key.
      lookupSession: vi.fn().mockResolvedValue(null),
    };
    mocks.api.listUploadSessions.mockResolvedValue({ sessions: [metadataCollision] });
    mocks.api.createResumableUpload.mockReturnValue(resumable);

    await expect(
      createUploadTask(file, { workspaceId: 'ws-1', clientId: 'collision' }).start(),
    ).resolves.toEqual(uploaded);

    expect(resumable.start).toHaveBeenCalledTimes(1);
    expect(mocks.api.getWorkspace).not.toHaveBeenCalled();
  });
});

describe('preflight lifecycle races', () => {
  it('never starts transport when cancel wins while completed-session lookup is pending', async () => {
    let releaseList!: (value: { sessions: unknown[] }) => void;
    mocks.api.listUploadSessions.mockReturnValue(
      new Promise((resolve) => {
        releaseList = resolve;
      }),
    );
    const controller = {
      start: vi.fn(),
      pause: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      lookupSession: vi.fn().mockResolvedValue(null),
    };
    mocks.api.createResumableUpload.mockReturnValue(controller);
    const task = createUploadTask(fileOf(RESUMABLE_UPLOAD_THRESHOLD_BYTES, 'cancel-race.bin'), {
      workspaceId: 'ws-1',
      clientId: 'cancel-race',
    });

    const running = task.start();
    await vi.waitFor(() => expect(mocks.api.listUploadSessions).toHaveBeenCalled());
    await task.cancel();
    releaseList({ sessions: [] });

    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(controller.start).not.toHaveBeenCalled();
    expect(task.state).toBe('cancelled');
  });

  it('holds a preflight pause until an explicit resume', async () => {
    let releaseList!: (value: { sessions: unknown[] }) => void;
    mocks.api.listUploadSessions.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseList = resolve;
      }),
    );
    const uploaded = { id: 'file-after-resume', originalName: 'pause-race.bin' };
    const controller = {
      start: vi.fn().mockResolvedValue(uploaded),
      pause: vi.fn().mockResolvedValue(null),
      cancel: vi.fn(),
      lookupSession: vi.fn().mockResolvedValue(null),
    };
    mocks.api.createResumableUpload.mockReturnValue(controller);
    const task = createUploadTask(fileOf(RESUMABLE_UPLOAD_THRESHOLD_BYTES, 'pause-race.bin'), {
      workspaceId: 'ws-1',
      clientId: 'pause-race',
    });

    const running = task.start();
    await vi.waitFor(() => expect(mocks.api.listUploadSessions).toHaveBeenCalled());
    const pausing = task.pause();
    releaseList({ sessions: [] });

    await pausing;
    await expect(running).rejects.toMatchObject({ code: 'PAUSED' });
    expect(controller.start).not.toHaveBeenCalled();

    mocks.api.listUploadSessions.mockResolvedValue({ sessions: [] });
    await expect(task.resume()).resolves.toEqual(uploaded);
    expect(controller.start).toHaveBeenCalledTimes(1);
  });
});
