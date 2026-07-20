import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';

/**
 * Idempotent CREATE for tables required by hot paths (detect cache, job cache).
 * Safe to run even when schema_migrations already lists an older version that
 * created them — heals partial applies / restored DBs missing the table.
 */
export function ensureRequiredTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS detect_cache (
      checksum TEXT PRIMARY KEY,
      detect_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_detect_cache_created ON detect_cache(created_at);

    CREATE TABLE IF NOT EXISTS job_result_cache (
      cache_key TEXT PRIMARY KEY,
      output_path TEXT NOT NULL,
      output_name TEXT NOT NULL,
      output_mime TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_result_cache_created ON job_result_cache(created_at);

    CREATE TABLE IF NOT EXISTS upload_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      declared_mime TEXT,
      size INTEGER NOT NULL,
      chunk_size INTEGER NOT NULL,
      total_chunks INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploading',
      finalized_file_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (finalized_file_id) REFERENCES files(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_upload_sessions_workspace
      ON upload_sessions(workspace_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_upload_sessions_expiry ON upload_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS upload_chunks (
      session_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_byte INTEGER NOT NULL,
      end_byte INTEGER NOT NULL,
      size INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, chunk_index),
      FOREIGN KEY (session_id) REFERENCES upload_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_upload_chunks_session
      ON upload_chunks(session_id, chunk_index);
  `);

  const cacheColumns = new Set(
    (db.prepare(`PRAGMA table_info(job_result_cache)`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (!cacheColumns.has('result_json')) {
    db.exec(`ALTER TABLE job_result_cache ADD COLUMN result_json TEXT`);
  }
  const jobColumns = new Set(
    (db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (jobColumns.size > 0 && !jobColumns.has('result_json')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN result_json TEXT`);
  }
}

/**
 * Incremental SQLite migrations. Each version runs once.
 * Keeps legacy tables (uploads, jobs, activity, profile, settings) intact.
 * All DDL uses IF NOT EXISTS / column-existence guards for safe re-apply.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );

  const migrations: { version: number; name: string; up: () => void }[] = [
    {
      version: 1,
      name: 'workspaces_files_jobs_core',
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            route TEXT NOT NULL DEFAULT 'dashboard',
            selected_file_ids TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'active',
            ui_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            path TEXT NOT NULL,
            mime TEXT,
            size INTEGER NOT NULL DEFAULT 0,
            checksum TEXT,
            ext TEXT,
            status TEXT NOT NULL DEFAULT 'ready',
            detect_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);
          CREATE INDEX IF NOT EXISTS idx_files_checksum ON files(checksum);
          CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status);
          CREATE INDEX IF NOT EXISTS idx_workspaces_last_seen ON workspaces(last_seen_at);

          CREATE TABLE IF NOT EXISTS tool_settings (
            workspace_id TEXT NOT NULL,
            tool TEXT NOT NULL,
            settings_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, tool),
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS job_files (
            job_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'input',
            PRIMARY KEY (job_id, file_id, role),
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_job_files_job ON job_files(job_id);
          CREATE INDEX IF NOT EXISTS idx_job_files_file ON job_files(file_id);

          CREATE TABLE IF NOT EXISTS outputs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT,
            job_id TEXT,
            name TEXT NOT NULL,
            mime TEXT,
            path TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
          );

          CREATE INDEX IF NOT EXISTS idx_outputs_workspace ON outputs(workspace_id);
          CREATE INDEX IF NOT EXISTS idx_outputs_job ON outputs(job_id);
        `);

        // Extend jobs with workspace_id / tool columns if missing
        const cols = (
          db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[]
        ).map((c) => c.name);
        if (!cols.includes('workspace_id')) {
          db.exec(`ALTER TABLE jobs ADD COLUMN workspace_id TEXT`);
        }
        if (!cols.includes('tool')) {
          db.exec(`ALTER TABLE jobs ADD COLUMN tool TEXT`);
        }
        db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id)`);

        // Extend uploads for checksum + workspace (legacy bridge)
        const upCols = (
          db.prepare(`PRAGMA table_info(uploads)`).all() as { name: string }[]
        ).map((c) => c.name);
        if (!upCols.includes('checksum')) {
          db.exec(`ALTER TABLE uploads ADD COLUMN checksum TEXT`);
        }
        if (!upCols.includes('workspace_id')) {
          db.exec(`ALTER TABLE uploads ADD COLUMN workspace_id TEXT`);
        }
        if (!upCols.includes('status')) {
          db.exec(`ALTER TABLE uploads ADD COLUMN status TEXT DEFAULT 'ready'`);
        }
      },
    },
    {
      version: 2,
      name: 'indexes_detect_and_job_result_cache',
      up: () => {
        // Ensure hot-path indexes (idempotent IF NOT EXISTS)
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_files_checksum ON files(checksum);
          CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);
          CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
          CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
        `);

        // uploads.checksum index only if column exists
        const upCols = (
          db.prepare(`PRAGMA table_info(uploads)`).all() as { name: string }[]
        ).map((c) => c.name);
        if (upCols.includes('checksum')) {
          db.exec(`CREATE INDEX IF NOT EXISTS idx_uploads_checksum ON uploads(checksum)`);
        }

        // Detection + job result caches (also re-ensured by ensureRequiredTables)
        ensureRequiredTables(db);

        // Backfill detect_cache from existing files.detect_json (one per checksum)
        try {
          db.exec(`
            INSERT OR IGNORE INTO detect_cache (checksum, detect_json, created_at)
            SELECT f.checksum, f.detect_json, COALESCE(f.updated_at, f.created_at)
            FROM files f
            INNER JOIN (
              SELECT checksum, MAX(updated_at) AS max_u
              FROM files
              WHERE checksum IS NOT NULL AND checksum != ''
                AND detect_json IS NOT NULL AND detect_json != ''
              GROUP BY checksum
            ) latest ON f.checksum = latest.checksum AND f.updated_at = latest.max_u
            WHERE f.detect_json IS NOT NULL AND f.detect_json != ''
          `);
        } catch {
          /* non-fatal if files table empty / shape differs */
        }
      },
    },
    {
      version: 3,
      name: 'files_fingerprint_column',
      up: () => {
        const fileCols = (
          db.prepare(`PRAGMA table_info(files)`).all() as { name: string }[]
        ).map((c) => c.name);
        if (!fileCols.includes('fingerprint')) {
          db.exec(`ALTER TABLE files ADD COLUMN fingerprint TEXT`);
        }
        db.exec(`CREATE INDEX IF NOT EXISTS idx_files_fingerprint ON files(fingerprint)`);

        const upCols = (
          db.prepare(`PRAGMA table_info(uploads)`).all() as { name: string }[]
        ).map((c) => c.name);
        if (!upCols.includes('fingerprint')) {
          db.exec(`ALTER TABLE uploads ADD COLUMN fingerprint TEXT`);
        }
      },
    },
    {
      version: 4,
      name: 'detect_cache_heal_indexes',
      up: () => {
        // Explicit versioned re-apply of cache tables + indexes for DBs that
        // recorded v2 without the physical table (partial/corrupt restore).
        ensureRequiredTables(db);
      },
    },
    {
      version: 5,
      name: 'process_worker_leases_and_retry_state',
      up: () => {
        const jobCols = new Set(
          (db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[]).map(
            (c) => c.name,
          ),
        );
        const columns: Array<{ name: string; ddl: string }> = [
          { name: 'job_category', ddl: `TEXT NOT NULL DEFAULT 'general'` },
          { name: 'worker_id', ddl: 'TEXT' },
          { name: 'worker_lease', ddl: 'TEXT' },
          { name: 'claimed_at', ddl: 'TEXT' },
          { name: 'last_heartbeat_at', ddl: 'TEXT' },
          { name: 'timeout_at', ddl: 'TEXT' },
          { name: 'attempt_count', ddl: 'INTEGER NOT NULL DEFAULT 0' },
          { name: 'max_attempts', ddl: 'INTEGER NOT NULL DEFAULT 2' },
          { name: 'retryable', ddl: 'INTEGER NOT NULL DEFAULT 0' },
          { name: 'error_code', ddl: 'TEXT' },
        ];
        for (const column of columns) {
          if (!jobCols.has(column.name)) {
            db.exec(`ALTER TABLE jobs ADD COLUMN ${column.name} ${column.ddl}`);
          }
        }

        // Coarse backfill for jobs created by pre-v3.5 builds. New jobs are
        // classified in application code with input filenames/options.
        db.exec(`
          UPDATE jobs
          SET job_category = CASE
            WHEN type IN ('image', 'qr') THEN 'image'
            WHEN type = 'pdf' THEN 'pdf'
            WHEN type IN ('media', 'audio') THEN 'media'
            WHEN type = 'converter' AND json_valid(options) AND lower(COALESCE(json_extract(options, '$.format'), ''))
              IN ('doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp') THEN 'office'
            ELSE 'general'
          END
          WHERE job_category IS NULL OR job_category = '' OR job_category = 'general';

          UPDATE jobs SET max_attempts = 2 WHERE max_attempts IS NULL OR max_attempts < 1;
          UPDATE jobs SET attempt_count = 0 WHERE attempt_count IS NULL OR attempt_count < 0;
          UPDATE jobs SET retryable = 0 WHERE retryable IS NULL;

          CREATE INDEX IF NOT EXISTS idx_jobs_queue_category
            ON jobs(status, job_category, created_at);
          CREATE INDEX IF NOT EXISTS idx_jobs_worker_lease
            ON jobs(worker_lease);
        `);
      },
    },
    {
      version: 6,
      name: 'resumable_upload_sessions_and_verified_duplicates',
      up: () => {
        ensureRequiredTables(db);
        const fileCols = new Set(
          (db.prepare(`PRAGMA table_info(files)`).all() as { name: string }[]).map((c) => c.name),
        );
        if (!fileCols.has('upload_session_id')) {
          db.exec(`ALTER TABLE files ADD COLUMN upload_session_id TEXT`);
        }
        if (!fileCols.has('duplicate_of')) {
          db.exec(`ALTER TABLE files ADD COLUMN duplicate_of TEXT`);
        }
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_files_upload_session ON files(upload_session_id);
          CREATE INDEX IF NOT EXISTS idx_files_verified_duplicate
            ON files(size, checksum) WHERE checksum IS NOT NULL;
          UPDATE upload_sessions
          SET status = 'uploading', last_error = 'Server restarted during finalize', updated_at = datetime('now')
          WHERE status = 'finalizing';
        `);
      },
    },
    {
      version: 7,
      name: 'persist_sanitized_job_result_metadata',
      up: () => {
        const jobColumns = new Set(
          (db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[]).map(
            (column) => column.name,
          ),
        );
        if (!jobColumns.has('result_json')) {
          db.exec(`ALTER TABLE jobs ADD COLUMN result_json TEXT`);
        }
        ensureRequiredTables(db);
      },
    },
  ];

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      m.up();
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        m.version,
        now,
      );
    });
    tx();
    logger.info({ version: m.version, name: m.name }, 'Migration applied');
  }

  // Always heal required tables after versioned migrations (idempotent).
  ensureRequiredTables(db);
}

/**
 * Non-destructive schema repair: re-run migrations + ensure required tables.
 * Does not wipe data. Safe to call from CLI `db:repair` or doctor --fix-schema.
 */
export function repairSchema(db: Database.Database): { tables: string[]; versions: number[] } {
  runMigrations(db);
  ensureRequiredTables(db);
  const versions = (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[]
  ).map((r) => r.version);
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
  return { tables, versions };
}
