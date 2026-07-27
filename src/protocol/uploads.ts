/**
 * protocol/uploads.ts — SPEC §3.2 upload lifecycle.
 *
 * This is the one orchestrator above the two sanctioned transports:
 * api.upload() for multipart and api.createResumableUpload() for chunked files.
 * It owns lifecycle state and reports every visible write through store.ts.
 */

// @ts-expect-error TS7016: the legacy HTTP client intentionally remains JS.
import { api as untypedApi } from '../api/client.js';
import {
  applyPoll,
  failOptimisticUpload,
  optimisticUpload,
  resolveOptimisticUpload,
  setUploadSessions,
} from './store.js';

export const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;

export type UploadProgress = {
  loaded?: number;
  total?: number;
  percent?: number;
  speedBps?: number;
  etaSeconds?: number;
  startedAt?: number;
};

export type UploadSession = {
  id: string;
  workspaceId?: string;
  originalName: string;
  mime?: string | null;
  size: number;
  receivedBytes?: number;
  status: string;
  fileId?: string | null;
  updatedAt?: string;
  [key: string]: unknown;
};

export type UploadedFile = {
  id: string;
  originalName?: string;
  size?: number;
  mime?: string | null;
  status?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

type ResumableController = {
  lookupSession: () => Promise<UploadSession | null>;
  start: () => Promise<UploadedFile>;
  pause: () => Promise<UploadSession | null>;
  cancel: () => Promise<void>;
};

type ApiClient = {
  upload: (
    file: File,
    options: {
      workspaceId: string;
      signal: AbortSignal;
      onProgress: (progress: UploadProgress) => void;
    },
  ) => Promise<UploadedFile>;
  listUploadSessions: (
    workspaceId: string,
    options?: { includeCompleted?: boolean },
  ) => Promise<{ sessions?: unknown[] } | null>;
  getWorkspace: (workspaceId: string) => Promise<Record<string, unknown>>;
  createResumableUpload: (
    file: File,
    options: {
      workspaceId: string;
      onProgress: (progress: UploadProgress) => void;
      onState: (state: string, session: UploadSession | null) => void;
    },
  ) => ResumableController;
};

const client = untypedApi as ApiClient;

export type UploadTaskState =
  | 'idle'
  | 'checking'
  | 'uploading'
  | 'paused'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type UploadTaskOptions = {
  workspaceId: string;
  clientId?: string;
  onProgress?: (progress: UploadProgress) => void;
  onState?: (state: UploadTaskState, session?: UploadSession | null) => void;
};

export type UploadTask = {
  readonly clientId: string;
  readonly file: File;
  readonly kind: 'multipart' | 'resumable';
  readonly state: UploadTaskState;
  start: () => Promise<UploadedFile>;
  pause: () => Promise<UploadSession | null>;
  resume: () => Promise<UploadedFile>;
  cancel: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSession(value: unknown): UploadSession | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.originalName !== 'string' ||
    !Number.isFinite(Number(value.size)) ||
    typeof value.status !== 'string'
  ) {
    return null;
  }
  return {
    ...value,
    id: value.id,
    originalName: value.originalName,
    mime: typeof value.mime === 'string' ? value.mime : null,
    size: Number(value.size),
    receivedBytes: Number.isFinite(Number(value.receivedBytes)) ? Number(value.receivedBytes) : 0,
    status: value.status,
    fileId: typeof value.fileId === 'string' ? value.fileId : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}

function sessionsFrom(payload: { sessions?: unknown[] } | null): UploadSession[] {
  if (!Array.isArray(payload?.sessions)) return [];
  return payload.sessions.map(asSession).filter((value): value is UploadSession => value !== null);
}

function clampPercent(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'Upload failed';
}

function codeOf(error: unknown): string {
  if (!isRecord(error)) return '';
  return typeof error.code === 'string' ? error.code : '';
}

function lifecycleError(message: string, code: 'PAUSED' | 'CANCELLED'): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function makeClientId(file: File): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `upload-${uuid}`;
  return `upload-${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

async function listSessions(
  workspaceId: string,
  includeCompleted: boolean,
): Promise<UploadSession[]> {
  const sessions = sessionsFrom(
    await client.listUploadSessions(workspaceId, { includeCompleted }),
  );
  // Completed rows are queried only for adoption. ResumeStrip/store state owns
  // sessions that still require action, never already-committed rows.
  setUploadSessions(sessions.filter((session) => session.status !== 'completed'));
  return sessions;
}

/** Refresh crash-recoverable sessions for ResumeStrip with server byte truth. */
export async function recoverUploadSessions(workspaceId: string): Promise<UploadSession[]> {
  return listSessions(workspaceId, false);
}

async function adoptCompleted(
  workspaceId: string,
  resumable: ResumableController,
): Promise<{ file: UploadedFile; snapshot: Record<string, unknown> } | null> {
  // resumableUpload.js owns the persisted identity key, whose tuple includes
  // lastModified and MIME. Never approximate that identity here with metadata
  // from the server list: distinct files can share name, size and MIME.
  const exact = await resumable.lookupSession();
  const sessions = await listSessions(workspaceId, true);
  if (!exact) return null;
  const completed = sessions.find(
    (session) =>
      session.id === exact.id &&
      session.status === 'completed' &&
      typeof session.fileId === 'string',
  );
  if (!completed?.fileId) return null;

  // Once a completed match exists, fail closed: a transient hydrate failure
  // must not fall through and open a duplicate upload session.
  const snapshot = await client.getWorkspace(workspaceId);
  const files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const adopted = files.find(
    (candidate): candidate is UploadedFile =>
      isRecord(candidate) && candidate.id === completed.fileId,
  );
  if (!adopted) {
    throw new Error(
      `Completed upload session ${completed.id} references unavailable file ${completed.fileId}`,
    );
  }
  return { file: adopted, snapshot };
}

class UploadTaskController implements UploadTask {
  readonly clientId: string;
  readonly file: File;
  readonly kind: 'multipart' | 'resumable';

  private readonly options: UploadTaskOptions;
  private readonly abortController = new AbortController();
  private readonly resumable: ResumableController | null;
  private current: Promise<UploadedFile> | null = null;
  private currentState: UploadTaskState = 'idle';
  private pauseRequested = false;
  private cancelRequested = false;

  constructor(file: File, options: UploadTaskOptions) {
    if (!options.workspaceId) throw new Error('workspaceId is required');
    this.file = file;
    this.options = options;
    this.clientId = options.clientId || makeClientId(file);
    this.kind =
      file.size >= RESUMABLE_UPLOAD_THRESHOLD_BYTES ? 'resumable' : 'multipart';
    this.resumable =
      this.kind === 'resumable'
        ? client.createResumableUpload(file, {
            workspaceId: options.workspaceId,
            onProgress: (progress) => this.reportProgress(progress),
            onState: (state, session) => this.reportTransportState(state, session),
          })
        : null;
  }

  get state(): UploadTaskState {
    return this.currentState;
  }

  private transition(state: UploadTaskState, session?: UploadSession | null): void {
    this.currentState = state;
    this.options.onState?.(state, session);
  }

  private reportProgress(progress: UploadProgress): void {
    const normalized = { ...progress, percent: clampPercent(progress.percent) };
    optimisticUpload({
      clientId: this.clientId,
      name: this.file.name,
      size: this.file.size,
      mime: this.file.type || null,
      progress: normalized.percent,
      status: this.currentState,
    });
    this.options.onProgress?.(normalized);
  }

  private reportTransportState(state: string, session: UploadSession | null): void {
    if (
      state === 'uploading' ||
      state === 'paused' ||
      state === 'finalizing' ||
      state === 'completed' ||
      state === 'cancelled'
    ) {
      this.transition(state, session);
    }
    if (session && state !== 'completed') {
      void recoverUploadSessions(this.options.workspaceId).catch(() => {
        // The transfer remains authoritative; a later recovery refresh retries.
      });
    }
  }

  start(): Promise<UploadedFile> {
    if (this.current) return this.current;
    if (this.currentState === 'completed') {
      return Promise.reject(new Error('Upload is already completed'));
    }
    if (this.currentState === 'cancelled') {
      return Promise.reject(new Error('Upload is cancelled'));
    }
    // An explicit resume releases a pause that won during preflight.
    if (this.currentState === 'paused') this.pauseRequested = false;
    this.current = this.run().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async run(): Promise<UploadedFile> {
    optimisticUpload({
      clientId: this.clientId,
      name: this.file.name,
      size: this.file.size,
      mime: this.file.type || null,
      progress: 0,
      status: 'uploading',
    });
    try {
      let result: UploadedFile;
      if (this.kind === 'resumable') {
        this.transition('checking');
        const adopted = await adoptCompleted(this.options.workspaceId, this.resumable!);
        if (this.cancelRequested) {
          throw lifecycleError('Upload cancelled', 'CANCELLED');
        }
        if (this.pauseRequested) {
          throw lifecycleError('Upload paused', 'PAUSED');
        }
        if (adopted) {
          applyPoll(adopted.snapshot);
          resolveOptimisticUpload(this.clientId, adopted.file.id);
          this.transition('completed');
          return adopted.file;
        }
        this.transition('uploading');
        result = await this.resumable!.start();
      } else {
        this.transition('uploading');
        result = await client.upload(this.file, {
          workspaceId: this.options.workspaceId,
          signal: this.abortController.signal,
          onProgress: (progress) => this.reportProgress(progress),
        });
      }

      applyPoll({ file: result });
      resolveOptimisticUpload(this.clientId, result.id);
      this.transition('completed');
      if (this.kind === 'resumable') {
        void recoverUploadSessions(this.options.workspaceId).catch(() => {});
      }
      return result;
    } catch (error) {
      const code = codeOf(error);
      if (code === 'PAUSED') {
        this.transition('paused');
        optimisticUpload({
          clientId: this.clientId,
          name: this.file.name,
          size: this.file.size,
          mime: this.file.type || null,
          status: 'paused',
        });
      } else if (this.currentState !== 'cancelled') {
        this.transition('failed');
        failOptimisticUpload(this.clientId, messageOf(error));
      }
      throw error;
    }
  }

  async pause(): Promise<UploadSession | null> {
    if (this.kind !== 'resumable') {
      throw new Error('Multipart uploads cannot be paused');
    }
    const previous = this.currentState;
    this.pauseRequested = true;
    this.transition('paused');
    let session: UploadSession | null;
    try {
      session = await this.resumable!.pause();
      this.transition('paused', session);
    } catch (error) {
      this.pauseRequested = false;
      this.transition(previous);
      throw error;
    }
    const running = this.current;
    if (running) await running.catch(() => {});
    return session;
  }

  resume(): Promise<UploadedFile> {
    if (this.kind !== 'resumable') {
      return Promise.reject(new Error('Multipart uploads cannot be resumed'));
    }
    if (this.currentState === 'cancelled') {
      return Promise.reject(new Error('Upload is cancelled'));
    }
    return this.start();
  }

  async cancel(): Promise<void> {
    if (this.currentState === 'completed') return;
    this.cancelRequested = true;
    this.transition('cancelled');
    try {
      if (this.kind === 'resumable') {
        await this.resumable!.cancel();
        void recoverUploadSessions(this.options.workspaceId).catch(() => {});
      } else {
        this.abortController.abort();
      }
      failOptimisticUpload(this.clientId, 'Upload cancelled');
    } catch (error) {
      this.cancelRequested = false;
      this.transition('failed');
      failOptimisticUpload(this.clientId, messageOf(error));
      throw error;
    }
  }
}

export function createUploadTask(file: File, options: UploadTaskOptions): UploadTask {
  return new UploadTaskController(file, options);
}
