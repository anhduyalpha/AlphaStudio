/**
 * Workspace-scoped realtime event bus.
 * Emits versioned events for files + jobs so SSE clients stay in sync without reload.
 */
import { EventEmitter } from 'node:events';

export type WorkspaceEvent = {
  type: string;
  workspaceId: string | null;
  fileId?: string | null;
  jobId?: string | null;
  status?: string | null;
  stage?: string | null;
  progress?: number | null;
  processedBytes?: number | null;
  message?: string | null;
  updatedAt: string;
  /** Monotonic per-process version — higher always wins on clients */
  version: number;
  file?: unknown;
  job?: unknown;
};

const bus = new EventEmitter();
bus.setMaxListeners(500);

let seq = 0;

export function nextEventVersion(): number {
  seq += 1;
  return seq;
}

export function emitWorkspaceEvent(
  partial: Omit<WorkspaceEvent, 'version' | 'updatedAt'> & {
    updatedAt?: string;
    version?: number;
  },
): WorkspaceEvent {
  const event: WorkspaceEvent = {
    type: partial.type,
    workspaceId: partial.workspaceId ?? null,
    fileId: partial.fileId ?? null,
    jobId: partial.jobId ?? null,
    status: partial.status ?? null,
    stage: partial.stage ?? null,
    progress: partial.progress ?? null,
    processedBytes: partial.processedBytes ?? null,
    message: partial.message ?? null,
    updatedAt: partial.updatedAt || new Date().toISOString(),
    version: partial.version ?? nextEventVersion(),
    file: partial.file,
    job: partial.job,
  };

  bus.emit('workspace', event);
  if (event.workspaceId) {
    bus.emit(`workspace:${event.workspaceId}`, event);
  }
  return event;
}

export function onWorkspaceEvent(
  workspaceId: string | null | undefined,
  handler: (ev: WorkspaceEvent) => void,
): () => void {
  if (workspaceId) {
    const key = `workspace:${workspaceId}`;
    bus.on(key, handler);
    return () => {
      bus.off(key, handler);
    };
  }
  bus.on('workspace', handler);
  return () => {
    bus.off('workspace', handler);
  };
}

export { bus as workspaceEventBus };
