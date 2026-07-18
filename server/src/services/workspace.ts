import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import {
  getDb,
  dbGetFile,
  getDetectCacheByChecksum,
  setDetectCache,
  type FileRow,
  type JobRow,
  type WorkspaceRow,
} from '../db/index.js';
import { config } from '../config.js';
import { notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  checksumFileChunked,
  quickFingerprint,
  streamChecksum,
} from '../lib/fingerprint.js';
import { detectFile, detectFileQuick } from '../convert/detect.js';
import { validateStoredFileQuick } from '../security/validation.js';
import { emitWorkspaceEvent } from '../lib/workspace-events.js';

let fileFinalizersShuttingDown = false;

export function enableFileFinalizers(): void {
  fileFinalizersShuttingDown = false;
}

export function beginFileFinalizerShutdown(): void {
  fileFinalizersShuttingDown = true;
}

export function scheduleFileFinalize(fileId: string): void {
  if (fileFinalizersShuttingDown) return;
  setImmediate(() => {
    if (!fileFinalizersShuttingDown) void finalizeFileAsync(fileId);
  });
}

/** Re-run durable processing rows after restart so Inspecting is never orphaned. */
export function resumeProcessingFiles(): number {
  const rows = getDb()
    .prepare(`SELECT id FROM files WHERE status = 'processing' ORDER BY created_at ASC`)
    .all() as { id: string }[];
  for (const row of rows) scheduleFileFinalize(row.id);
  return rows.length;
}

/**
 * Public job DTO — no filesystem paths.
 * When extras are provided (hydrate), fills options._uploadIds / inputFileNames
 * from job_files + files.original_name so Converted Files can show source names.
 */
function jobPublicDto(
  job: JobRow,
  extras?: { uploadIds?: string[]; inputFileNames?: string[] },
) {
  const options: Record<string, unknown> = { ...safeParseOptions(job.options) };

  // Prefer persisted options._uploadIds; fall back to job_files input ids
  const existingIds = Array.isArray(options._uploadIds)
    ? (options._uploadIds as unknown[]).map(String).filter(Boolean)
    : [];
  if (existingIds.length > 0) {
    options._uploadIds = existingIds;
  } else if (extras?.uploadIds?.length) {
    options._uploadIds = extras.uploadIds.map(String);
  }

  // Attach display names from files.original_name (never paths)
  if (extras?.inputFileNames?.length) {
    options.inputFileNames = extras.inputFileNames.map(String).filter(Boolean);
  }

  return {
    id: job.id,
    type: job.type,
    tool: job.tool || job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    options,
    meta: job.result_json ? safeParseOptions(job.result_json) : null,
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

/** Batch-load input file ids + original names for jobs (job_files role=input). */
function loadJobInputMeta(
  jobIds: string[],
): Map<string, { uploadIds: string[]; inputFileNames: string[] }> {
  const map = new Map<string, { uploadIds: string[]; inputFileNames: string[] }>();
  if (!jobIds.length) return map;

  const placeholders = jobIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT jf.job_id AS job_id, jf.file_id AS file_id, f.original_name AS original_name
       FROM job_files jf
       LEFT JOIN files f ON f.id = jf.file_id
       WHERE jf.role = 'input' AND jf.job_id IN (${placeholders})
       ORDER BY jf.job_id, jf.file_id`,
    )
    .all(...jobIds) as { job_id: string; file_id: string; original_name: string | null }[];

  for (const r of rows) {
    let entry = map.get(r.job_id);
    if (!entry) {
      entry = { uploadIds: [], inputFileNames: [] };
      map.set(r.job_id, entry);
    }
    entry.uploadIds.push(String(r.file_id));
    if (r.original_name) entry.inputFileNames.push(r.original_name);
  }
  return map;
}

function safeParseOptions(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function now() {
  return new Date().toISOString();
}

export function createWorkspace(route = 'dashboard'): WorkspaceRow {
  const id = uuid();
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO workspaces (id, route, selected_file_ids, status, ui_json, created_at, updated_at, last_seen_at)
       VALUES (?, ?, '[]', 'active', '{}', ?, ?, ?)`,
    )
    .run(id, route, t, t, t);
  return getWorkspace(id)!;
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
  return getDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
}

export function touchWorkspace(id: string): void {
  getDb()
    .prepare(`UPDATE workspaces SET last_seen_at = ?, updated_at = ? WHERE id = ?`)
    .run(now(), now(), id);
}

export function ensureWorkspace(id?: string | null, route = 'dashboard'): WorkspaceRow {
  if (id) {
    const existing = getWorkspace(id);
    if (existing && existing.status === 'active') {
      touchWorkspace(id);
      return getWorkspace(id)!;
    }
  }
  return createWorkspace(route);
}

export type PublicFile = {
  id: string;
  originalName: string;
  mime: string | null;
  size: number;
  ext: string | null;
  /** Full SHA-256 when ready; null while status is processing */
  checksum: string | null;
  /** Quick size+head/tail fingerprint available immediately */
  fingerprint: string | null;
  duplicateOf: string | null;
  status: string;
  detect: unknown | null;
  downloadUrl: string;
  previewUrl: string;
  createdAt: string;
  updatedAt: string;
};

export function filePublic(row: FileRow): PublicFile {
  let detect: unknown = null;
  if (row.detect_json) {
    try {
      detect = JSON.parse(row.detect_json);
    } catch {
      detect = null;
    }
  }
  return {
    id: row.id,
    originalName: row.original_name,
    mime: row.mime,
    size: row.size,
    ext: row.ext,
    checksum: row.checksum,
    fingerprint: row.fingerprint ?? null,
    duplicateOf: row.duplicate_of ?? null,
    status: row.status,
    detect,
    downloadUrl: `/api/files/${row.id}/download`,
    previewUrl: `/api/files/${row.id}/preview`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorkspaceFiles(workspaceId: string): FileRow[] {
  return getDb()
    .prepare(`SELECT * FROM files WHERE workspace_id = ? AND status != 'deleted' ORDER BY created_at ASC`)
    .all(workspaceId) as FileRow[];
}

export function getFile(id: string): FileRow | undefined {
  return dbGetFile(id);
}

export function verifyFileOnDisk(row: FileRow): FileRow {
  if (!fs.existsSync(row.path)) {
    getDb()
      .prepare(`UPDATE files SET status = 'missing', updated_at = ? WHERE id = ?`)
      .run(now(), row.id);
    return getFile(row.id)!;
  }
  if (row.status === 'missing') {
    getDb()
      .prepare(`UPDATE files SET status = 'ready', updated_at = ? WHERE id = ?`)
      .run(now(), row.id);
    return getFile(row.id)!;
  }
  return row;
}

export function insertFile(opts: {
  workspaceId: string;
  originalName: string;
  storedName: string;
  path: string;
  mime: string;
  size: number;
  ext: string;
  /** Full checksum; null while processing */
  checksum?: string | null;
  /** Quick fingerprint for early dedupe */
  fingerprint?: string | null;
  uploadSessionId?: string | null;
  detectJson?: string | null;
  /** Default 'processing' for fast upload; 'ready' when fully finalized */
  status?: 'processing' | 'ready';
}): FileRow {
  const id = uuid();
  const t = now();
  const status = opts.status ?? (opts.checksum ? 'ready' : 'processing');
  const checksum = opts.checksum ?? null;
  const fingerprint = opts.fingerprint ?? null;
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO files (id, workspace_id, original_name, stored_name, path, mime, size, checksum, fingerprint, upload_session_id, ext, status, detect_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      opts.workspaceId,
      opts.originalName,
      opts.storedName,
      opts.path,
      opts.mime,
      opts.size,
      checksum,
      fingerprint,
      opts.uploadSessionId ?? null,
      opts.ext,
      status,
      opts.detectJson ?? null,
      t,
      t,
    );
    // Bridge legacy uploads table for existing job pipeline (file id usable immediately)
    db.prepare(
      `INSERT OR REPLACE INTO uploads (id, original_name, stored_name, path, mime, size, ext, created_at, checksum, workspace_id, status, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      opts.originalName,
      opts.storedName,
      opts.path,
      opts.mime,
      opts.size,
      opts.ext,
      t,
      checksum,
      opts.workspaceId,
      status,
      fingerprint,
    );
    db.prepare(`UPDATE workspaces SET updated_at = ?, last_seen_at = ? WHERE id = ?`).run(
      t,
      t,
      opts.workspaceId,
    );
  });
  tx();
  const row = getFile(id)!;
  emitWorkspaceEvent({
    type: 'file.created',
    workspaceId: row.workspace_id,
    fileId: row.id,
    status: row.status,
    file: filePublic(row),
  });
  return row;
}

/**
 * Mark file terminal (failed/missing) from processing and broadcast.
 * Never throws into callers — best-effort DB + SSE.
 */
function markFileTerminal(
  fileId: string,
  status: 'failed' | 'missing',
  message?: string,
): void {
  try {
    const t = now();
    const db = getDb();
    let changed = false;
    db.transaction(() => {
      const r = db
        .prepare(
          `UPDATE files SET status = ?, updated_at = ? WHERE id = ? AND status = 'processing'`,
        )
        .run(status, t, fileId);
      if (r.changes > 0) {
        changed = true;
        db.prepare(
          `UPDATE uploads SET status = ? WHERE id = ? AND status = 'processing'`,
        ).run(status, fileId);
      }
    })();
    const row = getFile(fileId);
    if (changed && row) {
      emitWorkspaceEvent({
        type: 'file.updated',
        workspaceId: row.workspace_id,
        fileId: row.id,
        status,
        message: message || status,
        file: filePublic(row),
      });
    }
  } catch (err) {
    logger.warn({ err, fileId, status }, 'markFileTerminal failed');
  }
}

/**
 * Finalize a fast-uploaded file: stream full checksum, deep detect (or cache hit),
 * mark ready. Safe to call fire-and-forget after HTTP response.
 *
 * Ordering (required):
 *   1. Commit metadata/status to SQLite
 *   2. Broadcast ready (SSE) with version/updatedAt
 *   3. Optional best-effort detect_cache write (never blocks ready)
 *
 * Detect/cache failures do not block ready. Hard failures emit failed.
 */
export async function finalizeFileAsync(fileId: string): Promise<void> {
  if (fileFinalizersShuttingDown) return;
  const row = getFile(fileId);
  // Do not revive deleted/missing/failed rows; only advance processing → ready
  if (!row || row.status === 'deleted' || row.status === 'missing' || row.status === 'failed') return;
  if (row.status === 'ready' && row.checksum && row.detect_json) {
    // Already ready — optional cache write only; no rebroadcast
    try {
      const det = JSON.parse(row.detect_json);
      if (row.checksum) setDetectCache(row.checksum, det);
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    if (!fs.existsSync(row.path)) {
      markFileTerminal(fileId, 'missing', 'File missing on disk during finalize');
      return;
    }

    const checksum = await streamChecksum(row.path);
    if (fileFinalizersShuttingDown) return;

    // Re-check after async I/O — soft-delete must win the race
    const latest = getFile(fileId);
    if (!latest || latest.status === 'deleted' || latest.status === 'missing' || latest.status === 'failed') {
      return;
    }

    // Prefer checksum-keyed detect cache (skip deep probe when known)
    let detect: unknown = getDetectCacheByChecksum(checksum);
    if (!detect) {
      try {
        detect = await detectFile(row.path, row.original_name, { checksum });
      } catch (e) {
        logger.warn({ err: e, fileId }, 'Deep detect failed during finalize; keeping quick detect');
        detect = null;
      }
    }
    if (fileFinalizersShuttingDown) return;

    // Re-check again after deep detect
    const afterDetect = getFile(fileId);
    if (
      !afterDetect ||
      afterDetect.status === 'deleted' ||
      afterDetect.status === 'missing' ||
      afterDetect.status === 'failed'
    ) {
      return;
    }

    const duplicate = getDb()
      .prepare(
        `SELECT id FROM files
         WHERE id != ? AND size = ? AND checksum = ? AND status = 'ready'
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(fileId, row.size, checksum) as { id: string } | undefined;
    const t = now();
    const db = getDb();
    const detectJson = detect != null ? JSON.stringify(detect) : afterDetect.detect_json;

    // Only promote processing → ready; never overwrite deleted/missing/failed
    let promoted = false;
    db.transaction(() => {
      const r = db
        .prepare(
          `UPDATE files SET checksum = ?, detect_json = COALESCE(?, detect_json), duplicate_of = ?, status = 'ready', updated_at = ?
           WHERE id = ? AND status = 'processing'`,
        )
        .run(checksum, detectJson, duplicate?.id ?? null, t, fileId);
      if (r.changes > 0) {
        promoted = true;
        db.prepare(
          `UPDATE uploads SET checksum = ?, status = 'ready' WHERE id = ? AND status = 'processing'`,
        ).run(checksum, fileId);
      }
    })();

    const readyRow = getFile(fileId);

    // Broadcast ready BEFORE optional cache write so clients never stick on inspecting
    if (promoted && readyRow?.status === 'ready') {
      emitWorkspaceEvent({
        type: 'file.updated',
        workspaceId: readyRow.workspace_id,
        fileId: readyRow.id,
        status: 'ready',
        file: filePublic(readyRow),
      });
    }

    // Best-effort cache — setDetectCache never throws; still isolated from ready path
    if (detect != null && readyRow?.status === 'ready' && checksum) {
      setDetectCache(checksum, detect);
    }

    logger.debug({ fileId, checksum, promoted }, 'File finalize complete');
  } catch (e) {
    if (fileFinalizersShuttingDown) return;
    logger.warn({ err: e, fileId }, 'finalizeFileAsync failed');
    markFileTerminal(
      fileId,
      'failed',
      e instanceof Error ? e.message : 'File finalization failed',
    );
  }
}

/**
 * Fast upload accept: quick validate + fingerprint + quick detect → insert as processing,
 * schedule async full checksum/deep detect. Returns public DTO immediately.
 * Disk file must already be fully streamed to opts.path.
 */
export async function acceptUploadedFile(opts: {
  workspaceId: string;
  originalName: string;
  storedName: string;
  path: string;
  size: number;
  declaredMime?: string;
  uploadSessionId?: string | null;
}): Promise<PublicFile> {
  const validated = await validateStoredFileQuick(
    opts.path,
    opts.originalName,
    opts.declaredMime,
    { size: opts.size },
  );

  const fingerprint = quickFingerprint(opts.path, validated.size);

  // Early fingerprint dedupe is ONLY a detect hint (size + head/tail).
  // Never copy a prior full SHA-256 or mark ready — different middles can collide
  // on fingerprint; full hash always runs in finalizeFileAsync.
  let quickDetectJson: string | null = null;
  try {
    const prior = getDb()
      .prepare(
        `SELECT detect_json FROM files
         WHERE fingerprint = ? AND size = ? AND detect_json IS NOT NULL
         LIMIT 1`,
      )
      .get(fingerprint, validated.size) as { detect_json: string } | undefined;
    if (prior?.detect_json) {
      // Provisional UI response only — not identity; not written to detect_cache by checksum
      quickDetectJson = prior.detect_json;
    }
  } catch {
    /* fingerprint column may be missing mid-migration */
  }

  if (!quickDetectJson) {
    try {
      const det = await detectFileQuick(opts.path, opts.originalName);
      quickDetectJson = JSON.stringify(det);
    } catch {
      quickDetectJson = null;
    }
  }

  const row = insertFile({
    workspaceId: opts.workspaceId,
    originalName: opts.originalName,
    storedName: opts.storedName,
    path: opts.path,
    mime: validated.mime,
    size: validated.size,
    ext: validated.ext,
    checksum: null,
    fingerprint,
    uploadSessionId: opts.uploadSessionId ?? null,
    detectJson: quickDetectJson,
    status: 'processing',
  });

  // Always stream full checksum (+ deep detect) in background
  scheduleFileFinalize(row.id);

  return filePublic(getFile(row.id)!);
}

export function updateFileDetect(fileId: string, detect: unknown): void {
  const json = JSON.stringify(detect);
  getDb()
    .prepare(`UPDATE files SET detect_json = ?, updated_at = ? WHERE id = ?`)
    .run(json, now(), fileId);
  // Best-effort checksum-keyed detect cache (never aborts the route)
  const row = dbGetFile(fileId);
  if (row?.checksum) {
    setDetectCache(row.checksum, detect);
  }
}

export function softDeleteFile(workspaceId: string, fileId: string): void {
  const row = getFile(fileId);
  if (!row || row.workspace_id !== workspaceId) throw notFound('File not found');
  const t = now();
  getDb()
    .prepare(`UPDATE files SET status = 'deleted', updated_at = ? WHERE id = ?`)
    .run(t, fileId);
  // Keep disk file until retention cleanup (may be referenced by jobs)
  const selected = JSON.parse(getWorkspace(workspaceId)?.selected_file_ids || '[]') as string[];
  const next = selected.filter((id) => id !== fileId);
  getDb()
    .prepare(`UPDATE workspaces SET selected_file_ids = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(next), t, workspaceId);

  // Do not attach full file DTO — clients must drop the id, not upsert a ghost "deleted" card
  emitWorkspaceEvent({
    type: 'file.deleted',
    workspaceId,
    fileId,
    status: 'deleted',
    message: 'File removed',
  });
}

export function patchWorkspace(
  id: string,
  patch: {
    route?: string;
    selectedFileIds?: string[];
    ui?: Record<string, unknown>;
    toolSettings?: Record<string, Record<string, unknown>>;
  },
): WorkspaceRow {
  const ws = getWorkspace(id);
  if (!ws || ws.status !== 'active') throw notFound('Workspace not found');
  const t = now();
  const db = getDb();
  const tx = db.transaction(() => {
    let route = ws.route;
    let selected = ws.selected_file_ids;
    let ui = ws.ui_json;
    if (patch.route != null) route = String(patch.route).slice(0, 64);
    if (patch.selectedFileIds) selected = JSON.stringify(patch.selectedFileIds.slice(0, 100));
    if (patch.ui) {
      const prev = safeJson(ws.ui_json);
      ui = JSON.stringify({ ...prev, ...patch.ui });
    }
    db.prepare(
      `UPDATE workspaces SET route = ?, selected_file_ids = ?, ui_json = ?, updated_at = ?, last_seen_at = ? WHERE id = ?`,
    ).run(route, selected, ui, t, t, id);

    if (patch.toolSettings) {
      const upsert = db.prepare(
        `INSERT INTO tool_settings (workspace_id, tool, settings_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id, tool) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
      );
      for (const [tool, settings] of Object.entries(patch.toolSettings)) {
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(tool)) continue;
        upsert.run(id, tool, JSON.stringify(settings ?? {}), t);
      }
    }
  });
  tx();
  return getWorkspace(id)!;
}

export function getToolSettings(workspaceId: string): Record<string, Record<string, unknown>> {
  const rows = getDb()
    .prepare(`SELECT tool, settings_json FROM tool_settings WHERE workspace_id = ?`)
    .all(workspaceId) as { tool: string; settings_json: string }[];
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    out[r.tool] = safeJson(r.settings_json);
  }
  return out;
}

export function hydrateWorkspace(id: string) {
  const ws = getWorkspace(id);
  if (!ws) throw notFound('Workspace not found');
  touchWorkspace(id);

  const rawFiles = listWorkspaceFiles(id);
  const files = rawFiles.map((f) => filePublic(verifyFileOnDisk(f)));

  // Drop missing/deleted from selection; processing files remain usable (id + disk ready)
  const selected = (JSON.parse(ws.selected_file_ids || '[]') as string[]).filter((fid) =>
    files.some((f) => f.id === fid && (f.status === 'ready' || f.status === 'processing')),
  );

  const jobs = getDb()
    .prepare(
      `SELECT * FROM jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(id) as JobRow[];

  // Enrich jobs with input file ids/names from job_files (for Converted Files source column)
  const jobInputMeta = loadJobInputMeta(jobs.map((j) => j.id));

  const outputs = getDb()
    .prepare(
      `SELECT id, workspace_id, job_id, name, mime, size, created_at FROM outputs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(id) as {
    id: string;
    workspace_id: string;
    job_id: string | null;
    name: string;
    mime: string | null;
    size: number;
    created_at: string;
  }[];

  const activity = getDb()
    .prepare(
      `SELECT a.* FROM activity a
       LEFT JOIN jobs j ON j.id = a.job_id
       WHERE j.workspace_id = ? OR a.job_id IS NULL
       ORDER BY a.created_at DESC LIMIT 50`,
    )
    .all(id) as {
    id: string;
    job_id: string | null;
    tool: string;
    action: string;
    status: string;
    detail: string | null;
    created_at: string;
  }[];

  return {
    id: ws.id,
    route: ws.route,
    status: ws.status,
    selectedFileIds: selected,
    ui: safeJson(ws.ui_json),
    toolSettings: getToolSettings(id),
    files,
    jobs: jobs.map((j) => {
      const meta = jobInputMeta.get(j.id);
      return jobPublicDto(j, meta ? { uploadIds: meta.uploadIds, inputFileNames: meta.inputFileNames } : undefined);
    }),
    outputs: outputs.map((o) => ({
      id: o.id,
      jobId: o.job_id,
      name: o.name,
      mime: o.mime,
      size: o.size,
      downloadUrl: `/api/outputs/${o.id}/download`,
      createdAt: o.created_at,
    })),
    activity: activity.map((a) => ({
      id: a.id,
      jobId: a.job_id,
      tool: a.tool,
      action: a.action,
      status: a.status,
      detail: a.detail,
      createdAt: a.created_at,
    })),
    createdAt: ws.created_at,
    updatedAt: ws.updated_at,
    lastSeenAt: ws.last_seen_at,
  };
}

export function clearWorkspace(id: string): void {
  const ws = getWorkspace(id);
  if (!ws) throw notFound('Workspace not found');
  const t = now();
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE files SET status = 'deleted', updated_at = ? WHERE workspace_id = ?`).run(t, id);
    db.prepare(
      `UPDATE workspaces SET selected_file_ids = '[]', ui_json = '{}', updated_at = ?, last_seen_at = ? WHERE id = ?`,
    ).run(t, t, id);
    db.prepare(`DELETE FROM tool_settings WHERE workspace_id = ?`).run(id);
  })();
}

export function deleteWorkspace(id: string): void {
  const ws = getWorkspace(id);
  if (!ws) throw notFound('Workspace not found');
  getDb()
    .prepare(`UPDATE workspaces SET status = 'deleted', updated_at = ? WHERE id = ?`)
    .run(now(), id);
  clearWorkspace(id);
}

/** Hard-delete workspace row + jobs/outputs/files/disk when no active jobs. */
export function hardPurgeWorkspace(id: string): void {
  const db = getDb();
  const active = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM jobs WHERE workspace_id = ? AND status IN ('queued','running')`,
      )
      .get(id) as { c: number }
  ).c;
  if (active > 0) {
    logger.info({ id, active }, 'Skip hard purge: active jobs');
    return;
  }

  const outs = db
    .prepare(`SELECT id, path FROM outputs WHERE workspace_id = ?`)
    .all(id) as { id: string; path: string }[];
  for (const o of outs) {
    try {
      if (fs.existsSync(o.path)) fs.rmSync(o.path, { force: true });
      const parent = path.dirname(o.path);
      if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
    } catch {
      /* ignore */
    }
    db.prepare(`DELETE FROM outputs WHERE id = ?`).run(o.id);
  }

  const jobs = db
    .prepare(`SELECT id, output_path FROM jobs WHERE workspace_id = ?`)
    .all(id) as { id: string; output_path: string | null }[];
  for (const j of jobs) {
    if (j.output_path) {
      try {
        if (fs.existsSync(j.output_path)) fs.rmSync(j.output_path, { force: true });
      } catch {
        /* ignore */
      }
    }
    db.prepare(`DELETE FROM job_files WHERE job_id = ?`).run(j.id);
    db.prepare(`DELETE FROM jobs WHERE id = ?`).run(j.id);
  }

  const files = db
    .prepare(`SELECT id, path FROM files WHERE workspace_id = ?`)
    .all(id) as { id: string; path: string }[];
  for (const f of files) {
    try {
      if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
    } catch {
      /* ignore */
    }
    db.prepare(`DELETE FROM files WHERE id = ?`).run(f.id);
    try {
      db.prepare(`DELETE FROM uploads WHERE id = ?`).run(f.id);
    } catch {
      /* ignore */
    }
  }

  db.prepare(`DELETE FROM tool_settings WHERE workspace_id = ?`).run(id);
  db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  logger.info({ id }, 'Hard-purged expired workspace');
}

export function registerJobOutput(opts: {
  workspaceId?: string | null;
  jobId: string;
  name: string;
  mime: string;
  path: string;
  size: number;
}): string {
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO outputs (id, workspace_id, job_id, name, mime, path, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.workspaceId ?? null,
      opts.jobId,
      opts.name,
      opts.mime,
      opts.path,
      opts.size,
      now(),
    );
  return id;
}

export type OutputRow = {
  id: string;
  workspace_id: string | null;
  job_id: string | null;
  name: string;
  mime: string | null;
  path: string;
  size: number;
  created_at: string;
};

export function getOutput(id: string) {
  return getDb().prepare('SELECT * FROM outputs WHERE id = ?').get(id) as OutputRow | undefined;
}

export type ZipFileEntry = {
  id: string;
  name: string;
  path: string;
  size: number;
};

/**
 * Resolve workspace outputs for ZIP download.
 * - Empty outputIds + jobIds → all workspace outputs
 * - Otherwise → union of matching outputIds and jobIds (scoped to workspace)
 * Only returns paths that exist, are regular files, and have size > 0.
 */
export function listOutputsForZip(
  workspaceId: string,
  opts: { outputIds?: string[]; jobIds?: string[] } = {},
): ZipFileEntry[] {
  if (!getWorkspace(workspaceId)) throw notFound('Workspace not found');

  const outputIds = (opts.outputIds || []).filter((x): x is string => typeof x === 'string' && x.length > 0);
  const jobIds = (opts.jobIds || []).filter((x): x is string => typeof x === 'string' && x.length > 0);

  const db = getDb();
  let rows: OutputRow[];

  if (!outputIds.length && !jobIds.length) {
    rows = db
      .prepare(`SELECT * FROM outputs WHERE workspace_id = ? ORDER BY created_at ASC`)
      .all(workspaceId) as OutputRow[];
  } else {
    const byId =
      outputIds.length > 0
        ? (db
            .prepare(
              `SELECT * FROM outputs WHERE workspace_id = ? AND id IN (${outputIds.map(() => '?').join(',')})`,
            )
            .all(workspaceId, ...outputIds) as OutputRow[])
        : [];
    const byJob =
      jobIds.length > 0
        ? (db
            .prepare(
              `SELECT * FROM outputs WHERE workspace_id = ? AND job_id IN (${jobIds.map(() => '?').join(',')})`,
            )
            .all(workspaceId, ...jobIds) as OutputRow[])
        : [];
    const map = new Map<string, OutputRow>();
    for (const r of [...byId, ...byJob]) map.set(r.id, r);
    rows = [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  const out: ZipFileEntry[] = [];
  for (const r of rows) {
    try {
      if (!r.path || !fs.existsSync(r.path)) continue;
      const st = fs.statSync(r.path);
      if (!st.isFile() || st.size <= 0) continue;
      out.push({
        id: r.id,
        name: r.name || 'download',
        path: r.path,
        size: st.size,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/**
 * Soft-delete expired active workspaces, then hard-purge deleted workspaces
 * (jobs, outputs, files, disk) when past retention and no active jobs.
 */
export function cleanupExpiredWorkspaces(): void {
  const cutoff = new Date(Date.now() - config.workspaceRetentionMs).toISOString();
  const db = getDb();
  const expired = db
    .prepare(
      `SELECT id FROM workspaces WHERE last_seen_at < ? AND status = 'active'`,
    )
    .all(cutoff) as { id: string }[];

  for (const { id } of expired) {
    try {
      deleteWorkspace(id);
    } catch (e) {
      logger.warn({ err: e, id }, 'Failed to expire workspace');
    }
  }

  // Hard-purge soft-deleted workspaces past retention (no active jobs)
  const deletedWs = db
    .prepare(
      `SELECT id FROM workspaces WHERE status = 'deleted' AND (last_seen_at < ? OR updated_at < ?)`,
    )
    .all(cutoff, cutoff) as { id: string }[];
  for (const { id } of deletedWs) {
    try {
      hardPurgeWorkspace(id);
    } catch (e) {
      logger.warn({ err: e, id }, 'Failed to hard-purge workspace');
    }
  }

  // Orphan deleted files older than retention — remove disk + row
  const orphanFiles = db
    .prepare(
      `SELECT id, path FROM files WHERE status = 'deleted' AND updated_at < ?`,
    )
    .all(cutoff) as { id: string; path: string }[];
  for (const f of orphanFiles) {
    try {
      if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
    } catch {
      /* ignore */
    }
    db.prepare(`DELETE FROM files WHERE id = ?`).run(f.id);
  }

  // Missing files with no job refs
  const missing = db
    .prepare(`SELECT id, path FROM files WHERE status = 'missing'`)
    .all() as { id: string; path: string }[];
  for (const f of missing) {
    const refs = (
      db.prepare(`SELECT COUNT(*) as c FROM job_files WHERE file_id = ?`).get(f.id) as { c: number }
    ).c;
    if (refs === 0) {
      try {
        if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
      } catch {
        /* ignore */
      }
      db.prepare(`DELETE FROM files WHERE id = ?`).run(f.id);
    }
  }

  if (expired.length || orphanFiles.length) {
    logger.info(
      { expiredWorkspaces: expired.length, orphanFiles: orphanFiles.length },
      'Workspace retention cleanup',
    );
  }
}

/** Full-file SHA-256 without buffering entire file (chunked). Prefer streamChecksum async. */
export function checksumFile(filePath: string): string {
  return checksumFileChunked(filePath);
}

export { streamChecksum, quickFingerprint } from '../lib/fingerprint.js';

function safeJson(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
