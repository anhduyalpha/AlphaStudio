/**
 * protocol/store.ts — SPEC §3.2 store row.
 *
 * THE single client owner of workspace/job/upload-session state, the persisted
 * workspace id (§6.1), and the per-hub+mode job-resume pointers (§6.5 item 2).
 * It supersedes `lib/liveState.js`, `hooks/useWorkspace.js`, and
 * `hooks/useJobRunner.js`, which between them had three writers and no shared
 * version gate — the hazard class §6.3 exists to close.
 *
 * The rule that gives this module its shape: **all four write paths — hydrate,
 * SSE event, poll, optimistic — go through the same merge** (`acceptsWrite` +
 * `mergeJob`/`mergeFile`). Adding a write path that bypasses it is a spec
 * violation, not an optimization.
 *
 * Layering (SPEC §3.2): `protocol` may import `api`, nothing else. No React, no
 * components, no event-stream parsing (that is `events.ts`), no job payload
 * construction, no chunk logic (that is `uploads.ts`). Design rationale for the
 * non-obvious decisions lives in `docs/plans/UNIT-B2.md`.
 */

// api/client.js is untyped JavaScript by design — SPEC §3.1's language rule
// makes only src/protocol/ and src/hubs/ TypeScript. Same single-suppression
// boundary contracts.ts uses; the shape is re-declared so nothing sees `any`.
// @ts-expect-error TS7016: untyped JS module, intentionally so.
import { api as untypedApi } from '../api/client.js';

const client = untypedApi as {
  recoverWorkspace: (body: { id?: string; route?: string }) => Promise<unknown>;
  createWorkspace: (body: { route?: string }) => Promise<unknown>;
  getWorkspace: (id: string) => Promise<unknown>;
};

/* ---------------------------------------------------------------- *
 * Sanctioned storage keys — SPEC §6.1. This list is exhaustive for
 * this module; anything else written client-side is a violation.
 * ---------------------------------------------------------------- */

/** Opaque workspace pointer. Pre-rebuild name kept: renaming orphans workspaces. */
export const WORKSPACE_ID_KEY = 'alphastudio-workspace-id';

const ACTIVE_JOB_PREFIX = 'alphastudio-active-job:';

/** `alphastudio-active-job:<hubId>:<modeId>` — the §6.1 resume-pointer key. */
export function activeJobKey(hubId: string, modeId: string): string {
  return `${ACTIVE_JOB_PREFIX}${hubId}:${modeId}`;
}

/** How long an unanswered optimistic flag survives (§6.2 "response or timeout"). */
const REQUEST_TIMEOUT_MS = 15_000;
/** Recovery backoff (§6.5 item 5): retry the SAME workspace, never replace it. */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function isTerminalStatus(status: string | null | undefined): boolean {
  return TERMINAL_JOB_STATUSES.has(String(status || ''));
}

/* ---------------------------------------------------------------- *
 * Public shapes.
 * ---------------------------------------------------------------- */

export type StoreStatus = 'idle' | 'hydrating' | 'ready' | 'error';

export type StoreError = {
  message: string;
  /** How many consecutive recovery attempts have failed. */
  attempt: number;
  /** True while a retry is scheduled — the ErrorState stays up either way. */
  retrying: boolean;
};

/**
 * A job row as published by the server (`jobPublicDto`), plus nothing invented.
 * The index signature carries fields this module does not model (`meta`,
 * `category`, …) without re-declaring the server DTO.
 */
export type JobEntry = {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string | null;
  error: string | null;
  options: Record<string, unknown>;
  downloadUrl: string | null;
  outputName: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

/**
 * A file row: the server DTO (`filePublic`) plus three derived client fields.
 * `localOnly` rows exist only in the optimistic overlay (§6.2).
 */
export type FileEntry = {
  id: string;
  originalName: string;
  status: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  /** 0–100. Server rows are fully uploaded by definition. */
  uploadProgress: number;
  /** True while the row exists only client-side (upload in flight). */
  localOnly: boolean;
  /** Owning job resolved through `options._uploadIds` — the DTO has no link. */
  jobId: string | null;
  /** The §2.2 composed value, monotonic per attempt (§6.3). */
  composedProgress: number;
  [key: string]: unknown;
};

export type UploadSessionEntry = {
  id: string;
  originalName: string;
  size: number;
  receivedBytes: number;
  status: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type OutputEntry = {
  id: string;
  name: string;
  [key: string]: unknown;
};

export type RequestKind = 'cancel' | 'delete' | 'convert';

export type PendingRequest = {
  key: string;
  kind: RequestKind;
  targetId: string;
  /** Sent with the request so the server owns dedupe (§6.2). */
  clientRequestId: string | null;
  requestedAt: number;
};

export type StoreSnapshot = {
  status: StoreStatus;
  workspaceId: string | null;
  route: string | null;
  selectedFileIds: string[];
  ui: Record<string, unknown>;
  /** Boot-scoped server epoch (§6.4); `null` before the first hydrate. */
  epoch: string | null;
  /** Highest seq seen in the current epoch. */
  seq: number;
  error: StoreError | null;
  files: FileEntry[];
  jobs: JobEntry[];
  outputs: OutputEntry[];
  uploadSessions: UploadSessionEntry[];
  pending: PendingRequest[];
  hydratedAt: number | null;
};

/* ---------------------------------------------------------------- *
 * Internal state. Server rows and the optimistic overlay are kept in
 * separate layers so "overlays re-applied on top" after a re-hydrate
 * (§6.3) is structural rather than a re-application step that can be
 * forgotten, and so an overlay can never be written into a server row.
 * ---------------------------------------------------------------- */

/** Per-row ordering state. `seq: null` = not comparable, fall back to time. */
type RowVersion = { epoch: string | null; seq: number | null; updatedAt: number };

/** What a write claims about its position in the stream. */
type WriteToken = { epoch: string | null; seq: number | null; updatedAt: number };

type OverlayFile = {
  clientId: string;
  originalName: string;
  size: number;
  mime: string | null;
  status: string;
  uploadProgress: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set once the server file id is known; the overlay dies when that row lands. */
  serverFileId: string | null;
};

type InternalState = {
  status: StoreStatus;
  workspaceId: string | null;
  route: string | null;
  selectedFileIds: string[];
  ui: Record<string, unknown>;
  epoch: string | null;
  seq: number;
  error: StoreError | null;
  files: Map<string, FileEntry>;
  fileVersions: Map<string, RowVersion>;
  jobs: Map<string, JobEntry>;
  jobVersions: Map<string, RowVersion>;
  /**
   * Versions of rows that have been REMOVED (§6.3). Deleting the row's version
   * along with the row would leave the id with no recorded position, so the
   * `if (prev)` gate in the merges would wave through any later-arriving
   * write — including a provably older one — and resurrect the row.
   */
  removedFiles: Map<string, RowVersion>;
  removedJobs: Map<string, RowVersion>;
  outputs: OutputEntry[];
  sessions: Map<string, UploadSessionEntry>;
  overlay: Map<string, OverlayFile>;
  requests: Map<string, PendingRequest>;
  /** Composed-progress floor per file, keyed by the attempt it belongs to. */
  composed: Map<string, { jobId: string | null; value: number }>;
  hydratedAt: number | null;
  failedAttempts: number;
};

function createState(): InternalState {
  return {
    status: 'idle',
    workspaceId: null,
    route: null,
    selectedFileIds: [],
    ui: {},
    epoch: null,
    seq: 0,
    error: null,
    files: new Map(),
    fileVersions: new Map(),
    jobs: new Map(),
    jobVersions: new Map(),
    removedFiles: new Map(),
    removedJobs: new Map(),
    outputs: [],
    sessions: new Map(),
    overlay: new Map(),
    requests: new Map(),
    composed: new Map(),
    hydratedAt: null,
    failedAttempts: 0,
  };
}

let state = createState();
let snapshot: StoreSnapshot | null = null;
let dirty = false;
const listeners = new Set<() => void>();

/** Bumped per hydrate and on reset so a stale response can never land. */
let generation = 0;
/**
 * Generation of the wholesale load in flight (hydrate or createWorkspace), or
 * null when none is. Keyed by generation rather than a boolean because
 * `createWorkspace()` bumps `generation` without owning the load: a plain flag
 * cleared only by the generation-owning hydrate could strand at `true`, and
 * `requestResync()`'s early return then swallowed every epoch change for the
 * life of the page (§6.4).
 */
let hydrateGeneration: number | null = null;
/** An epoch resync suppressed during a load, replayed once that load settles. */
let resyncPending = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const requestTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** In-memory stand-in when Web Storage is unavailable (private mode, denied). */
const memoryStorage = new Map<string, string>();

/* ---------------------------------------------------------------- *
 * Storage — the only two sanctioned key families (§6.1), and never a
 * throw into a render if the browser denies access.
 * ---------------------------------------------------------------- */

function storageFor(kind: 'local' | 'session'): Storage | null {
  try {
    const store = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    return store || null;
  } catch {
    return null;
  }
}

function readStored(kind: 'local' | 'session', key: string): string | null {
  const store = storageFor(kind);
  if (!store) return memoryStorage.get(`${kind}:${key}`) ?? null;
  try {
    return store.getItem(key);
  } catch {
    return memoryStorage.get(`${kind}:${key}`) ?? null;
  }
}

function writeStored(kind: 'local' | 'session', key: string, value: string): void {
  const store = storageFor(kind);
  if (!store) {
    memoryStorage.set(`${kind}:${key}`, value);
    return;
  }
  try {
    store.setItem(key, value);
  } catch {
    memoryStorage.set(`${kind}:${key}`, value);
  }
}

function clearStored(kind: 'local' | 'session', key: string): void {
  memoryStorage.delete(`${kind}:${key}`);
  const store = storageFor(kind);
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* already gone as far as this client is concerned */
  }
}

/* ---------------------------------------------------------------- *
 * Snapshot plumbing. `getSnapshot()` is referentially stable until a
 * write actually changes something — useSyncExternalStore depends on
 * that, and a discarded write must not re-render the app.
 * ---------------------------------------------------------------- */

function touch(): void {
  dirty = true;
}

function buildSnapshot(): StoreSnapshot {
  const overlayRows: FileEntry[] = [];
  for (const row of state.overlay.values()) {
    // An overlay whose server row has landed is a duplicate, not a row.
    if (row.serverFileId && state.files.has(row.serverFileId)) continue;
    overlayRows.push({
      id: row.clientId,
      originalName: row.originalName,
      status: row.status,
      size: row.size,
      mime: row.mime,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      uploadProgress: row.uploadProgress,
      localOnly: true,
      jobId: null,
      composedProgress: state.composed.get(row.clientId)?.value ?? 0,
      error: row.error,
    });
  }
  return {
    status: state.status,
    workspaceId: state.workspaceId,
    route: state.route,
    selectedFileIds: [...state.selectedFileIds],
    ui: state.ui,
    epoch: state.epoch,
    seq: state.seq,
    error: state.error,
    files: [...state.files.values(), ...overlayRows],
    jobs: [...state.jobs.values()],
    outputs: [...state.outputs],
    uploadSessions: [...state.sessions.values()],
    pending: [...state.requests.values()],
    hydratedAt: state.hydratedAt,
  };
}

function flush(): void {
  if (!dirty) return;
  dirty = false;
  pruneOverlay();
  recomputeLinks();
  snapshot = buildSnapshot();
  for (const listener of [...listeners]) listener();
}

export function getSnapshot(): StoreSnapshot {
  if (!snapshot) {
    recomputeLinks();
    snapshot = buildSnapshot();
  }
  return snapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drop everything — workspace teardown, and test isolation. */
export function resetStore(): void {
  generation += 1;
  hydrateGeneration = null;
  resyncPending = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  for (const timer of requestTimers.values()) clearTimeout(timer);
  requestTimers.clear();
  memoryStorage.clear();
  state = createState();
  snapshot = null;
  dirty = false;
}

/* ---------------------------------------------------------------- *
 * THE version gate (SPEC §6.3). Every write path calls this.
 * ---------------------------------------------------------------- */

function timeOf(value: unknown): number {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A write is accepted iff it is newer than what the row already applied:
 * same epoch ⇒ higher `seq` wins; otherwise newer `updatedAt` wins; identical
 * tokens are accepted as an idempotent refresh (no ordering conflict, and the
 * monotonic/terminal rules below still govern status and progress). Anything
 * older is discarded — which is what makes poll and SSE unable to regress each
 * other (the pre-rebuild poll path skipped this entirely).
 */
function acceptsWrite(prev: RowVersion | undefined, next: WriteToken): boolean {
  if (!prev) return true;
  const comparableSeq =
    next.seq !== null &&
    prev.seq !== null &&
    next.epoch !== null &&
    prev.epoch !== null &&
    next.epoch === prev.epoch;
  if (comparableSeq && next.seq !== prev.seq) return (next.seq as number) > (prev.seq as number);
  if (next.updatedAt !== prev.updatedAt) return next.updatedAt > prev.updatedAt;
  return true;
}

/**
 * Record what the row has now applied. A write with no comparable `seq` (a
 * poll) deliberately clears the row's ordering state: the row is newer than the
 * stream position we last knew, so later events must be judged by time, not by
 * a `seq` that no longer describes this row.
 */
function stampVersion(map: Map<string, RowVersion>, id: string, token: WriteToken): void {
  map.set(id, { epoch: token.epoch, seq: token.seq, updatedAt: token.updatedAt });
}

/**
 * The position a write must beat: the live row's version, or — when the id was
 * removed — its tombstone. Without the tombstone half, a delete would reset the
 * id's history and let an older write recreate the row (§6.3).
 */
function priorVersion(
  versions: Map<string, RowVersion>,
  tombstones: Map<string, RowVersion>,
  id: string,
): RowVersion | undefined {
  return versions.get(id) ?? tombstones.get(id);
}

function clearOrderingState(): void {
  // `seq` only means something within one epoch, so it is dropped everywhere —
  // but `updatedAt` still orders writes, and tombstones keep theirs so a delete
  // survives the epoch change that follows it.
  for (const map of [state.fileVersions, state.jobVersions, state.removedFiles, state.removedJobs]) {
    for (const [id, version] of map) {
      map.set(id, { ...version, epoch: null, seq: null });
    }
  }
}

/* ---------------------------------------------------------------- *
 * Row merges — the only functions allowed to write a row.
 * ---------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toJobEntry(raw: Record<string, unknown>, prev: JobEntry | undefined): JobEntry {
  const base = prev ? { ...prev } : {};
  return {
    ...base,
    ...raw,
    id: String(raw.id),
    type: typeof raw.type === 'string' ? raw.type : (prev?.type ?? ''),
    status: typeof raw.status === 'string' ? raw.status : (prev?.status ?? 'queued'),
    progress: numberOr(raw.progress, prev?.progress ?? 0),
    message: (raw.message as string | null) ?? prev?.message ?? null,
    error: (raw.error as string | null) ?? prev?.error ?? null,
    options: isRecord(raw.options) ? raw.options : (prev?.options ?? {}),
    downloadUrl: (raw.downloadUrl as string | null) ?? prev?.downloadUrl ?? null,
    outputName: (raw.outputName as string | null) ?? prev?.outputName ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : (prev?.createdAt ?? ''),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : (prev?.updatedAt ?? ''),
  };
}

/**
 * Merge one job row.
 *
 * Two rules ride on top of the version gate:
 *  - **Progress is monotonic per attempt** (§6.3). A lower value is dropped —
 *    but only the value: a failure event usually reports progress 0, and
 *    dropping the whole write would wedge the row at "running" forever.
 *  - **Terminal states are immutable** (§6.3). Once terminal, a write carrying a
 *    DIFFERENT status is discarded whole (a late progress event, or a result
 *    racing a user cancellation). A write carrying the same terminal status is
 *    enrichment — `downloadUrl`/`outputName`/`meta` arrive that way — and merges.
 */
function mergeJob(raw: Record<string, unknown>, token: WriteToken): boolean {
  const id = typeof raw.id === 'string' ? raw.id : String(raw.id ?? '');
  if (!id) return false;
  const prev = state.jobs.get(id);
  if (!acceptsWrite(priorVersion(state.jobVersions, state.removedJobs, id), token)) return false;

  const incomingStatus = typeof raw.status === 'string' ? raw.status : null;
  if (prev && isTerminalStatus(prev.status) && incomingStatus && incomingStatus !== prev.status) {
    return false;
  }

  const next = toJobEntry(raw, prev);
  if (prev) {
    if (isTerminalStatus(prev.status)) {
      next.status = prev.status;
      next.progress = prev.progress;
    } else {
      next.progress = Math.max(prev.progress, next.progress);
    }
  }
  next.progress = Math.min(100, Math.max(0, next.progress));

  state.jobs.set(id, next);
  stampVersion(state.jobVersions, id, token);
  state.removedJobs.delete(id);
  if (isTerminalStatus(next.status)) resolveRequestsFor(id);
  touch();
  return true;
}

function toFileEntry(raw: Record<string, unknown>, prev: FileEntry | undefined): FileEntry {
  const base = prev ? { ...prev } : {};
  return {
    ...base,
    ...raw,
    id: String(raw.id),
    originalName:
      typeof raw.originalName === 'string' ? raw.originalName : (prev?.originalName ?? ''),
    status: typeof raw.status === 'string' ? raw.status : (prev?.status ?? 'ready'),
    size: numberOr(raw.size, prev?.size ?? 0),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : (prev?.createdAt ?? ''),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : (prev?.updatedAt ?? ''),
    // A row the server knows about is uploaded by definition; the upload leg of
    // §2.2's composition only ever runs against overlay rows.
    uploadProgress: 100,
    localOnly: false,
    jobId: prev?.jobId ?? null,
    composedProgress: prev?.composedProgress ?? 0,
  };
}

function mergeFile(raw: Record<string, unknown>, token: WriteToken): boolean {
  const id = typeof raw.id === 'string' ? raw.id : String(raw.id ?? '');
  if (!id) return false;
  const status = String(raw.status || '');
  if (status === 'deleted' || status === 'missing') return removeFile(id, token);
  const prev = state.files.get(id);
  if (!acceptsWrite(priorVersion(state.fileVersions, state.removedFiles, id), token)) return false;
  state.files.set(id, toFileEntry(raw, prev));
  stampVersion(state.fileVersions, id, token);
  state.removedFiles.delete(id);
  touch();
  return true;
}

/**
 * Deletion drops the id. Never upsert a "deleted" ghost row back into the list.
 * The row's version is kept as a tombstone so a write that predates the delete
 * cannot bring it back (§6.3); a genuinely newer write may, and clears it.
 */
function removeFile(id: string, token: WriteToken): boolean {
  if (!acceptsWrite(priorVersion(state.fileVersions, state.removedFiles, id), token)) return false;
  stampVersion(state.removedFiles, id, token);
  if (!state.files.has(id)) return false;
  state.files.delete(id);
  state.fileVersions.delete(id);
  state.composed.delete(id);
  touch();
  return true;
}

/* ---------------------------------------------------------------- *
 * Derived links and the §2.2 composed value.
 * ---------------------------------------------------------------- */

function uploadIdsOf(job: JobEntry): string[] {
  const options = job.options || {};
  const raw = options._uploadIds ?? options.uploadIds;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => String(entry)).filter(Boolean);
}

/**
 * Active attempts outrank finished ones; among equals, the newest wins.
 *
 * Every terminal outcome ranks alike so the `createdAt` tie-break in
 * `recomputeLinks` picks the NEWEST attempt. Ranking `completed` below
 * `failed`/`cancelled` handed a file back to the dead attempt the instant its
 * retry succeeded: the §2.2 composed value fell off 99 to the failed attempt's
 * number and could never reach 100, which §6.5 item 3 forbids.
 */
function jobRank(job: JobEntry): number {
  if (job.status === 'running') return 3;
  if (job.status === 'queued') return 2;
  return 1;
}

/**
 * `filePublic` carries no job id — the reverse link exists only through
 * `options._uploadIds`, so it is rebuilt whenever rows change.
 */
function recomputeLinks(): void {
  const owner = new Map<string, JobEntry>();
  for (const job of state.jobs.values()) {
    for (const fileId of uploadIdsOf(job)) {
      const current = owner.get(fileId);
      if (!current) {
        owner.set(fileId, job);
        continue;
      }
      const rankDelta = jobRank(job) - jobRank(current);
      if (rankDelta > 0 || (rankDelta === 0 && timeOf(job.createdAt) >= timeOf(current.createdAt))) {
        owner.set(fileId, job);
      }
    }
  }

  for (const [id, file] of state.files) {
    const job = owner.get(id) || null;
    const composed = composeProgress(file.uploadProgress, job, id);
    if (file.jobId !== (job?.id ?? null) || file.composedProgress !== composed) {
      state.files.set(id, { ...file, jobId: job?.id ?? null, composedProgress: composed });
    }
  }
  for (const row of state.overlay.values()) {
    composeProgress(row.uploadProgress, null, row.clientId);
  }
}

/**
 * SPEC §2.2, the pre-rebuild `useJobRunner` mapping kept verbatim: upload 0–30,
 * job execution 30–99, 100 only on completion. §6.3 makes this displayed value
 * monotonic too, so the floor is remembered per (file, attempt) — a retry is a
 * new job row, so its floor legitimately restarts at the upload level.
 */
function composeProgress(uploadProgress: number, job: JobEntry | null, fileId: string): number {
  const upload = Math.min(100, Math.max(0, uploadProgress));
  let value: number;
  if (!job) {
    value = Math.round(upload * 0.3);
  } else if (job.status === 'completed') {
    value = 100;
  } else {
    value = Math.min(99, 30 + Math.round(Math.min(100, Math.max(0, job.progress)) * 0.7));
  }
  const attempt = job?.id ?? null;
  const floor = state.composed.get(fileId);
  if (floor && floor.jobId === attempt) value = Math.max(floor.value, value);
  state.composed.set(fileId, { jobId: attempt, value });
  return value;
}

/* ---------------------------------------------------------------- *
 * Write path 1 — hydrate (SPEC §6.3, §6.5 item 5).
 * ---------------------------------------------------------------- */

function readWorkspaceId(): string | null {
  return readStored('local', WORKSPACE_ID_KEY);
}

function persistWorkspaceId(id: string): void {
  state.workspaceId = id;
  writeStored('local', WORKSPACE_ID_KEY, id);
}

/**
 * Replace the mirror from an authoritative snapshot.
 *
 * "Wholesale" (§6.3) with one exception: a row whose applied `seq` is newer
 * than the snapshot's was created by an event that overtook this response, so
 * dropping it would flicker a just-created row out of the UI and back in.
 * Everything else the snapshot omits is gone.
 */
function applySnapshot(payload: unknown): void {
  if (!isRecord(payload) || typeof payload.id !== 'string') {
    throw new Error('Workspace snapshot did not carry an id');
  }
  const epoch = typeof payload.epoch === 'string' ? payload.epoch : null;
  const seq = numberOr(payload.seq, 0);
  // Capture the change BEFORE adopting it: testing `epoch === state.epoch`
  // after the assignment is always true, which left the store carrying the old
  // epoch's `seq` into the new one instead of adopting the snapshot's (§6.4:
  // "unknown/changed epoch → drop ordering state, re-hydrate, adopt new epoch").
  const epochChanged = Boolean(epoch) && epoch !== state.epoch;
  if (epochChanged) {
    state.epoch = epoch;
    clearOrderingState();
  }
  state.seq = epochChanged ? seq : Math.max(state.seq, seq);

  persistWorkspaceId(payload.id);
  state.route = typeof payload.route === 'string' ? payload.route : state.route;
  state.selectedFileIds = Array.isArray(payload.selectedFileIds)
    ? payload.selectedFileIds.map((entry) => String(entry))
    : [];
  state.ui = isRecord(payload.ui) ? payload.ui : {};
  state.outputs = Array.isArray(payload.outputs)
    ? payload.outputs.filter(isRecord).map((entry) => ({
        ...entry,
        id: String(entry.id),
        name: typeof entry.name === 'string' ? entry.name : '',
      }))
    : [];
  // NOTE: `payload.activity` is deliberately not mirrored — SPEC §3.2 makes
  // Activity a view concern read straight through api/client.js.

  const token = (updatedAt: unknown): WriteToken => ({
    epoch,
    seq,
    updatedAt: timeOf(updatedAt),
  });

  const jobRows = Array.isArray(payload.jobs) ? payload.jobs.filter(isRecord) : [];
  const fileRows = Array.isArray(payload.files) ? payload.files.filter(isRecord) : [];
  const jobIds = new Set(jobRows.map((row) => String(row.id)));
  const fileIds = new Set(fileRows.map((row) => String(row.id)));

  const survivesRemoval = (version: RowVersion | undefined): boolean =>
    Boolean(version && version.epoch === epoch && version.seq !== null && version.seq > seq);

  // A row the snapshot omits is gone. Its tombstone carries the snapshot's
  // stream position (so a same-epoch event from before this snapshot cannot
  // recreate it) together with the row's own last-applied time (so a poll,
  // which has no comparable `seq`, is still judged against the row it lost).
  const tombstone = (existing: RowVersion | undefined): WriteToken => ({
    epoch,
    seq,
    updatedAt: existing?.updatedAt ?? 0,
  });

  for (const id of [...state.jobs.keys()]) {
    const existing = state.jobVersions.get(id);
    if (jobIds.has(id) || survivesRemoval(existing)) continue;
    state.jobs.delete(id);
    state.jobVersions.delete(id);
    stampVersion(state.removedJobs, id, tombstone(existing));
  }
  for (const id of [...state.files.keys()]) {
    const existing = state.fileVersions.get(id);
    if (fileIds.has(id) || survivesRemoval(existing)) continue;
    state.files.delete(id);
    state.fileVersions.delete(id);
    state.composed.delete(id);
    stampVersion(state.removedFiles, id, tombstone(existing));
  }

  for (const row of jobRows) mergeJob(row, token(row.updatedAt));
  for (const row of fileRows) mergeFile(row, token(row.updatedAt));

  state.hydratedAt = Date.now();
  touch();
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, state.failedAttempts - 1));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void hydrate();
  }, delay);
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Workspace is unreachable';
}

/**
 * Recover the persisted workspace and replace the mirror.
 *
 * On failure this surfaces a persistent error and retries with backoff. It does
 * NOT drop the persisted id and does NOT create a replacement workspace —
 * `hooks/useWorkspace.js` did exactly that and silently orphaned the user's
 * workspace on a transient failure (SPEC §6.5 item 5 forbids it). Creating a
 * new workspace is an explicit user action: `createWorkspace()`.
 */
export async function hydrate(options: { route?: string } = {}): Promise<StoreSnapshot> {
  generation += 1;
  const mine = generation;
  hydrateGeneration = mine;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const route = options.route ?? state.route ?? undefined;
  if (route) state.route = route;
  if (state.status !== 'ready') {
    state.status = 'hydrating';
    touch();
    flush();
  }

  const storedId = readWorkspaceId() || undefined;
  try {
    const payload = await client.recoverWorkspace({ id: storedId, route });
    if (mine !== generation) return getSnapshot();
    applySnapshot(payload);
    state.status = 'ready';
    state.error = null;
    state.failedAttempts = 0;
  } catch (error) {
    if (mine !== generation) return getSnapshot();
    state.failedAttempts += 1;
    state.status = 'error';
    state.error = {
      message: describeError(error),
      attempt: state.failedAttempts,
      retrying: true,
    };
    scheduleRetry();
  } finally {
    if (hydrateGeneration === mine) {
      hydrateGeneration = null;
      if (resyncPending) {
        // The epoch moved while this load was in flight, so the payload it just
        // applied may predate the new epoch. Replay the suppressed resync now
        // that one can actually start (§6.4).
        resyncPending = false;
        void hydrate();
      }
    }
    touch();
    flush();
  }
  return getSnapshot();
}

/** The user-facing recovery action behind the §6.5 item 5 ErrorState. */
export function retryHydrate(): Promise<StoreSnapshot> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  return hydrate();
}

/**
 * Create a NEW workspace. Only ever called from an explicit user action — never
 * as automatic recovery (§6.5 item 5).
 */
export async function createWorkspace(options: { route?: string } = {}): Promise<StoreSnapshot> {
  generation += 1;
  const mine = generation;
  hydrateGeneration = mine;
  try {
    const created = await client.createWorkspace({ route: options.route });
    if (!isRecord(created) || typeof created.id !== 'string') {
      throw new Error('Workspace creation did not return an id');
    }
    const payload = await client.getWorkspace(created.id);
    if (mine !== generation) return getSnapshot();
    state.files.clear();
    state.fileVersions.clear();
    state.jobs.clear();
    state.jobVersions.clear();
    // A new workspace shares no ids with the old one, so its deletion history
    // must not outlive it and gate rows that are unrelated to it.
    state.removedFiles.clear();
    state.removedJobs.clear();
    state.composed.clear();
    state.sessions.clear();
    applySnapshot(payload);
    state.status = 'ready';
    state.error = null;
    state.failedAttempts = 0;
    touch();
    flush();
    return getSnapshot();
  } finally {
    // Released even when creation throws — otherwise a failed create would
    // block every later resync (§6.4).
    if (hydrateGeneration === mine) {
      hydrateGeneration = null;
      resyncPending = false;
    }
  }
}

/* ---------------------------------------------------------------- *
 * Write path 2 — SSE events (fed by protocol/events.ts, B3).
 * ---------------------------------------------------------------- */

/**
 * Apply one workspace event envelope (`emitWorkspaceEvent`, §6.4).
 *
 * An unknown or changed epoch means the server restarted: ordering state is
 * dropped, the new epoch adopted, and a full re-hydrate requested (§6.3). Events
 * keep applying meanwhile — under the new epoch they are the newest truth
 * available, and the row-level gate still protects every row.
 */
export function applyEvent(raw: unknown): void {
  if (!isRecord(raw)) return;
  const epoch = typeof raw.epoch === 'string' ? raw.epoch : null;
  const seq = Number.isFinite(Number(raw.seq)) ? Number(raw.seq) : null;

  if (epoch && state.epoch && epoch !== state.epoch) {
    state.epoch = epoch;
    state.seq = seq ?? 0;
    clearOrderingState();
    touch();
    requestResync();
  } else if (epoch && !state.epoch) {
    state.epoch = epoch;
    touch();
  }
  if (epoch && epoch === state.epoch && seq !== null && seq > state.seq) {
    state.seq = seq;
    touch();
  }

  const type = typeof raw.type === 'string' ? raw.type : '';
  // The gate is per row, so the token carries the ROW's `updatedAt` when the
  // envelope attaches a DTO — the envelope's own timestamp is minted when the
  // event is emitted and can tie with an older poll of the same row, which is
  // exactly the regression §6.3 forbids. The envelope time is the fallback.
  const token = (rowUpdatedAt?: unknown): WriteToken => ({
    epoch,
    seq,
    updatedAt: timeOf(rowUpdatedAt ?? raw.updatedAt),
  });

  if (type === 'file.deleted' || type === 'file.removed') {
    const fileId = typeof raw.fileId === 'string' ? raw.fileId : null;
    if (fileId) removeFile(fileId, token());
    flush();
    return;
  }

  const fileRow = isRecord(raw.file) ? raw.file : null;
  if (fileRow) {
    const updatedAt = fileRow.updatedAt ?? raw.updatedAt;
    mergeFile({ ...fileRow, updatedAt }, token(updatedAt));
  }

  const jobRow = isRecord(raw.job) ? raw.job : null;
  if (jobRow) {
    const updatedAt = jobRow.updatedAt ?? raw.updatedAt;
    mergeJob({ ...jobRow, updatedAt }, token(updatedAt));
  } else if (typeof raw.jobId === 'string' && type.startsWith('job')) {
    // Scalar-only envelope (no DTO attached): merge what it carries, nothing more.
    mergeJob(
      {
        id: raw.jobId,
        status: raw.status ?? undefined,
        progress: raw.progress ?? undefined,
        message: raw.message ?? null,
        updatedAt: raw.updatedAt,
      },
      token(),
    );
  }

  flush();
}

/** One re-hydrate per epoch change, not one per event that reports it. */
function requestResync(): void {
  if (hydrateGeneration !== null) {
    // Not dropped: the load in flight may have been issued before the epoch
    // changed, so its snapshot can carry the old epoch (§6.4).
    resyncPending = true;
    return;
  }
  void hydrate();
}

/* ---------------------------------------------------------------- *
 * Write path 3 — polls (the SSE fallback path).
 * ---------------------------------------------------------------- */

/**
 * Apply a polled payload — `{ jobs?, files?, job?, file? }`. Poll results carry
 * no stream position, so they are gated on row `updatedAt` and they clear the
 * row's `seq`: a poll cannot regress an SSE event, and a stale SSE event cannot
 * regress a poll (§6.3).
 */
export function applyPoll(payload: unknown): void {
  if (!isRecord(payload)) return;
  const epoch = typeof payload.epoch === 'string' ? payload.epoch : null;
  const seq = Number.isFinite(Number(payload.seq)) ? Number(payload.seq) : null;
  const rows = (value: unknown, single: unknown): Record<string, unknown>[] => {
    const list = Array.isArray(value) ? value : [];
    const one = isRecord(single) ? [single] : [];
    return [...list.filter(isRecord), ...one];
  };

  for (const row of rows(payload.jobs, payload.job)) {
    mergeJob(row, { epoch, seq, updatedAt: timeOf(row.updatedAt) });
  }
  for (const row of rows(payload.files, payload.file)) {
    mergeFile(row, { epoch, seq, updatedAt: timeOf(row.updatedAt) });
  }
  flush();
}

/** Mirror the server's upload-session listing (fed by `protocol/uploads.ts`). */
export function setUploadSessions(sessions: unknown): void {
  if (!Array.isArray(sessions)) return;
  state.sessions.clear();
  for (const entry of sessions) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    state.sessions.set(entry.id, {
      ...entry,
      id: entry.id,
      originalName: typeof entry.originalName === 'string' ? entry.originalName : '',
      size: numberOr(entry.size, 0),
      receivedBytes: numberOr(entry.receivedBytes, 0),
      status: typeof entry.status === 'string' ? entry.status : 'uploading',
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
    });
  }
  touch();
  flush();
}

/* ---------------------------------------------------------------- *
 * Write path 4 — the optimistic overlay (SPEC §6.2). Limited, by that
 * section, to file rows during upload and requested-flags on
 * cancel/delete/convert. Nothing else may be optimistic.
 * ---------------------------------------------------------------- */

/** Report an in-flight upload. Progress is monotonic here too (§6.5 item 3). */
export function optimisticUpload(input: {
  clientId: string;
  name?: string;
  size?: number;
  mime?: string | null;
  progress?: number;
  status?: string;
}): void {
  const clientId = String(input.clientId || '');
  if (!clientId) return;
  const prev = state.overlay.get(clientId);
  const now = new Date().toISOString();
  const progress = Math.min(100, Math.max(0, numberOr(input.progress, prev?.uploadProgress ?? 0)));
  state.overlay.set(clientId, {
    clientId,
    originalName: input.name ?? prev?.originalName ?? '',
    size: numberOr(input.size, prev?.size ?? 0),
    mime: input.mime ?? prev?.mime ?? null,
    status: input.status ?? prev?.status ?? 'uploading',
    uploadProgress: Math.max(prev?.uploadProgress ?? 0, progress),
    error: prev?.error ?? null,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    serverFileId: prev?.serverFileId ?? null,
  });
  touch();
  flush();
}

/** The upload failed before the server ever had a row (§2.4 error state). */
export function failOptimisticUpload(clientId: string, message: string): void {
  const prev = state.overlay.get(clientId);
  if (!prev) return;
  state.overlay.set(clientId, {
    ...prev,
    status: 'upload-failed',
    error: message,
    updatedAt: new Date().toISOString(),
  });
  touch();
  flush();
}

/**
 * The upload committed: the overlay row hands off to the server row. If that
 * row has not arrived yet the overlay is kept, tagged with its future id, and
 * retired the moment it lands — so the file never blinks out of the list and
 * never appears twice.
 */
export function resolveOptimisticUpload(clientId: string, fileId?: string | null): void {
  const prev = state.overlay.get(clientId);
  if (!prev) return;
  state.composed.delete(clientId);
  if (!fileId || state.files.has(fileId)) {
    state.overlay.delete(clientId);
  } else {
    state.overlay.set(clientId, { ...prev, serverFileId: fileId, status: 'finalizing' });
  }
  touch();
  flush();
}

function pruneOverlay(): void {
  for (const [clientId, row] of state.overlay) {
    if (row.serverFileId && state.files.has(row.serverFileId)) {
      state.overlay.delete(clientId);
      state.composed.delete(clientId);
    }
  }
}

export function requestKey(kind: RequestKind, targetId: string): string {
  return `${kind}:${targetId}`;
}

/**
 * Flag a requested cancel/delete/convert. The client never patches the row's
 * status (§6.2) — it renders "requested" until the server answers, the job
 * reaches a terminal state, or the request times out. A request against an
 * already-terminal job is refused: optimistic state may never overwrite a
 * server-terminal status.
 */
export function optimisticRequest(
  kind: RequestKind,
  targetId: string,
  options: { clientRequestId?: string } = {},
): string {
  const key = requestKey(kind, targetId);
  const job = state.jobs.get(targetId);
  if (job && isTerminalStatus(job.status)) return key;
  if (state.requests.has(key)) return key;

  state.requests.set(key, {
    key,
    kind,
    targetId,
    clientRequestId: options.clientRequestId ?? null,
    requestedAt: Date.now(),
  });
  const timer = setTimeout(() => {
    requestTimers.delete(key);
    if (state.requests.delete(key)) {
      touch();
      flush();
    }
  }, REQUEST_TIMEOUT_MS);
  requestTimers.set(key, timer);
  touch();
  flush();
  return key;
}

/** The server answered — drop the flag and render whatever the server returned. */
export function resolveRequest(key: string): void {
  const timer = requestTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    requestTimers.delete(key);
  }
  if (state.requests.delete(key)) {
    touch();
    flush();
  }
}

function resolveRequestsFor(targetId: string): void {
  for (const kind of ['cancel', 'delete', 'convert'] as RequestKind[]) {
    const key = requestKey(kind, targetId);
    const timer = requestTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      requestTimers.delete(key);
    }
    if (state.requests.delete(key)) touch();
  }
}

/* ---------------------------------------------------------------- *
 * Job-resume pointers (SPEC §6.1 key, §6.5 item 2 behavior).
 * ---------------------------------------------------------------- */

export function rememberActiveJob(hubId: string, modeId: string, jobId: string): void {
  if (!jobId) return;
  writeStored('session', activeJobKey(hubId, modeId), jobId);
}

export function readActiveJobId(hubId: string, modeId: string): string | null {
  return readStored('session', activeJobKey(hubId, modeId));
}

export function forgetActiveJob(hubId: string, modeId: string): void {
  clearStored('session', activeJobKey(hubId, modeId));
}

/**
 * Resolve the job to re-attach to after a reload, guarded by the hub+mode's
 * expected job type (§6.5 item 2) — a pointer to another hub's job, or to a job
 * the server no longer reports, resolves to `null` and is dropped rather than
 * re-attaching the wrong progress to the wrong screen.
 */
export function resolveActiveJob(
  hubId: string,
  modeId: string,
  expectedJobType?: string,
): JobEntry | null {
  const jobId = readActiveJobId(hubId, modeId);
  if (!jobId) return null;
  const job = state.jobs.get(jobId);
  if (!job || (expectedJobType && job.type !== expectedJobType)) {
    forgetActiveJob(hubId, modeId);
    return null;
  }
  return job;
}

/* ---------------------------------------------------------------- *
 * Selectors — pure reads over a snapshot.
 * ---------------------------------------------------------------- */

export function selectJob(snap: StoreSnapshot, jobId: string): JobEntry | null {
  return snap.jobs.find((job) => job.id === jobId) ?? null;
}

export function selectFile(snap: StoreSnapshot, fileId: string): FileEntry | null {
  return snap.files.find((file) => file.id === fileId) ?? null;
}

export function selectActiveJobs(snap: StoreSnapshot): JobEntry[] {
  return snap.jobs.filter((job) => job.status === 'running' || job.status === 'queued');
}

export function isRequested(snap: StoreSnapshot, kind: RequestKind, targetId: string): boolean {
  const key = requestKey(kind, targetId);
  return snap.pending.some((entry) => entry.key === key);
}

/** The §2.2 composed value for one file. */
export function selectComposedProgress(snap: StoreSnapshot, fileId: string): number {
  return selectFile(snap, fileId)?.composedProgress ?? 0;
}

/** The run bar's value: the arithmetic mean of the batch's composed values (§2.2). */
export function selectRunProgress(snap: StoreSnapshot, fileIds: string[]): number {
  const values = fileIds
    .map((id) => selectFile(snap, id))
    .filter((file): file is FileEntry => file !== null)
    .map((file) => file.composedProgress);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
