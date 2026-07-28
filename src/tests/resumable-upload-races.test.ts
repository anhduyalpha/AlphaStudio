/**
 * Production-controller regressions for B4 review races. These exercise
 * api/resumableUpload.js itself rather than a fabricated protocol controller.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error TS7016: production transport intentionally remains JS.
import { createResumableUpload } from '../api/resumableUpload.js';

class TestApiError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, details: { code?: string; status?: number } = {}) {
    super(message);
    this.code = details.code;
    this.status = details.status;
  }
}

function fileOf(name = 'race.bin'): File {
  return {
    name,
    size: 8 * 1024 * 1024,
    type: 'application/octet-stream',
    lastModified: 1_785_168_000_000,
    slice: vi.fn(),
  } as unknown as File;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let storage = new Map<string, string>();
let originalStorageDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  storage = new Map();
  originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

afterEach(() => {
  if (originalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalStorageDescriptor);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

it('adopts an exact saved session that completed between preflight and start', async () => {
  const file = fileOf('completed.bin');
  const existing = { id: 'file-existing', originalName: file.name };
  const completed = {
    id: 'session-completed',
    originalName: file.name,
    size: file.size,
    status: 'completed',
    fileId: existing.id,
    receivedChunks: [],
    receivedBytes: file.size,
    totalChunks: 1,
    chunkSize: file.size,
  };
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path === `/api/upload-sessions/${completed.id}` && !options) return completed;
    if (path === `/api/upload-sessions/${completed.id}/finalize` && options?.method === 'POST') {
      return { session: completed, file: existing };
    }
    if (path === '/api/upload-sessions/init') {
      throw new Error('must not initialize a duplicate session');
    }
    throw new Error(`unexpected request ${path}`);
  });
  const controller = createResumableUpload(
    file,
    { workspaceId: 'ws-1' },
    { request, apiUrl: (path: string) => path, apiToken: '', ApiError: TestApiError },
  ) as unknown as { key: string; start: () => Promise<unknown> };
  storage.set(controller.key, completed.id);

  await expect(controller.start()).resolves.toEqual(existing);
  expect(request).not.toHaveBeenCalledWith('/api/upload-sessions/init', expect.anything());
});

it('waits for an exact finalizing session instead of opening a duplicate', async () => {
  const file = fileOf('finalizing.bin');
  const existing = { id: 'file-finalized', originalName: file.name };
  const finalizing = {
    id: 'session-finalizing',
    originalName: file.name,
    size: file.size,
    status: 'finalizing',
    fileId: null,
    receivedChunks: [0],
    receivedBytes: file.size,
    totalChunks: 1,
    chunkSize: file.size,
  };
  const completed = { ...finalizing, status: 'completed', fileId: existing.id };
  let reads = 0;
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path === `/api/upload-sessions/${finalizing.id}` && !options) {
      reads += 1;
      return reads === 1 ? finalizing : completed;
    }
    if (path === `/api/upload-sessions/${finalizing.id}/finalize` && options?.method === 'POST') {
      return { session: completed, file: existing };
    }
    if (path === '/api/upload-sessions/init') {
      throw new Error('must not initialize a duplicate session');
    }
    throw new Error(`unexpected request ${path}`);
  });
  const controller = createResumableUpload(
    file,
    { workspaceId: 'ws-1' },
    { request, apiUrl: (path: string) => path, apiToken: '', ApiError: TestApiError },
  ) as unknown as { key: string; start: () => Promise<unknown> };
  storage.set(controller.key, finalizing.id);

  await expect(controller.start()).resolves.toEqual(existing);
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(request).not.toHaveBeenCalledWith('/api/upload-sessions/init', expect.anything());
});

it('binds an exact active lookup so preflight pause persists on the server', async () => {
  const file = fileOf('saved-pause.bin');
  const lookup = deferred<Record<string, unknown>>();
  const active = {
    id: 'session-saved-pause',
    originalName: file.name,
    size: file.size,
    status: 'uploading',
    receivedChunks: [],
    receivedBytes: 0,
    totalChunks: 1,
    chunkSize: file.size,
  };
  const paused = { ...active, status: 'paused' };
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path === `/api/upload-sessions/${active.id}` && !options) return lookup.promise;
    if (path === `/api/upload-sessions/${active.id}/pause` && options?.method === 'POST') {
      return paused;
    }
    throw new Error(`unexpected request ${path}`);
  });
  const controller = createResumableUpload(
    file,
    { workspaceId: 'ws-1' },
    { request, apiUrl: (path: string) => path, apiToken: '', ApiError: TestApiError },
  ) as unknown as {
    key: string;
    lookupSession: () => Promise<unknown>;
    pause: () => Promise<unknown>;
  };
  storage.set(controller.key, active.id);

  const looking = controller.lookupSession();
  const pausing = controller.pause();
  lookup.resolve(active);
  await looking;
  await expect(pausing).resolves.toMatchObject({ status: 'paused' });
  expect(request).toHaveBeenCalledWith(`/api/upload-sessions/${active.id}/pause`, {
    method: 'POST',
  });
});

it('binds an exact active lookup so preflight cancel deletes the server session', async () => {
  const file = fileOf('saved-cancel.bin');
  const lookup = deferred<Record<string, unknown>>();
  const active = {
    id: 'session-saved-cancel',
    originalName: file.name,
    size: file.size,
    status: 'uploading',
    receivedChunks: [],
    receivedBytes: 0,
    totalChunks: 1,
    chunkSize: file.size,
  };
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path === `/api/upload-sessions/${active.id}` && !options) return lookup.promise;
    if (path === `/api/upload-sessions/${active.id}` && options?.method === 'DELETE') {
      return { cancelled: true, id: active.id };
    }
    throw new Error(`unexpected request ${path}`);
  });
  const controller = createResumableUpload(
    file,
    { workspaceId: 'ws-1' },
    { request, apiUrl: (path: string) => path, apiToken: '', ApiError: TestApiError },
  ) as unknown as {
    key: string;
    lookupSession: () => Promise<unknown>;
    cancel: () => Promise<void>;
  };
  storage.set(controller.key, active.id);

  const looking = controller.lookupSession();
  const cancelling = controller.cancel();
  lookup.resolve(active);
  await looking;
  await cancelling;
  expect(request).toHaveBeenCalledWith(`/api/upload-sessions/${active.id}`, {
    method: 'DELETE',
  });
  expect(storage.has(controller.key)).toBe(false);
});

it('persists pause when it wins while session initialization is pending', async () => {
  const file = fileOf('pause-init.bin');
  const init = deferred<Record<string, unknown>>();
  const uploading = {
    id: 'session-pause',
    originalName: file.name,
    size: file.size,
    status: 'uploading',
    fileId: null,
    receivedChunks: [],
    receivedBytes: 0,
    totalChunks: 1,
    chunkSize: file.size,
  };
  const paused = { ...uploading, status: 'paused' };
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path === '/api/upload-sessions/init') return init.promise;
    if (path === `/api/upload-sessions/${uploading.id}/pause` && options?.method === 'POST') {
      return paused;
    }
    throw new Error(`unexpected request ${path}`);
  });
  const controller = createResumableUpload(
    file,
    { workspaceId: 'ws-1' },
    { request, apiUrl: (path: string) => path, apiToken: '', ApiError: TestApiError },
  );

  const running = controller.start();
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('/api/upload-sessions/init', expect.anything()));
  await controller.pause();
  init.resolve(uploading);

  await expect(running).rejects.toMatchObject({ code: 'PAUSED' });
  expect(request).toHaveBeenCalledWith(`/api/upload-sessions/${uploading.id}/pause`, {
    method: 'POST',
  });
});

it('deletes a session created after cancel won the initialization race', async () => {
  const file = fileOf('cancel-init.bin');
  const init = deferred<Record<string, unknown>>();
  const uploading = {
    id: 'session-cancel',
    originalName: file.name,
    size: file.size,
    status: 'uploading',
    fileId: null,
    receivedChunks: [],
    receivedBytes: 0,
    totalChunks: 1,
    chunkSize: file.size,
  };
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path === '/api/upload-sessions/init') return init.promise;
    if (path === `/api/upload-sessions/${uploading.id}` && options?.method === 'DELETE') {
      return { cancelled: true, id: uploading.id };
    }
    throw new Error(`unexpected request ${path}`);
  });
  const controller = createResumableUpload(
    file,
    { workspaceId: 'ws-1' },
    { request, apiUrl: (path: string) => path, apiToken: '', ApiError: TestApiError },
  );

  const running = controller.start();
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('/api/upload-sessions/init', expect.anything()));
  await controller.cancel();
  init.resolve(uploading);

  await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(request).toHaveBeenCalledWith(`/api/upload-sessions/${uploading.id}`, {
    method: 'DELETE',
  });
});
