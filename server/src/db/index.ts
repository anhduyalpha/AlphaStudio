import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { ensureRequiredTables, repairSchema, runMigrations } from './migrations.js';
export { ensureRequiredTables, repairSchema, runMigrations } from './migrations.js';

/** Single process-wide connection — never create additional Database instances. */
let db: Database.Database | null = null;

/**
 * Module-level prepared statement cache for hot paths.
 * Statements are bound to the open connection; cleared on closeDb().
 */
type StmtMap = Map<string, Database.Statement>;
const stmtCache: StmtMap = new Map();

const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT,
  error TEXT,
  input_files TEXT NOT NULL DEFAULT '[]',
  options TEXT NOT NULL DEFAULT '{}',
  output_path TEXT,
  output_name TEXT,
  output_mime TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  tool TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT NOT NULL DEFAULT 'AlphaD',
  studio_name TEXT NOT NULL DEFAULT 'AlphaStudio',
  role TEXT NOT NULL DEFAULT 'AI & Automation Builder',
  location_label TEXT NOT NULL DEFAULT 'Personal workstation',
  bio TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  ext TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
`;

/** SQL keys for hot-path prepared statements */
const SQL = {
  getJob: 'SELECT * FROM jobs WHERE id = ?',
  getFile: 'SELECT * FROM files WHERE id = ?',
  updateJobProgress:
    `UPDATE jobs SET progress = ?, message = COALESCE(?, message), updated_at = ? WHERE id = ? AND status = 'running'`,
  getDetectByChecksum:
    `SELECT detect_json FROM detect_cache WHERE checksum = ?`,
  getDetectFromFiles:
    `SELECT detect_json FROM files WHERE checksum = ? AND detect_json IS NOT NULL AND detect_json != '' LIMIT 1`,
  setDetectCache:
    `INSERT INTO detect_cache (checksum, detect_json, created_at) VALUES (?, ?, ?)
     ON CONFLICT(checksum) DO UPDATE SET detect_json = excluded.detect_json, created_at = excluded.created_at`,
  getJobResultCache:
    `SELECT cache_key, output_path, output_name, output_mime, result_json, created_at FROM job_result_cache WHERE cache_key = ?`,
  setJobResultCache:
    `INSERT INTO job_result_cache (cache_key, output_path, output_name, output_mime, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       output_path = excluded.output_path,
       output_name = excluded.output_name,
       output_mime = excluded.output_mime,
       result_json = excluded.result_json,
       created_at = excluded.created_at`,
  deleteJobResultCache: `DELETE FROM job_result_cache WHERE cache_key = ?`,
} as const;

/**
 * Prepare-once helper. Reuses Statement objects across calls on the same connection.
 */
export function prepare(sql: string): Database.Statement {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

function clearStmtCache(): void {
  stmtCache.clear();
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function initDb(dbPath = config.dbPath): Database.Database {
  if (db) {
    // Connection reuse only — never open a second Database instance
    return db;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);

  // Performance / concurrency PRAGMAs (single connection)
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000'); // ms — wait on locked pages instead of failing
  db.pragma('synchronous = NORMAL'); // safe with WAL; faster than FULL
  db.pragma('cache_size = -64000'); // 64 MiB page cache (negative = KiB)

  db.exec(LEGACY_SCHEMA);
  runMigrations(db);
  // Heal detect_cache / job_result_cache even if schema_migrations lied
  ensureRequiredTables(db);
  clearStmtCache(); // migrations may have run; ensure clean cache after open

  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO profile (id, display_name, studio_name, role, location_label, bio, updated_at)
     VALUES (1, 'AlphaD', 'AlphaStudio', 'AI & Automation Builder', 'Personal workstation', '', ?)`,
  ).run(now);

  const defaults: Record<string, string> = {
    theme: 'system',
    density: 'comfortable',
    animations: 'true',
    defaultQuality: 'balanced',
    openAfterExport: 'true',
    preserveMetadata: 'true',
  };
  const insertSetting = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
  );
  for (const [k, v] of Object.entries(defaults)) {
    insertSetting.run(k, v, now);
  }

  // Job recovery: a process worker may have died with the API. Running claims
  // are never silently replayed; mark them explicitly retryable when attempts remain.
  const interrupted = db
    .prepare(
      `UPDATE jobs SET status = 'failed',
        error = COALESCE(error, 'Server restarted while job was running'),
        message = 'Interrupted by server restart',
        error_code = 'SERVER_RESTART',
        retryable = CASE WHEN attempt_count < max_attempts THEN 1 ELSE 0 END,
        worker_id = NULL, worker_lease = NULL, claimed_at = NULL,
        last_heartbeat_at = NULL, timeout_at = NULL,
        finished_at = ?, updated_at = ?
       WHERE status = 'running'`,
    )
    .run(now, now);
  if (interrupted.changes > 0) {
    logger.warn({ count: interrupted.changes }, 'Marked interrupted running jobs as failed');
  }

  // A finalize holds no cross-process lease. After restart, expose the durable
  // chunks for retry; finalize heals the narrow case where the file row was
  // already committed before the session completion update.
  const interruptedUploads = db
    .prepare(
      `UPDATE upload_sessions
       SET status = 'uploading', last_error = 'Server restarted during finalize', updated_at = ?
       WHERE status = 'finalizing'`,
    )
    .run(now);
  if (interruptedUploads.changes > 0) {
    logger.warn({ count: interruptedUploads.changes }, 'Recovered interrupted upload finalizations');
  }

  // Queued jobs have not started, so they are safe to resume with a clean lease.
  db.prepare(
    `UPDATE jobs SET cancel_requested = 0, worker_id = NULL, worker_lease = NULL,
      claimed_at = NULL, last_heartbeat_at = NULL, timeout_at = NULL, updated_at = ?
     WHERE status = 'queued'`,
  ).run(now);

  logger.info({ dbPath }, 'SQLite ready');
  return db;
}

/** Call after workers are imported so pumpQueue can re-enqueue. */
export function resumeQueuedJobs(pump: () => void): void {
  const database = getDb();
  const n = (
    database.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'queued'`).get() as {
      c: number;
    }
  ).c;
  if (n > 0) {
    logger.info({ count: n }, 'Resuming queued jobs');
    pump();
  }
}

export function closeDb(): void {
  if (db) {
    clearStmtCache();
    try {
      // Make the durable database self-contained before a supervisor starts a
      // replacement process. This is synchronous and only runs at shutdown.
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      logger.warn({ err }, 'SQLite WAL checkpoint during shutdown failed');
    }
    db.close();
    db = null;
  }
}

// ── Hot-path query helpers (prepared once per process) ──────────────────────

export function dbGetJob(id: string): JobRow | undefined {
  return prepare(SQL.getJob).get(id) as JobRow | undefined;
}

export function dbGetFile(id: string): FileRow | undefined {
  return prepare(SQL.getFile).get(id) as FileRow | undefined;
}

export function dbUpdateJobProgress(
  id: string,
  progress: number,
  message: string | null,
  updatedAt: string,
): void {
  prepare(SQL.updateJobProgress).run(progress, message, updatedAt, id);
}

// ── Detection cache (by file checksum) ──────────────────────────────────────

/**
 * Lookup detect result by content checksum.
 * Prefers dedicated detect_cache; falls back to files.detect_json.
 */
export function getDetectCacheByChecksum(checksum: string): unknown | null {
  if (!checksum) return null;
  try {
    const cached = prepare(SQL.getDetectByChecksum).get(checksum) as
      | { detect_json: string }
      | undefined;
    if (cached?.detect_json) {
      return parseJson(cached.detect_json);
    }
  } catch {
    /* table may not exist mid-migration edge case */
  }
  try {
    const fromFile = prepare(SQL.getDetectFromFiles).get(checksum) as
      | { detect_json: string }
      | undefined;
    if (fromFile?.detect_json) {
      return parseJson(fromFile.detect_json);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Persist detect JSON keyed by content checksum for future uploads.
 * Best-effort: never throws — missing table / write errors are logged only.
 * Callers (finalize) must not depend on this for ready status or SSE.
 */
export function setDetectCache(checksum: string, detect: unknown): void {
  if (!checksum || detect == null) return;
  try {
    const json = typeof detect === 'string' ? detect : JSON.stringify(detect);
    const t = new Date().toISOString();
    prepare(SQL.setDetectCache).run(checksum, json, t);
  } catch (err) {
    // Drop stale prepared statements (e.g. after DROP TABLE mid-process)
    clearStmtCache();
    logger.warn({ err, checksum: checksum.slice(0, 12) }, 'setDetectCache failed (best-effort)');
  }
}

/**
 * Non-destructive open of an existing DB path, run migrations + heal tables.
 * Used by `db:repair`. Does not replace the process-wide connection if already open
 * on a different path — call closeDb() first when switching paths.
 */
export function repairDb(dbPath = config.dbPath): { dbPath: string; tables: string[]; versions: number[] } {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // If already open on this path, heal in place
  if (db) {
    const result = repairSchema(db);
    clearStmtCache();
    logger.info({ dbPath, ...result }, 'SQLite schema repaired (existing connection)');
    return { dbPath, ...result };
  }
  const opened = new Database(dbPath);
  try {
    opened.pragma('journal_mode = WAL');
    opened.pragma('foreign_keys = ON');
    opened.pragma('busy_timeout = 5000');
    opened.exec(LEGACY_SCHEMA);
    const result = repairSchema(opened);
    logger.info({ dbPath, ...result }, 'SQLite schema repaired');
    return { dbPath, ...result };
  } finally {
    opened.close();
  }
}

// ── Job result cache ────────────────────────────────────────────────────────

export type JobResultCacheRow = {
  cache_key: string;
  output_path: string;
  output_name: string;
  output_mime: string | null;
  result_json: string | null;
  created_at: string;
};

export function getJobResultCache(cacheKey: string): JobResultCacheRow | undefined {
  if (!cacheKey) return undefined;
  return prepare(SQL.getJobResultCache).get(cacheKey) as JobResultCacheRow | undefined;
}

export function setJobResultCache(entry: {
  cacheKey: string;
  outputPath: string;
  outputName: string;
  outputMime?: string | null;
  meta?: Record<string, unknown> | null;
}): void {
  if (!entry.cacheKey) return;
  const t = new Date().toISOString();
  prepare(SQL.setJobResultCache).run(
    entry.cacheKey,
    entry.outputPath,
    entry.outputName,
    entry.outputMime ?? null,
    entry.meta ? JSON.stringify(entry.meta) : null,
    t,
  );
}

export function deleteJobResultCache(cacheKey: string): void {
  if (!cacheKey) return;
  prepare(SQL.deleteJobResultCache).run(cacheKey);
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export type JobRow = {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string | null;
  error: string | null;
  input_files: string;
  options: string;
  output_path: string | null;
  output_name: string | null;
  output_mime: string | null;
  result_json?: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested: number;
  job_category?: string | null;
  worker_id?: string | null;
  worker_lease?: string | null;
  claimed_at?: string | null;
  last_heartbeat_at?: string | null;
  timeout_at?: string | null;
  attempt_count?: number | null;
  max_attempts?: number | null;
  retryable?: number | null;
  error_code?: string | null;
  workspace_id?: string | null;
  tool?: string | null;
};

export type ActivityRow = {
  id: string;
  job_id: string | null;
  tool: string;
  action: string;
  status: string;
  detail: string | null;
  created_at: string;
};

export type ProfileRow = {
  id: number;
  display_name: string;
  studio_name: string;
  role: string;
  location_label: string;
  bio: string;
  updated_at: string;
};

export type WorkspaceRow = {
  id: string;
  route: string;
  selected_file_ids: string;
  status: string;
  ui_json: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
};

export type FileRow = {
  id: string;
  workspace_id: string;
  original_name: string;
  stored_name: string;
  path: string;
  mime: string | null;
  size: number;
  checksum: string | null;
  /** Quick size+head/tail fingerprint (not full-file hash) */
  fingerprint?: string | null;
  /** Resumable session that produced this file, when applicable. */
  upload_session_id?: string | null;
  /** Prior file id only after size + full SHA-256 equality is verified. */
  duplicate_of?: string | null;
  ext: string | null;
  status: string;
  detect_json: string | null;
  created_at: string;
  updated_at: string;
};
