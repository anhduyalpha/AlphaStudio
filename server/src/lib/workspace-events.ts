/**
 * Workspace-scoped realtime event bus.
 * Emits versioned events for files + jobs so SSE clients stay in sync without reload.
 *
 * S1 versioning (SPEC §6.4): the process mints an `epoch` UUID at boot and every
 * envelope — and every snapshot the routes return — carries `{ epoch, seq }`,
 * with `seq` monotonic per workspace within that epoch. A restart therefore
 * changes the epoch and restarts the counters, which is the client's signal to
 * drop ordering state, re-hydrate, and adopt the new epoch. Boot-scoped by
 * design: nothing here is persisted, so there is no SQLite schema change.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

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
  /** Boot-scoped epoch (SPEC §6.4) — a change means "re-hydrate, drop ordering state" */
  epoch: string;
  /** Monotonic per workspace within `epoch` — never compare across epochs */
  seq: number;
  file?: unknown;
  job?: unknown;
};

const bus = new EventEmitter();
bus.setMaxListeners(500);

/** Minted once per process boot; never persisted. */
export const eventEpoch: string = randomUUID();

let seq = 0;

export function nextEventVersion(): number {
  seq += 1;
  return seq;
}

/**
 * Per-workspace sequence lanes for the current epoch. Events with no workspace
 * share one lane under the empty key so they stay orderable too.
 */
const workspaceSeq = new Map<string, number>();

const laneKey = (workspaceId: string | null | undefined): string => workspaceId ?? '';

/** Advance and return this workspace's seq within the current epoch. */
export function nextWorkspaceSeq(workspaceId: string | null | undefined): number {
  const key = laneKey(workspaceId);
  const next = (workspaceSeq.get(key) ?? 0) + 1;
  workspaceSeq.set(key, next);
  return next;
}

/**
 * The seq of the last event emitted for this workspace in the current epoch
 * (0 when none). Snapshots carry it so a client can drop any replayed envelope
 * at or below the state it just hydrated.
 */
export function currentWorkspaceSeq(workspaceId: string | null | undefined): number {
  return workspaceSeq.get(laneKey(workspaceId)) ?? 0;
}

export function emitWorkspaceEvent(
  partial: Omit<WorkspaceEvent, 'version' | 'updatedAt' | 'epoch' | 'seq'> & {
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
    // Always server-minted: callers may share a legacy `version` across buses
    // (workers/jobs.ts does), but the epoch/seq pair is never caller-supplied.
    epoch: eventEpoch,
    seq: nextWorkspaceSeq(partial.workspaceId),
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
