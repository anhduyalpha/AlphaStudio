import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import {
  config,
  computeDefaultMaxConcurrentJobs,
  type JobCategory,
} from '../config.js';
import {
  getDb,
  dbGetJob,
  dbGetFile,
  dbUpdateJobProgress,
  getJobResultCache,
  setJobResultCache,
  deleteJobResultCache,
  type JobRow,
} from '../db/index.js';
import { logger } from '../lib/logger.js';
import { badRequest, notFound } from '../lib/errors.js';
import { deleteTerminalJob, type JobDeletionResult } from '../services/job-deletion.js';
import { assertJobCapable } from '../processors/index.js';
import type { ProcessResult } from '../processors/types.js';
import { killJobChildren, killProcessTreeByPid } from '../lib/child-registry.js';
import { emitWorkspaceEvent, nextEventVersion } from '../lib/workspace-events.js';
import { sanitizeUserError } from '../lib/sanitize.js';
import {
  extractPassword,
  redactSensitiveOptions,
} from '../pdf/operation-options.js';
import {
  WORKER_PROTOCOL_VERSION,
  boundedWorkerMessage,
  isWorkerToApiMessage,
  type ApiToWorkerMessage,
  type WorkerJobPayload,
  type WorkerToApiMessage,
} from './ipc.js';

export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(200);

/**
 * Ephemeral password vault: passwords exist only for the job duration in the
 * API process memory, never written to SQLite options/result JSON.
 * Re-injected into worker IPC payload only when the job starts.
 */
const jobPasswordVault = new Map<string, string>();

export function clearJobPassword(jobId: string): void {
  jobPasswordVault.delete(jobId);
}

/** Test helper: inspect whether a password is vaulted (never returns the secret). */
export function hasVaultedPassword(jobId: string): boolean {
  return jobPasswordVault.has(jobId);
}

/** Progress DB write: delta ≥ 5% OR message change OR force; also flush pending every 500ms. */
export const PROGRESS_MIN_DELTA = 5;
export const PROGRESS_MIN_INTERVAL_MS = 500;

type CreateJobInput = {
  type: string;
  uploadIds?: string[];
  options?: Record<string, unknown>;
  workspaceId?: string | null;
  /** Optional client-supplied idempotency token (also read from options). */
  clientRequestId?: string;
  /** Optional explicit dedupe key (also read from options). */
  dedupeKey?: string;
};

const cancelFlags = new Map<string, boolean>();

const JOB_CATEGORIES: JobCategory[] = ['image', 'pdf', 'media', 'office', 'general'];
const IMAGE_FORMATS = new Set(['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp']);
const MEDIA_FORMATS = new Set(['aac', 'avi', 'flac', 'm4a', 'mkv', 'mov', 'mp3', 'mp4', 'ogg', 'opus', 'wav', 'webm']);
const OFFICE_FORMATS = new Set(['doc', 'docx', 'odp', 'ods', 'odt', 'ppt', 'pptx', 'rtf', 'xls', 'xlsx']);
const OPTIONAL_DOCUMENT_FORMATS = new Set(['asciidoc', 'azw3', 'epub', 'fb2', 'htmlz', 'mobi', 'rst']);
const OFFICE_ROUTED_INPUT_FORMATS = new Set([...OFFICE_FORMATS, ...OPTIONAL_DOCUMENT_FORMATS]);

type ActiveLease = {
  job: JobRow;
  jobId: string;
  lease: string;
  category: JobCategory;
  cacheKey: string | null;
  progress: ReturnType<typeof createProgressBatcher>;
  timeout: NodeJS.Timeout | null;
  forceKill: NodeJS.Timeout | null;
  stopReason: 'cancel' | 'timeout' | 'shutdown' | null;
  settling: boolean;
};

type WorkerSlot = {
  id: string;
  child: ChildProcess;
  ready: boolean;
  intentionalStop: boolean;
  lastHeartbeatAt: number;
  startedAt: number;
  restarts: number;
  externalPids: Set<number>;
  active: ActiveLease | null;
};

const workerSlots = new Map<string, WorkerSlot>();
let workerSequence = 0;
let workerPoolStarted = false;
let workerPoolStopping = false;
let workerWatchdog: NodeJS.Timeout | null = null;
let workerCrashCount = 0;
let pumpPending = false;
const settlementTasks = new Set<Promise<void>>();

function activeWorkerCount(): number {
  let active = 0;
  for (const slot of workerSlots.values()) if (slot.active) active += 1;
  return active;
}

export function classifyJobCategory(
  type: string,
  options: Record<string, unknown> = {},
  inputNames: string[] = [],
): JobCategory {
  if (type === 'image' || type === 'qr') return 'image';
  if (type === 'pdf') return 'pdf';
  if (type === 'media' || type === 'audio') return 'media';
  if (type !== 'converter') return 'general';

  const format = String(options.format ?? options.outputFormat ?? options.to ?? '')
    .replace(/^\./, '')
    .toLowerCase();
  const inputExts = inputNames.map((name) => path.extname(name).slice(1).toLowerCase());

  // LibreOffice is selected primarily by the input family. Check it before
  // output formats so DOCX→PDF/PPTX→PNG cannot bypass the office=1 ceiling.
  if (inputExts.some((ext) => OFFICE_ROUTED_INPUT_FORMATS.has(ext))) return 'office';
  if (OFFICE_FORMATS.has(format) || OPTIONAL_DOCUMENT_FORMATS.has(format)) return 'office';
  if (format === 'pdf') return 'pdf';
  if (MEDIA_FORMATS.has(format)) return 'media';
  if (IMAGE_FORMATS.has(format)) return 'image';

  if (inputExts.some((ext) => ext === 'pdf')) return 'pdf';
  if (inputExts.some((ext) => MEDIA_FORMATS.has(ext))) return 'media';
  if (inputExts.some((ext) => IMAGE_FORMATS.has(ext))) return 'image';
  return 'general';
}

/** Pool stats for diagnostics / tests (in-memory only — never blocks API). */
export function getWorkerPoolStats(): { activeCount: number; maxConcurrentJobs: number } {
  return { activeCount: activeWorkerCount(), maxConcurrentJobs: effectiveWorkerPoolSize() };
}

/** Sorted upload ids from a job row (options._uploadIds preferred, else input_files). */
function extractJobUploadIds(job: JobRow): string[] {
  const opts = safeParse(job.options) as Record<string, unknown>;
  if (Array.isArray(opts._uploadIds)) {
    return (opts._uploadIds as unknown[]).map(String).sort();
  }
  if (Array.isArray(opts.uploadIds)) {
    return (opts.uploadIds as unknown[]).map(String).sort();
  }
  const inputs = safeParse(job.input_files) as Array<{ uploadId?: string }>;
  return inputs
    .map((i) => i.uploadId)
    .filter((id): id is string => Boolean(id))
    .map(String)
    .sort();
}

/**
 * Find an active (queued|running) job matching workspace + uploads + normalized options.
 * When clientRequestId / dedupeKey are provided, those also match against stored options.
 */
export function findActiveDuplicateJob(params: {
  type: string;
  workspaceId: string | null;
  uploadIds: string[];
  options: Record<string, unknown>;
  clientRequestId?: string;
  dedupeKey?: string;
}): JobRow | undefined {
  const db = getDb();
  const ws = params.workspaceId;
  const candidates = (
    ws
      ? (db
          .prepare(
            `SELECT * FROM jobs WHERE type = ? AND status IN ('queued','running') AND workspace_id = ?
             ORDER BY created_at ASC`,
          )
          .all(params.type, ws) as JobRow[])
      : (db
          .prepare(
            `SELECT * FROM jobs WHERE type = ? AND status IN ('queued','running')
             AND (workspace_id IS NULL OR workspace_id = '')
             ORDER BY created_at ASC`,
          )
          .all(params.type) as JobRow[])
  );

  const sortedUploads = [...params.uploadIds].map(String).sort().join('\0');
  const normOpts = JSON.stringify(normalizeOptionsForCache(params.options));

  for (const row of candidates) {
    const opts = safeParse(row.options) as Record<string, unknown>;

    if (
      params.dedupeKey &&
      String(opts.dedupeKey ?? opts._dedupeKey ?? '') === params.dedupeKey
    ) {
      return row;
    }
    if (
      params.clientRequestId &&
      String(opts.clientRequestId ?? opts._clientRequestId ?? '') === params.clientRequestId
    ) {
      return row;
    }

    const rowUploads = extractJobUploadIds(row).join('\0');
    if (rowUploads !== sortedUploads) continue;
    if (JSON.stringify(normalizeOptionsForCache(opts)) !== normOpts) continue;
    return row;
  }
  return undefined;
}

export function createJob(input: CreateJobInput): JobRow {
  const type = input.type;
  if (!type) throw badRequest('type required');

  // Clone so we can attach _uploadIds / idempotency tokens without mutating caller state
  const incoming = { ...(input.options || {}) };
  // Capture password for in-memory vault only — never persist secrets to SQLite
  const capturedPassword = extractPassword(incoming);
  const options: Record<string, unknown> = redactSensitiveOptions(incoming);
  const clientRequestId =
    input.clientRequestId != null
      ? String(input.clientRequestId)
      : options.clientRequestId != null
        ? String(options.clientRequestId)
        : undefined;
  const dedupeKey =
    input.dedupeKey != null
      ? String(input.dedupeKey)
      : options.dedupeKey != null
        ? String(options.dedupeKey)
        : undefined;
  if (clientRequestId != null && options.clientRequestId == null) {
    options.clientRequestId = clientRequestId;
  }
  if (dedupeKey != null && options.dedupeKey == null) {
    options.dedupeKey = dedupeKey;
  }

  assertJobCapable(type, options);

  const db = getDb();
  const uploadIds = input.uploadIds || [];
  // Persist upload ids for client-side duplicate detection (converterGroups.hasActiveDuplicateJob)
  if (uploadIds.length > 0 && !Array.isArray(options._uploadIds)) {
    options._uploadIds = [...uploadIds].map(String).sort();
  }

  const uploads = uploadIds.map((id) => {
    const row = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as
      | { id: string; path: string; original_name: string }
      | undefined;
    if (!row) throw badRequest(`Unknown upload id: ${id}`);
    if (!fs.existsSync(row.path)) throw badRequest(`Upload missing on disk: ${id}`);
    return row;
  });

  // Text-only jobs may have no uploads
  const needsFile = !['text'].includes(type) && !(type === 'qr' && options.operation === 'generate') && !(type === 'security' && options.operation === 'password');
  if (needsFile && uploads.length === 0 && typeof options.input !== 'string') {
    // qr generate / text / password ok without files
    if (!(type === 'qr' && String(options.operation) === 'generate') && type !== 'text' && !(type === 'security' && String(options.operation) === 'password')) {
      throw badRequest('At least one upload is required');
    }
  }

  const workspaceId = input.workspaceId || null;

  // Converter always dedupes; other types only when client supplies an idempotency key
  const shouldDedupe = type === 'converter' || Boolean(clientRequestId) || Boolean(dedupeKey);
  if (shouldDedupe) {
    const existing = findActiveDuplicateJob({
      type,
      workspaceId,
      uploadIds,
      options,
      clientRequestId,
      dedupeKey,
    });
    if (existing) return existing;
  }

  const id = uuid();
  const now = new Date().toISOString();
  const inputFiles = uploads.map((u) => ({
    uploadId: u.id,
    path: u.path,
    name: u.original_name,
  }));
  const category = classifyJobCategory(
    type,
    options,
    inputFiles.map((inputFile) => inputFile.name),
  );

  db.prepare(
    `INSERT INTO jobs (
       id, type, status, progress, message, input_files, options, created_at, updated_at,
       workspace_id, tool, job_category, max_attempts, retryable, error_code
     ) VALUES (?, ?, 'queued', 0, 'Queued', ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
  ).run(
    id,
    type,
    JSON.stringify(inputFiles),
    JSON.stringify(options),
    now,
    now,
    workspaceId,
    type,
    category,
    config.maxJobAttempts,
  );

  if (capturedPassword) {
    jobPasswordVault.set(id, capturedPassword);
  }

  // job_files links (workspace files table)
  const link = db.prepare(
    `INSERT OR IGNORE INTO job_files (job_id, file_id, role) VALUES (?, ?, 'input')`,
  );
  for (const u of uploads) {
    try {
      link.run(id, u.id);
    } catch {
      /* ignore if file row missing */
    }
  }

  logActivity({
    jobId: id,
    tool: type,
    action: `${type}:${String(options.operation || 'run')}`,
    status: 'queued',
    detail: `Job ${id} queued`,
  });

  pumpQueue();
  const created = getJob(id)!;
  emitJob(created, 'created');
  return created;
}

export function getJob(id: string): JobRow | undefined {
  return dbGetJob(id);
}

export function listJobs(limit = 50): JobRow[] {
  return getDb()
    .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as JobRow[];
}

/**
 * Permanently delete a terminal job history entry (completed/failed/cancelled).
 * - Rejects active queued/running jobs (cancel first).
 * - Removes trusted output file(s) under outputsDir only.
 * - Removes related activity rows and best-effort result cache by output path.
 * Does NOT delete source uploads shared with other jobs.
 */
export function deleteJob(id: string): JobDeletionResult {
  const job = getJob(id);
  if (!job) throw notFound('Job not found');
  const result = deleteTerminalJob(job);
  cancelFlags.delete(id);
  clearJobPassword(id);

  // Do NOT write a new activity timeline row here — that would re-surface the
  // deleted job's filename in history. Server log is enough for audit.
  logger.info(
    { jobId: id, type: job.type, outputName: job.output_name, deletedOutput: result.deletedOutput, cleanup: result.cleanup },
    'Job history entry deleted',
  );
  return result;
}

export function cancelJob(id: string): JobRow {
  const job = getJob(id);
  if (!job) throw notFound('Job not found');
  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    return job;
  }
  cancelFlags.set(id, true);
  // Backward-compatible safety net for any API-side helper that registered a
  // child before process-worker dispatch (normal conversions register in the worker).
  killJobChildren(id);
  // Process workers own conversion state; parent mirrors external PIDs so a
  // blocked FFmpeg/LibreOffice tree can still be terminated immediately.
  const workerStopRequested = job.status === 'running' && cancelWorkerLease(id, 'cancel');
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE jobs SET cancel_requested = 1,
       status = CASE
         WHEN status = 'queued' THEN 'cancelled'
         WHEN status = 'running' AND ? = 0 THEN 'cancelled'
         ELSE status
       END,
       message = 'Cancel requested', updated_at = ?,
       finished_at = CASE
         WHEN status = 'queued' OR (status = 'running' AND ? = 0) THEN ?
         ELSE finished_at
       END
       WHERE id = ?`,
    )
    .run(workerStopRequested ? 1 : 0, now, workerStopRequested ? 1 : 0, now, id);

  const updated = getJob(id)!;
  emitJob(updated, 'updated');
  if (updated.status === 'cancelled') {
    logActivity({
      jobId: id,
      tool: updated.type,
      action: 'cancel',
      status: 'cancelled',
      detail: 'Job cancelled before start',
    });
  }
  return updated;
}

export function jobPublic(job: JobRow) {
  const rawOptions = safeParse(job.options) as Record<string, unknown>;
  const safeOptions = redactSensitiveOptions(
    rawOptions && typeof rawOptions === 'object' ? rawOptions : {},
  );
  const rawMeta = job.result_json ? (safeParse(job.result_json) as Record<string, unknown>) : null;
  const safeMeta =
    rawMeta && typeof rawMeta === 'object' ? redactSensitiveOptions(rawMeta) : rawMeta;
  return {
    id: job.id,
    type: job.type,
    tool: job.tool || job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    options: safeOptions,
    meta: safeMeta,
    outputName: job.output_name,
    outputMime: job.output_mime,
    downloadUrl: job.status === 'completed' && job.output_path ? `/api/jobs/${job.id}/download` : null,
    workspaceId: job.workspace_id || null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    cancelRequested: Boolean(job.cancel_requested),
    category: job.job_category || 'general',
    attemptCount: Number(job.attempt_count || 0),
    maxAttempts: Number(job.max_attempts || config.maxJobAttempts),
    retryable: Boolean(job.retryable),
    errorCode: job.error_code || null,
  };
}

/**
 * Atomically claim the oldest queued job into running status.
 * Returns claimed id or null if none available / race lost.
 */
function claimNextQueuedJobRow(
  categories: JobCategory[] = JOB_CATEGORIES,
  workerId = 'manual-claim',
): JobRow | null {
  const db = getDb();
  const now = new Date().toISOString();
  const allowed = [...new Set(categories.filter((category) => JOB_CATEGORIES.includes(category)))];
  if (allowed.length === 0) return null;
  const lease = uuid();
  const timeoutAt = new Date(Date.now() + config.jobTimeoutMs).toISOString();
  const placeholders = allowed.map(() => '?').join(',');

  // Single SQLite statement: the status predicate is checked in the same write
  // that returns the lease, so two API instances/connections cannot both claim it.
  const claimed = db
    .prepare(
      `UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?),
       updated_at = ?, progress = 1, message = 'Starting', worker_id = ?, worker_lease = ?,
       claimed_at = ?, last_heartbeat_at = ?, timeout_at = ?, attempt_count = attempt_count + 1,
       retryable = 0, error_code = NULL, error = NULL, finished_at = NULL
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'queued' AND job_category IN (${placeholders})
         ORDER BY created_at ASC LIMIT 1
       ) AND status = 'queued'
       RETURNING *`,
    )
    .get(now, now, workerId, lease, now, now, timeoutAt, ...allowed) as JobRow | undefined;
  return claimed || null;
}

export function claimNextQueuedJob(
  categories: JobCategory[] = JOB_CATEGORIES,
  workerId = 'manual-claim',
): string | null {
  return claimNextQueuedJobRow(categories, workerId)?.id || null;
}

export function pumpQueue(): void {
  if (workerPoolStopping || pumpPending) return;
  if (!workerPoolStarted) startWorkerPool();
  if (effectiveWorkerPoolSize() <= 0) return;
  pumpPending = true;
  setImmediate(() => {
    pumpPending = false;
    ensureWorkerPool();
    pumpReadyWorkers();
  });
}

/**
 * Decide whether a progress tick should hit SQLite.
 * Write when: force, message changed, delta ≥ 5%, or ≥500ms since last write with a change.
 */
export function shouldWriteProgress(opts: {
  lastProgress: number;
  lastMessage: string | null;
  lastWriteAt: number;
  progress: number;
  message?: string;
  force?: boolean;
  now?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  const p = Math.max(0, Math.min(99, opts.progress));
  if (opts.force) return true;
  const messageChanged =
    opts.message !== undefined &&
    opts.message !== null &&
    String(opts.message) !== (opts.lastMessage ?? null);
  if (messageChanged) return true;
  const delta = Math.abs(p - opts.lastProgress);
  if (delta >= PROGRESS_MIN_DELTA) return true;
  const elapsed = now - opts.lastWriteAt;
  if (elapsed >= PROGRESS_MIN_INTERVAL_MS && delta > 0) return true;
  return false;
}

/** Batched progress writer — DB + emit only when shouldWriteProgress says so. */
export function createProgressBatcher(
  jobId: string,
  opts?: { write?: (progress: number, message: string | null) => void },
): {
  update: (progress: number, message?: string, force?: boolean) => void;
  flush: () => void;
  getWriteCount: () => number;
} {
  let lastProgress = -1;
  let lastMessage: string | null = null;
  let lastWriteAt = 0;
  let pendingProgress = 0;
  let pendingMessage: string | null = null;
  let writeCount = 0;

  const doWrite = (progress: number, message: string | null) => {
    const p = Math.max(0, Math.min(99, progress));
    if (opts?.write) {
      opts.write(p, message);
    } else {
      dbUpdateJobProgress(jobId, p, message, new Date().toISOString());
      const j = getJob(jobId);
      if (j) emitJob(j);
    }
    lastProgress = p;
    lastMessage = message;
    lastWriteAt = Date.now();
    writeCount += 1;
  };

  return {
    update(progress: number, message?: string, force = false) {
      if (cancelFlags.get(jobId)) return;
      const p = Math.max(0, Math.min(99, progress));
      pendingProgress = p;
      if (message !== undefined) pendingMessage = message ?? null;
      if (
        shouldWriteProgress({
          lastProgress,
          lastMessage,
          lastWriteAt,
          progress: p,
          message,
          force,
        })
      ) {
        doWrite(p, pendingMessage);
      }
    },
    flush() {
      if (cancelFlags.get(jobId)) return;
      if (lastProgress < 0 || pendingProgress !== lastProgress || pendingMessage !== lastMessage) {
        doWrite(pendingProgress, pendingMessage);
      }
    },
    getWriteCount: () => writeCount,
  };
}

/** Stable JSON for cache keys: sort object keys recursively; drop ephemeral fields. */
export function normalizeOptionsForCache(options: Record<string, unknown>): unknown {
  const skip = new Set([
    '_detectByPath',
    'inputDetects',
    'workspaceId',
    'jobId',
    'onProgress',
    'clientRequestId',
    'dedupeKey',
    // Never include secrets in cache keys or dedupe comparisons
    'password',
    'userPassword',
    'ownerPassword',
    'pdfPassword',
    'pass',
  ]);
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => !skip.has(k) && !k.startsWith('_'))
      .sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = walk(obj[k]);
    return out;
  };
  return walk(options);
}

export function buildJobCacheKey(
  type: string,
  inputChecksums: string[],
  options: Record<string, unknown>,
): string {
  const payload = JSON.stringify({
    type,
    checksums: [...inputChecksums].sort(),
    options: normalizeOptionsForCache(options),
  });
  return createHash('sha256').update(payload).digest('hex');
}

function loadInputChecksumsFast(
  inputs: { uploadId?: string; path: string }[],
): string[] | null {
  // API-side scheduling must remain O(metadata). Upload ingestion computes the
  // checksum; if legacy metadata lacks it, skip the result-cache lookup instead
  // of synchronously hashing a potentially huge file in the Fastify process.
  const checksums: string[] = [];
  for (const inp of inputs) {
    if (inp.uploadId) {
      const file = dbGetFile(inp.uploadId);
      if (file?.checksum) {
        checksums.push(file.checksum);
        continue;
      }
      try {
        const up = getDb()
          .prepare(`SELECT checksum FROM uploads WHERE id = ?`)
          .get(inp.uploadId) as { checksum: string | null } | undefined;
        if (up?.checksum) {
          checksums.push(up.checksum);
          continue;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }
  return checksums;
}

function loadInputDetects(
  inputs: { uploadId?: string; path: string }[],
): Array<Record<string, unknown> | null> {
  return inputs.map((inp) => {
    if (!inp.uploadId) return null;
    try {
      const file = dbGetFile(inp.uploadId);
      if (file?.detect_json) {
        const parsed = JSON.parse(file.detect_json) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
}

/**
 * Validate output exists, is readable, non-empty, and roughly matches declared format
 * before marking a job completed.
 */
export function validateJobOutput(
  result: ProcessResult,
  finalPath: string,
  maxBytes = config.maxOutputBytes,
): { size: number } {
  if (!finalPath || !fs.existsSync(finalPath)) {
    throw badRequest('Output file missing after processing');
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(finalPath);
  } catch {
    throw badRequest('Output file not readable');
  }
  if (!st.isFile()) throw badRequest('Output path is not a file');
  if (st.size <= 0) throw badRequest('Output file is empty');
  if (st.size > maxBytes) {
    throw badRequest(`Output exceeds max size of ${maxBytes} bytes`);
  }

  try {
    const fd = fs.openSync(finalPath, 'r');
    const buf = Buffer.alloc(Math.min(16, st.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    const name = (result.outputName || path.basename(finalPath)).toLowerCase();
    const mime = (result.outputMime || '').toLowerCase();
    const ext = path.extname(name).toLowerCase();

    if ((ext === '.pdf' || mime.includes('pdf')) && st.size >= 5) {
      if (buf.subarray(0, 5).toString('utf8') !== '%PDF-') {
        throw badRequest('Output validation failed: claimed as PDF but content is not a PDF');
      }
    }
    if ((ext === '.txt' || mime.includes('text/plain')) && st.size > 0) {
      // Reject whitespace-only text outputs as success
      let sampleFd: number | null = null;
      try {
        sampleFd = fs.openSync(finalPath, 'r');
        const sampleBuffer = Buffer.alloc(Math.min(st.size, 64 * 1024));
        const bytesRead = fs.readSync(sampleFd, sampleBuffer, 0, sampleBuffer.length, 0);
        const sample = sampleBuffer.subarray(0, bytesRead).toString('utf8');
        if (sample.replace(/\s+/g, '').length === 0) {
          throw badRequest('Output validation failed: text output has no meaningful content');
        }
      } catch (e) {
        if (e && typeof e === 'object' && (e as { code?: string }).code === 'BAD_REQUEST') throw e;
      } finally {
        if (sampleFd != null) fs.closeSync(sampleFd);
      }
    }
    if ((ext === '.png' || mime === 'image/png') && buf.length >= 8) {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (!buf.subarray(0, 8).equals(png)) {
        throw badRequest('Output claimed as PNG but content is not a PNG');
      }
    }
    if ((ext === '.zip' || mime.includes('zip')) && buf.length >= 2) {
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
        throw badRequest('Output claimed as ZIP but content is not a ZIP');
      }
    }
  } catch (err) {
    if (err && typeof err === 'object' && (err as { code?: string }).code === 'BAD_REQUEST') throw err;
    throw badRequest('Output file not readable');
  }

  const declaredExt = path.extname(result.outputName || '').toLowerCase();
  const storedExt = path.extname(finalPath).toLowerCase();
  if (declaredExt && storedExt && declaredExt !== storedExt) {
    const aliases: Record<string, string> = { '.jpeg': '.jpg', '.jpg': '.jpeg' };
    if (aliases[declaredExt] !== storedExt) {
      throw badRequest(
        `Output extension mismatch: declared ${declaredExt} but stored as ${storedExt}`,
      );
    }
  }

  return { size: st.size };
}

async function completeJobSuccess(
  id: string,
  lease: string,
  job: JobRow,
  result: ProcessResult,
  finalPath: string,
  options: Record<string, unknown>,
  cacheKey: string | null,
): Promise<void> {
  const { size } = validateJobOutput(result, finalPath);
  const resultMeta = sanitizeResultMeta(result.meta);

  const doneAt = new Date().toISOString();
  const completed = getDb()
    .prepare(
      `UPDATE jobs SET status = 'completed', progress = 100, message = 'Completed',
       output_path = ?, output_name = ?, output_mime = ?, result_json = ?, finished_at = ?, updated_at = ?,
       error = NULL, error_code = NULL, retryable = 0, cancel_requested = 0,
       worker_id = NULL, worker_lease = NULL, last_heartbeat_at = NULL, timeout_at = NULL
       WHERE id = ? AND status = 'running' AND worker_lease = ?`,
    )
    .run(
      finalPath,
      result.outputName,
      result.outputMime,
      resultMeta ? JSON.stringify(resultMeta) : null,
      doneAt,
      doneAt,
      id,
      lease,
    );
  if (completed.changes !== 1) {
    throw Object.assign(new Error('Worker result belongs to a stale job lease'), {
      code: 'STALE_WORKER_LEASE',
    });
  }

  if (cacheKey) {
    try {
      setJobResultCache({
        cacheKey,
        outputPath: finalPath,
        outputName: result.outputName,
        outputMime: result.outputMime,
        meta: resultMeta,
      });
    } catch (err) {
      logger.debug({ err }, 'job_result_cache store skipped');
    }
  }

  try {
    const { registerJobOutput } = await import('../services/workspace.js');
    registerJobOutput({
      workspaceId: job.workspace_id,
      jobId: id,
      name: result.outputName,
      mime: result.outputMime,
      path: finalPath,
      size,
    });
  } catch {
    /* non-fatal if workspace tables unavailable */
  }

  logActivity({
    jobId: id,
    tool: job.type,
    action: `${job.type}:${String(options.operation || 'run')}`,
    status: 'completed',
    detail: result.outputName,
  });
  clearJobPassword(id);
  emitJob(getJob(id)!);
}


// ── Dedicated process worker pool ──────────────────────────────────────────

function effectiveWorkerPoolSize(): number {
  if (config.maxConcurrentJobs <= 0) return 0;
  if (process.env.WORKER_POOL_SIZE || process.env.MAX_CONCURRENT_JOBS) {
    return Math.max(1, Math.min(32, Math.floor(config.maxConcurrentJobs)));
  }
  // Re-evaluate free RAM at scheduling time while respecting the startup cap.
  return Math.max(
    1,
    Math.min(config.maxConcurrentJobs, computeDefaultMaxConcurrentJobs(os.cpus().length, os.freemem())),
  );
}

function categoryLimit(category: JobCategory): number {
  const poolSize = effectiveWorkerPoolSize();
  return Math.max(0, Math.min(poolSize, config.workerCategoryLimits[category]));
}

function activeByCategory(): Record<JobCategory, number> {
  const counts: Record<JobCategory, number> = {
    image: 0,
    pdf: 0,
    media: 0,
    office: 0,
    general: 0,
  };
  for (const slot of workerSlots.values()) {
    if (slot.active) counts[slot.active.category] += 1;
  }
  return counts;
}

function categoriesWithCapacity(): JobCategory[] {
  const active = activeByCategory();
  return JOB_CATEGORIES.filter((category) => active[category] < categoryLimit(category));
}

function workerEntrypoint(): { modulePath: string; execArgv: string[] } {
  const current = fileURLToPath(import.meta.url);
  const sourceMode = current.endsWith('.ts');
  return {
    modulePath: path.join(path.dirname(current), `worker-process.${sourceMode ? 'ts' : 'js'}`),
    execArgv: sourceMode ? ['--import', 'tsx'] : [],
  };
}

function sendToWorker(slot: WorkerSlot, message: ApiToWorkerMessage): boolean {
  if (!slot.child.connected || !slot.child.send) return false;
  try {
    return slot.child.send(message);
  } catch (error) {
    logger.warn({ error, workerId: slot.id }, 'Worker IPC send failed');
    return false;
  }
}

function spawnWorker(): WorkerSlot {
  const id = `worker-${process.pid}-${++workerSequence}`;
  const entrypoint = workerEntrypoint();
  const child = fork(entrypoint.modulePath, [], {
    execArgv: entrypoint.execArgv,
    env: { ...process.env, ALPHASTUDIO_WORKER_ID: id },
    detached: process.platform !== 'win32',
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const slot: WorkerSlot = {
    id,
    child,
    ready: false,
    intentionalStop: false,
    lastHeartbeatAt: Date.now(),
    startedAt: Date.now(),
    restarts: workerCrashCount,
    externalPids: new Set(),
    active: null,
  };
  workerSlots.set(id, slot);

  child.on('message', (message: unknown) => handleWorkerMessage(slot, message));
  child.once('error', (error) => logger.error({ error, workerId: id }, 'Worker process error'));
  child.once('exit', (code, signal) => handleWorkerExit(slot, code, signal));
  // The HTTP server is the owning lifetime. Test/CLI processes that only use
  // helpers must not be kept alive by an idle IPC channel.
  child.unref();
  child.channel?.unref();
  return slot;
}

function ensureWorkerPool(): void {
  if (!workerPoolStarted || workerPoolStopping) return;
  const desired = effectiveWorkerPoolSize();
  while (workerSlots.size < desired) spawnWorker();

  if (workerSlots.size > desired) {
    const idle = [...workerSlots.values()].filter((slot) => !slot.active && !slot.intentionalStop);
    for (const slot of idle.slice(0, workerSlots.size - desired)) {
      slot.intentionalStop = true;
      // Remove the slot from dispatch eligibility before the asynchronous
      // shutdown message can race with a newly queued job.
      slot.ready = false;
      sendToWorker(slot, {
        protocol: WORKER_PROTOCOL_VERSION,
        type: 'shutdown',
        workerId: slot.id,
      });
    }
  }
}

function prepareWorkerPayload(job: JobRow): {
  payload: WorkerJobPayload;
  cacheKey: string | null;
} {
  const inputs = safeParse(job.input_files) as Array<{
    uploadId?: string;
    path: string;
    name: string;
  }>;
  if (!Array.isArray(inputs) || inputs.length > 20) throw badRequest('Invalid job input list');
  const options = safeParse(job.options) as Record<string, unknown>;
  const checksums = loadInputChecksumsFast(inputs);
  const cacheKey = checksums ? buildJobCacheKey(job.type, checksums, options) : null;
  let cachedResult: WorkerJobPayload['cachedResult'] = null;

  if (cacheKey) {
    const cached = getJobResultCache(cacheKey);
    if (cached && isPathInside(config.outputsDir, cached.output_path)) {
      try {
        const stat = fs.statSync(cached.output_path);
        if (stat.isFile() && stat.size > 0) {
          cachedResult = {
            outputPath: cached.output_path,
            outputName: cached.output_name,
            outputMime: cached.output_mime || 'application/octet-stream',
            meta: cached.result_json
              ? (safeParse(cached.result_json) as Record<string, unknown>)
              : undefined,
          };
        } else {
          deleteJobResultCache(cacheKey);
        }
      } catch {
        deleteJobResultCache(cacheKey);
      }
    } else if (cached) {
      deleteJobResultCache(cacheKey);
    }
  }

  const inputDetects = loadInputDetects(inputs);
  const detectByPath: Record<string, unknown> = {};
  inputs.forEach((input, index) => {
    const detected = inputDetects[index];
    if (!detected) return;
    detectByPath[input.path] = detected;
    detectByPath[path.resolve(input.path)] = detected;
  });
  // Re-inject vaulted password for this job only (never from DB)
  const vaultPassword = jobPasswordVault.get(job.id);
  const optionsWithDetect = {
    ...options,
    ...(Object.keys(detectByPath).length > 0 ? { _detectByPath: detectByPath } : {}),
    ...(vaultPassword ? { password: vaultPassword } : {}),
  };
  const category = JOB_CATEGORIES.includes(job.job_category as JobCategory)
    ? (job.job_category as JobCategory)
    : classifyJobCategory(job.type, options, inputs.map((input) => input.name));

  return {
    cacheKey,
    payload: {
      jobId: job.id,
      lease: String(job.worker_lease || ''),
      type: job.type,
      category,
      inputPaths: inputs.map((input) => input.path),
      inputNames: inputs.map((input) => input.name),
      inputDetects,
      options: optionsWithDetect,
      workDir: path.join(config.tempDir, job.id),
      outputDir: path.join(config.outputsDir, job.id),
      cachedResult,
    },
  };
}

function dispatchToWorker(slot: WorkerSlot, job: JobRow): void {
  const category = JOB_CATEGORIES.includes(job.job_category as JobCategory)
    ? (job.job_category as JobCategory)
    : 'general';
  const progress = createProgressBatcher(job.id);
  const active: ActiveLease = {
    job,
    jobId: job.id,
    lease: String(job.worker_lease || ''),
    category,
    cacheKey: null,
    progress,
    timeout: null,
    forceKill: null,
    stopReason: null,
    settling: false,
  };
  slot.active = active;
  slot.ready = false;
  slot.externalPids.clear();
  active.timeout = setTimeout(() => requestWorkerStop(active, 'timeout'), config.jobTimeoutMs);
  active.timeout.unref?.();

  try {
    const prepared = prepareWorkerPayload(job);
    active.cacheKey = prepared.cacheKey;
    const sent = sendToWorker(slot, {
      protocol: WORKER_PROTOCOL_VERSION,
      type: 'run',
      workerId: slot.id,
      job: prepared.payload,
    });
    if (!sent) throw Object.assign(new Error('Worker IPC channel is unavailable'), { code: 'WORKER_IPC' });
    emitJob(getJob(job.id) || job, 'updated');
  } catch (error) {
    active.settling = true;
    trackSettlement(
      settleWorkerFailure(slot, {
        error: error instanceof Error ? error.message : 'Unable to dispatch worker job',
        errorCode: (error as { code?: string })?.code || 'WORKER_DISPATCH',
      }),
    );
  }
}

function pumpReadyWorkers(): void {
  if (!workerPoolStarted || workerPoolStopping) return;
  for (const slot of workerSlots.values()) {
    if (!slot.ready || slot.active || slot.intentionalStop) continue;
    const categories = categoriesWithCapacity();
    if (categories.length === 0) break;
    const job = claimNextQueuedJobRow(categories, slot.id);
    if (!job) break;
    dispatchToWorker(slot, job);
  }
}

function updateWorkerHeartbeat(slot: WorkerSlot, message: WorkerToApiMessage): void {
  slot.lastHeartbeatAt = Date.now();
  if (!slot.active || message.jobId !== slot.active.jobId || message.lease !== slot.active.lease) return;
  try {
    getDb()
      .prepare(
        `UPDATE jobs SET last_heartbeat_at = ?, updated_at = ?
         WHERE id = ? AND status = 'running' AND worker_lease = ?`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), slot.active.jobId, slot.active.lease);
  } catch {
    /* diagnostics heartbeat must never crash the API */
  }
}

function handleWorkerMessage(slot: WorkerSlot, raw: unknown): void {
  if (!isWorkerToApiMessage(raw) || raw.workerId !== slot.id) return;
  const message = raw as WorkerToApiMessage;
  slot.lastHeartbeatAt = Date.now();

  if (message.type === 'ready') {
    slot.ready = true;
    pumpQueue();
    return;
  }
  if (message.type === 'idle') {
    slot.ready = true;
    pumpQueue();
    return;
  }
  if (message.type === 'heartbeat') {
    updateWorkerHeartbeat(slot, message);
    return;
  }

  const active = slot.active;
  if (!active || message.jobId !== active.jobId || message.lease !== active.lease) return;
  if (message.type === 'child-started') {
    if (Number.isSafeInteger(message.pid) && message.pid > 0) slot.externalPids.add(message.pid);
    return;
  }
  if (message.type === 'child-exited') {
    slot.externalPids.delete(message.pid);
    return;
  }
  if (message.type === 'progress') {
    if (!active.settling) {
      active.progress.update(message.progress, boundedWorkerMessage(message.message));
    }
    return;
  }
  if (active.settling) return;
  active.settling = true;
  if (message.type === 'result') {
    trackSettlement(settleWorkerSuccess(slot, message.result));
    return;
  }
  if (message.type !== 'error' && message.type !== 'cancelled') return;
  trackSettlement(
    settleWorkerFailure(slot, {
      error: message.error || (message.type === 'cancelled' ? 'Cancelled' : 'Worker job failed'),
      errorCode: message.errorCode || (message.type === 'cancelled' ? 'CANCELLED' : 'WORKER_JOB_FAILED'),
    }),
  );
}

function trackSettlement(task: Promise<void>): void {
  settlementTasks.add(task);
  void task.finally(() => settlementTasks.delete(task));
}

function killReportedChildren(slot: WorkerSlot): void {
  for (const pid of slot.externalPids) killProcessTreeByPid(pid);
  slot.externalPids.clear();
}

function requestWorkerStop(
  active: ActiveLease,
  reason: 'cancel' | 'timeout' | 'shutdown',
): boolean {
  const slot = [...workerSlots.values()].find((candidate) => candidate.active === active);
  if (!slot || active.settling) return false;
  active.stopReason = reason;
  cancelFlags.set(active.jobId, true);
  killReportedChildren(slot);
  sendToWorker(slot, {
    protocol: WORKER_PROTOCOL_VERSION,
    type: 'cancel',
    workerId: slot.id,
    jobId: active.jobId,
    lease: active.lease,
    reason,
  });
  if (!active.forceKill) {
    active.forceKill = setTimeout(() => {
      if (slot.active !== active || active.settling) return;
      if (slot.child.pid) killProcessTreeByPid(slot.child.pid);
    }, config.workerCancelGraceMs);
    active.forceKill.unref?.();
  }
  return true;
}

function cancelWorkerLease(jobId: string, reason: 'cancel' | 'timeout' | 'shutdown'): boolean {
  for (const slot of workerSlots.values()) {
    if (slot.active?.jobId === jobId) return requestWorkerStop(slot.active, reason);
  }
  return false;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function settleWorkerSuccess(slot: WorkerSlot, result: ProcessResult): Promise<void> {
  const active = slot.active;
  if (!active) return;
  if (active.stopReason || cancelFlags.get(active.jobId)) {
    await settleWorkerFailure(slot, {
      error: active.stopReason === 'timeout' ? 'Job timed out' : 'Cancelled',
      errorCode: active.stopReason === 'timeout' ? 'JOB_TIMEOUT' : 'CANCELLED',
    });
    return;
  }

  try {
    const outputDir = path.join(config.outputsDir, active.jobId);
    if (!result || typeof result.outputPath !== 'string' || !isPathInside(outputDir, result.outputPath)) {
      throw Object.assign(new Error('Worker returned an unsafe output path'), {
        code: 'OUTPUT_VALIDATION_FAILED',
      });
    }
    active.progress.flush();
    const options = safeParse(active.job.options) as Record<string, unknown>;
    await completeJobSuccess(
      active.jobId,
      active.lease,
      active.job,
      result,
      path.resolve(result.outputPath),
      options,
      active.cacheKey,
    );
    releaseWorker(slot, active);
  } catch (error) {
    await settleWorkerFailure(slot, {
      error: error instanceof Error ? error.message : 'Output validation failed',
      errorCode: (error as { code?: string })?.code || 'OUTPUT_VALIDATION_FAILED',
    });
  }
}

function retryAllowed(active: ActiveLease, errorCode: string): boolean {
  const attempts = Number(active.job.attempt_count || 1);
  const maxAttempts = Number(active.job.max_attempts || config.maxJobAttempts);
  const permanent = new Set([
    'BAD_REQUEST',
    'CANCELLED',
    'OUTPUT_VALIDATION_FAILED',
    'STALE_WORKER_LEASE',
    'UNAVAILABLE',
  ]);
  return attempts < maxAttempts && !permanent.has(errorCode);
}

async function settleWorkerFailure(
  slot: WorkerSlot,
  failure: { error: string; errorCode: string },
): Promise<void> {
  const active = slot.active;
  if (!active) return;
  active.settling = true;
  killReportedChildren(slot);

  const reason = active.stopReason;
  const shuttingDown = reason === 'shutdown';
  const cancelled = reason === 'cancel' || (!reason && failure.errorCode === 'CANCELLED');
  const timeout = reason === 'timeout' || failure.errorCode === 'JOB_TIMEOUT';
  const errorCode = cancelled
    ? 'CANCELLED'
    : timeout
      ? 'JOB_TIMEOUT'
      : shuttingDown
        ? 'SERVER_SHUTDOWN'
        : failure.errorCode;
  const rawMessage = cancelled
    ? 'Cancelled'
    : timeout
      ? `Job exceeded timeout of ${config.jobTimeoutMs} ms`
      : shuttingDown
        ? 'Worker stopped during server shutdown'
        : failure.error || 'Worker job failed';
  const message = sanitizeUserError(rawMessage);
  const retryable = !cancelled && retryAllowed(active, errorCode);

  removePartialOutputs(active.jobId);
  finish(active.jobId, {
    status: cancelled ? 'cancelled' : 'failed',
    message,
    error: cancelled ? null : message,
    errorCode,
    retryable,
    lease: active.lease,
  });
  logActivity({
    jobId: active.jobId,
    tool: active.job.type,
    action: cancelled ? 'cancel' : `${active.job.type}:error`,
    status: cancelled ? 'cancelled' : 'failed',
    detail: `${errorCode}: ${message}`,
  });
  try {
    await fs.promises.rm(path.join(config.tempDir, active.jobId), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  releaseWorker(slot, active);
}

function releaseWorker(slot: WorkerSlot, active: ActiveLease): void {
  if (active.timeout) clearTimeout(active.timeout);
  if (active.forceKill) clearTimeout(active.forceKill);
  cancelFlags.delete(active.jobId);
  slot.externalPids.clear();
  if (slot.active === active) slot.active = null;
  if (!workerPoolStopping) pumpQueue();
}

function handleWorkerExit(
  slot: WorkerSlot,
  code: number | null,
  signal: NodeJS.Signals | null,
): void {
  if (workerSlots.get(slot.id) !== slot) return;
  workerSlots.delete(slot.id);
  slot.ready = false;
  killReportedChildren(slot);
  const active = slot.active;
  if (active && !active.settling) {
    active.settling = true;
    const reason = active.stopReason;
    trackSettlement(
      settleWorkerFailure(slot, {
        error:
          reason === 'timeout'
            ? 'Job timed out and worker was terminated'
            : reason === 'cancel'
              ? 'Cancelled'
              : reason === 'shutdown'
                ? 'Worker stopped during server shutdown'
                : `Worker exited unexpectedly (code=${code}, signal=${signal || 'none'})`,
        errorCode:
          reason === 'timeout'
            ? 'JOB_TIMEOUT'
            : reason === 'cancel'
              ? 'CANCELLED'
              : reason === 'shutdown'
                ? 'SERVER_SHUTDOWN'
                : 'WORKER_CRASH',
      }),
    );
  }
  if (!slot.intentionalStop && !workerPoolStopping) workerCrashCount += 1;
  if (!workerPoolStopping) {
    const restartDelay = Math.min(1_000, workerCrashCount * 100);
    const restart = setTimeout(() => {
      ensureWorkerPool();
      pumpQueue();
    }, restartDelay);
    restart.unref?.();
  }
}

export function startWorkerPool(): void {
  if (workerPoolStarted && !workerPoolStopping) {
    ensureWorkerPool();
    return;
  }
  workerPoolStarted = true;
  workerPoolStopping = false;
  ensureWorkerPool();
  workerWatchdog = setInterval(() => {
    const now = Date.now();
    for (const slot of workerSlots.values()) {
      // Active workers may legitimately block their JS loop in a PDF operation;
      // the per-job timeout owns those. Restart only stale idle workers.
      if (!slot.active && now - slot.lastHeartbeatAt > config.workerStaleMs) {
        slot.intentionalStop = false;
        if (slot.child.pid) killProcessTreeByPid(slot.child.pid);
      }
    }
    ensureWorkerPool();
    pumpQueue();
  }, Math.max(500, config.workerHeartbeatMs));
  workerWatchdog.unref?.();
}

export async function stopWorkerPool(): Promise<void> {
  if (!workerPoolStarted) return;
  workerPoolStopping = true;
  if (workerWatchdog) clearInterval(workerWatchdog);
  workerWatchdog = null;

  for (const slot of workerSlots.values()) {
    slot.intentionalStop = true;
    if (slot.active) requestWorkerStop(slot.active, 'shutdown');
    sendToWorker(slot, {
      protocol: WORKER_PROTOCOL_VERSION,
      type: 'shutdown',
      workerId: slot.id,
    });
  }

  const deadline = Date.now() + Math.max(1_000, config.workerCancelGraceMs + 500);
  while (workerSlots.size > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  for (const slot of workerSlots.values()) {
    killReportedChildren(slot);
    if (slot.child.pid) killProcessTreeByPid(slot.child.pid);
  }
  if (settlementTasks.size > 0) await Promise.allSettled([...settlementTasks]);
  workerSlots.clear();
  workerPoolStarted = false;
  workerPoolStopping = false;
}

export function getWorkerDiagnostics() {
  const now = Date.now();
  const active = activeByCategory();
  const queued: Record<JobCategory, number> = {
    image: 0,
    pdf: 0,
    media: 0,
    office: 0,
    general: 0,
  };
  try {
    const rows = getDb()
      .prepare(
        `SELECT job_category AS category, COUNT(*) AS count
         FROM jobs WHERE status = 'queued' GROUP BY job_category`,
      )
      .all() as Array<{ category: string; count: number }>;
    for (const row of rows) {
      const category = JOB_CATEGORIES.includes(row.category as JobCategory)
        ? (row.category as JobCategory)
        : 'general';
      queued[category] += Number(row.count || 0);
    }
  } catch {
    /* DB may not be initialized during early diagnostics tests */
  }
  const desired = effectiveWorkerPoolSize();
  const workers = [...workerSlots.values()].map((slot) => ({
    id: slot.id,
    pid: slot.child.pid || null,
    ready: slot.ready,
    activeJobId: slot.active?.jobId || null,
    category: slot.active?.category || null,
    heartbeatAgeMs: Math.max(0, now - slot.lastHeartbeatAt),
    stale: now - slot.lastHeartbeatAt > config.workerStaleMs,
    uptimeMs: Math.max(0, now - slot.startedAt),
  }));
  const staleWorkers = workers.filter((worker) => worker.stale).length;
  const readyWorkers = workers.filter((worker) => worker.ready).length;
  return {
    status: !workerPoolStarted
      ? 'stopped'
      : staleWorkers > 0 ||
          workerSlots.size < desired ||
          readyWorkers + activeWorkerCount() < desired
        ? 'degraded'
        : 'healthy',
    configuredPoolSize: config.maxConcurrentJobs,
    adaptivePoolSize: desired,
    processCount: workerSlots.size,
    readyWorkers,
    activeJobs: activeWorkerCount(),
    queueDepth: Object.values(queued).reduce((sum, count) => sum + count, 0),
    activeByCategory: active,
    queuedByCategory: queued,
    categoryLimits: Object.fromEntries(
      JOB_CATEGORIES.map((category) => [category, categoryLimit(category)]),
    ),
    crashCount: workerCrashCount,
    cpuCount: os.cpus().length,
    freeMemoryBytes: os.freemem(),
    workers,
  };
}

/** Regression-test hook: terminate a real worker process, never fake a result. */
export function terminateWorkerForTest(jobId?: string): boolean {
  const slot = [...workerSlots.values()].find((worker) =>
    jobId ? worker.active?.jobId === jobId : true,
  );
  if (!slot?.child.pid) return false;
  return killProcessTreeByPid(slot.child.pid);
}

/** Remove partial job output directory when cancelled/failed mid-run */
export function removePartialOutputs(jobId: string): void {
  const current = getJob(jobId);
  if (current?.status === 'completed') return;
  const outDir = path.join(config.outputsDir, jobId);
  try {
    if (fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
  try {
    getDb()
      .prepare(`UPDATE jobs SET output_path = NULL, output_name = NULL, output_mime = NULL WHERE id = ? AND status != 'completed'`)
      .run(jobId);
  } catch {
    /* ignore */
  }
}

function finish(
  id: string,
  fields: {
    status: string;
    message?: string | null;
    error?: string | null;
    errorCode?: string | null;
    retryable?: boolean;
    lease?: string | null;
  },
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE jobs SET status = ?, message = COALESCE(?, message), error = ?, error_code = ?,
       retryable = ?, finished_at = ?, updated_at = ?,
       cancel_requested = CASE WHEN ? IN ('completed','failed','cancelled') THEN 0 ELSE cancel_requested END,
       worker_id = NULL, worker_lease = NULL, last_heartbeat_at = NULL, timeout_at = NULL
       WHERE id = ? AND status != 'completed' AND (? IS NULL OR worker_lease = ?)`,
    )
    .run(
      fields.status,
      fields.message ?? null,
      fields.error ?? null,
      fields.errorCode ?? null,
      fields.retryable ? 1 : 0,
      now,
      now,
      fields.status,
      id,
      fields.lease ?? null,
      fields.lease ?? null,
    );
  if (fields.status === 'failed' || fields.status === 'cancelled' || fields.status === 'completed') {
    clearJobPassword(id);
  }
  const j = getJob(id);
  if (j) emitJob(j, 'updated');
}

/**
 * Broadcast job state on the legacy jobEvents bus and workspace-scoped bus.
 * Progress batching still funnels through here (createProgressBatcher → emitJob).
 * @param kind - 'created' after insert; 'progress' for ticks; 'updated' for status transitions.
 *               When omitted: running → job.progress, else job.updated.
 */
function emitJob(job: JobRow, kind?: 'created' | 'progress' | 'updated'): void {
  const version = nextEventVersion();
  const pub = { ...jobPublic(job), version };
  jobEvents.emit('job', pub);
  jobEvents.emit(`job:${job.id}`, pub);

  const type =
    kind === 'created'
      ? 'job.created'
      : kind === 'progress' || (!kind && job.status === 'running')
        ? 'job.progress'
        : 'job.updated';

  // Workspace stream so converter UI sees progress without per-job subscription only
  try {
    emitWorkspaceEvent({
      type,
      workspaceId: job.workspace_id ?? null,
      jobId: job.id,
      status: job.status,
      stage: job.message,
      progress: job.progress,
      message: job.message,
      updatedAt: job.updated_at || undefined,
      version,
      job: pub,
    });
  } catch {
    /* non-fatal */
  }
}

export function logActivity(input: {
  jobId?: string | null;
  tool: string;
  action: string;
  status: string;
  detail?: string | null;
}): void {
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO activity (id, job_id, tool, action, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.jobId ?? null,
      input.tool,
      input.action,
      input.status,
      input.detail ?? null,
      new Date().toISOString(),
    );
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Persist only bounded, browser-safe result metadata (never paths/commands). */
export function sanitizeResultMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!meta) return null;
  const sanitize = (value: unknown, depth: number): unknown => {
    if (depth > 5 || value == null || typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      if (/^[a-zA-Z]:[\\/]|^\\\\|^\//.test(value)) return undefined;
      return value.slice(0, 2_000);
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, 100)
        .map((item) => sanitize(item, depth + 1))
        .filter((item) => item !== undefined);
    }
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(
            ([key]) =>
              !/path|command|args|executable|environment|password|userPassword|ownerPassword|pdfPassword/i.test(
                key,
              ),
          )
          .slice(0, 100)
          .map(([key, item]) => [key, sanitize(item, depth + 1)])
          .filter(([, item]) => item !== undefined),
      );
    }
    return undefined;
  };
  return sanitize(meta, 0) as Record<string, unknown>;
}

/**
 * Temp/orphan cleanup. Must NOT delete workspace-linked binaries while
 * WORKSPACE_RETENTION_MS still protects them — only tempDir is age-purged
 * unconditionally; uploads/outputs keep any path still referenced by
 * files, uploads(workspace_id), outputs, or jobs.output_path.
 */
export function cleanupExpiredFiles(): void {
  const cutoff = Date.now() - config.tempTtlMs;
  const db = getDb();

  // 1) Temp dir only — scratch files, never workspace source of truth
  cleanDirByAge(config.tempDir, cutoff, null);

  // 2) Paths still owned by SQLite metadata (workspace retention owns lifecycle)
  const protectedPaths = collectProtectedPaths(db);

  // 3) uploads/outputs: only remove aged files that are not DB-referenced
  cleanDirByAge(config.uploadsDir, cutoff, protectedPaths);
  cleanDirByAge(config.outputsDir, cutoff, protectedPaths);

  // 4) Purge upload rows: workspace-linked only if disk gone AND no files row;
  //    legacy (no workspace) still use TEMP_TTL
  const hasWsCol = (
    db.prepare(`PRAGMA table_info(uploads)`).all() as { name: string }[]
  ).some((c) => c.name === 'workspace_id');

  const uploads = hasWsCol
    ? (db
        .prepare('SELECT id, path, created_at, workspace_id FROM uploads')
        .all() as { id: string; path: string; created_at: string; workspace_id: string | null }[])
    : (
        db.prepare('SELECT id, path, created_at FROM uploads').all() as {
          id: string;
          path: string;
          created_at: string;
        }[]
      ).map((u) => ({ ...u, workspace_id: null as string | null }));

  for (const u of uploads) {
    const resolved = path.resolve(u.path);
    const onDisk = fs.existsSync(u.path);
    const fileRow = db.prepare('SELECT id FROM files WHERE id = ?').get(u.id) as
      | { id: string }
      | undefined;

    if (u.workspace_id || fileRow) {
      // Workspace retention (cleanupExpiredWorkspaces) owns these.
      // Only drop the legacy uploads bridge row if the files row is gone and disk is gone.
      if (!fileRow && !onDisk) {
        db.prepare('DELETE FROM uploads WHERE id = ?').run(u.id);
      }
      continue;
    }

    // Legacy non-workspace uploads: TEMP_TTL age or missing disk
    if (!onDisk || new Date(u.created_at).getTime() < cutoff) {
      db.prepare('DELETE FROM uploads WHERE id = ?').run(u.id);
      try {
        if (onDisk && !protectedPaths.has(resolved)) fs.rmSync(u.path, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  logger.info('Temp cleanup pass complete');
}

/**
 * Paths protected from TEMP_TTL cleanup.
 * Only active workspaces (and their jobs/outputs/files) are protected —
 * expired soft-deleted workspaces must not pin disk forever.
 */
function collectProtectedPaths(db: ReturnType<typeof getDb>): Set<string> {
  const set = new Set<string>();
  const add = (p: string | null | undefined) => {
    if (p) set.add(path.resolve(p));
  };

  // Active workspace IDs
  let activeWs = new Set<string>();
  try {
    activeWs = new Set(
      (db.prepare(`SELECT id FROM workspaces WHERE status = 'active'`).all() as { id: string }[]).map(
        (r) => r.id,
      ),
    );
  } catch {
    /* ignore */
  }

  try {
    for (const r of db.prepare(`SELECT path, workspace_id, status FROM files`).all() as {
      path: string;
      workspace_id: string;
      status: string;
    }[]) {
      if (r.status === 'deleted') continue;
      if (activeWs.has(r.workspace_id)) add(r.path);
    }
  } catch {
    try {
      for (const r of db.prepare(`SELECT path FROM files`).all() as { path: string }[]) add(r.path);
    } catch {
      /* ignore */
    }
  }

  try {
    for (const r of db.prepare(`SELECT path, workspace_id FROM outputs`).all() as {
      path: string;
      workspace_id: string | null;
    }[]) {
      if (!r.workspace_id || activeWs.has(r.workspace_id)) add(r.path);
    }
  } catch {
    /* ignore */
  }

  try {
    for (const r of db
      .prepare(
        `SELECT output_path as path, workspace_id, status FROM jobs WHERE output_path IS NOT NULL`,
      )
      .all() as { path: string; workspace_id: string | null; status: string }[]) {
      // Protect outputs for active jobs or active workspaces
      if (['queued', 'running'].includes(r.status)) {
        add(r.path);
        continue;
      }
      if (!r.workspace_id || activeWs.has(r.workspace_id)) add(r.path);
    }
  } catch {
    /* ignore */
  }

  try {
    const hasWs = (db.prepare(`PRAGMA table_info(uploads)`).all() as { name: string }[]).some(
      (c) => c.name === 'workspace_id',
    );
    if (hasWs) {
      for (const r of db
        .prepare(`SELECT path, workspace_id FROM uploads WHERE workspace_id IS NOT NULL AND workspace_id != ''`)
        .all() as { path: string; workspace_id: string }[]) {
        if (activeWs.has(r.workspace_id)) add(r.path);
      }
    }
  } catch {
    /* ignore */
  }
  return set;
}

/**
 * Orphan-file GC: remove aged outputs/jobs for non-active workspaces.
 * @param dryRun when true, only report what would be deleted
 */
export function orphanFileGc(opts: {
  dryRun?: boolean;
  retentionMs?: number;
}): { wouldDelete: string[]; deleted: string[]; protectedActiveJobs: number } {
  const dryRun = opts.dryRun !== false; // default dry-run safe
  const retentionMs = opts.retentionMs ?? config.workspaceRetentionMs;
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  const db = getDb();
  const wouldDelete: string[] = [];
  const deleted: string[] = [];
  let protectedActiveJobs = 0;

  try {
    const activeJobs = db
      .prepare(`SELECT COUNT(*) as c FROM jobs WHERE status IN ('queued','running')`)
      .get() as { c: number };
    protectedActiveJobs = activeJobs.c;
  } catch {
    /* ignore */
  }

  // Soft-deleted workspaces past retention: purge jobs/outputs/files disk
  const expiredWs = db
    .prepare(
      `SELECT id FROM workspaces WHERE status = 'deleted' AND (last_seen_at < ? OR updated_at < ?)`,
    )
    .all(cutoff, cutoff) as { id: string }[];

  for (const ws of expiredWs) {
    // Skip if any active job still references this workspace
    const active = db
      .prepare(
        `SELECT COUNT(*) as c FROM jobs WHERE workspace_id = ? AND status IN ('queued','running')`,
      )
      .get(ws.id) as { c: number };
    if (active.c > 0) {
      protectedActiveJobs += active.c;
      continue;
    }

    const outs = db
      .prepare(`SELECT id, path FROM outputs WHERE workspace_id = ?`)
      .all(ws.id) as { id: string; path: string }[];
    for (const o of outs) {
      wouldDelete.push(o.path);
      if (!dryRun) {
        try {
          if (fs.existsSync(o.path)) fs.rmSync(o.path, { force: true });
          // also remove parent job dir if empty
          const parent = path.dirname(o.path);
          try {
            if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
              fs.rmdirSync(parent);
            }
          } catch {
            /* ignore */
          }
        } catch {
          /* ignore */
        }
        db.prepare(`DELETE FROM outputs WHERE id = ?`).run(o.id);
        deleted.push(o.path);
      }
    }

    const jobs = db
      .prepare(`SELECT id, output_path FROM jobs WHERE workspace_id = ?`)
      .all(ws.id) as { id: string; output_path: string | null }[];
    for (const j of jobs) {
      if (j.output_path) {
        wouldDelete.push(j.output_path);
        if (!dryRun) {
          try {
            if (fs.existsSync(j.output_path)) fs.rmSync(j.output_path, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
      if (!dryRun) {
        db.prepare(`DELETE FROM job_files WHERE job_id = ?`).run(j.id);
        db.prepare(`DELETE FROM jobs WHERE id = ?`).run(j.id);
      }
    }

    if (!dryRun) {
      // hard-delete soft-deleted files for this workspace
      const files = db
        .prepare(`SELECT id, path FROM files WHERE workspace_id = ?`)
        .all(ws.id) as { id: string; path: string }[];
      for (const f of files) {
        try {
          if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
        } catch {
          /* ignore */
        }
        db.prepare(`DELETE FROM files WHERE id = ?`).run(f.id);
      }
      db.prepare(`DELETE FROM tool_settings WHERE workspace_id = ?`).run(ws.id);
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(ws.id);
    }
  }

  return { wouldDelete, deleted: dryRun ? [] : deleted, protectedActiveJobs };
}

/**
 * True if `resolved` is a protected leaf OR is an ancestor directory of any
 * protected path (e.g. outputs/<jobId> when jobs.output_path is outputs/<jobId>/file.pdf).
 * Without this, top-level job dirs would be recursive-rm'd after TEMP_TTL.
 */
function isProtectedOrAncestor(
  resolved: string,
  protectedPaths: Set<string>,
): boolean {
  if (protectedPaths.has(resolved)) return true;
  const prefix = resolved.endsWith(path.sep) ? resolved : resolved + path.sep;
  for (const p of protectedPaths) {
    if (p.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Age-based cleanup.
 * - protectedPaths === null: remove all aged files/dirs (used for tempDir).
 * - otherwise: never delete a protected leaf; for directories that contain
 *   protected descendants, recurse instead of rmSync(recursive) so nested
 *   job outputs (outputs/<jobId>/<file>) survive TEMP_TTL.
 */
function cleanDirByAge(dir: string, cutoffMs: number, protectedPaths: Set<string> | null): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      const resolved = path.resolve(full);
      const st = fs.statSync(full);

      if (st.isDirectory()) {
        if (protectedPaths && isProtectedOrAncestor(resolved, protectedPaths)) {
          // Keep the tree root; clean unprotected siblings/leaves inside.
          cleanDirByAge(full, cutoffMs, protectedPaths);
          // Drop empty aged dirs that no longer hold anything protected.
          try {
            if (fs.readdirSync(full).length === 0 && st.mtimeMs < cutoffMs) {
              fs.rmdirSync(full);
            }
          } catch {
            /* ignore */
          }
          continue;
        }
        if (st.mtimeMs < cutoffMs) {
          fs.rmSync(full, { recursive: true, force: true });
        }
        continue;
      }

      // File
      if (protectedPaths?.has(resolved)) continue;
      if (st.mtimeMs < cutoffMs) {
        fs.rmSync(full, { force: true });
      }
    } catch {
      /* ignore */
    }
  }
}
