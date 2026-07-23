import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env') });

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(intEnv(name, fallback))));
}

export type JobCategory = 'image' | 'pdf' | 'media' | 'office' | 'general';

/**
 * Bounded worker pool size when MAX_CONCURRENT_JOBS is unset.
 * - CPU: leave 1 core for the API event loop (min 1)
 * - RAM: reserve 1 GiB, then budget ~768 MiB per worker
 * - Hard cap 4 so a local machine does not eagerly retain many process workers
 * Env override still wins via intEnv(MAX_CONCURRENT_JOBS).
 */
export function computeDefaultMaxConcurrentJobs(
  cpuCount = os.cpus()?.length || 2,
  freeBytes = os.freemem(),
): number {
  const byCpu = Math.max(1, cpuCount - 1);
  const freeMb = freeBytes / (1024 * 1024);
  const byRam = Math.max(1, Math.floor(Math.max(0, freeMb - 1024) / 768));
  return Math.min(4, Math.min(byCpu, byRam));
}

/** Conservative category ceilings. The global worker pool remains the hard cap. */
export function computeDefaultCategoryLimits(
  poolSize: number,
  freeBytes = os.freemem(),
): Record<JobCategory, number> {
  const pool = Math.max(1, Math.floor(poolSize));
  const freeMb = freeBytes / (1024 * 1024);
  return {
    image: Math.min(pool, freeMb >= 2048 ? 4 : freeMb >= 1024 ? 2 : 1),
    pdf: Math.min(pool, freeMb >= 1536 ? 2 : 1),
    media: Math.min(pool, freeMb >= 2048 ? 2 : 1),
    office: 1,
    general: pool,
  };
}

const defaultPoolSize = computeDefaultMaxConcurrentJobs();
const configuredPoolSize = boundedIntEnv(
  'WORKER_POOL_SIZE',
  intEnv('MAX_CONCURRENT_JOBS', defaultPoolSize),
  1,
  32,
);
const defaultCategoryLimits = computeDefaultCategoryLimits(configuredPoolSize);

export const config = {
  port: intEnv('PORT', 8787),
  host: process.env.HOST || '127.0.0.1',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  apiToken: process.env.API_AUTH_TOKEN || process.env.ALPHASTUDIO_AUTH_TOKEN || '',
  serveFrontend: !['0', 'false'].includes(String(process.env.SERVE_FRONTEND || '').toLowerCase()),
  dataDir: path.resolve(root, process.env.DATA_DIR || './data'),
  dbPath: path.resolve(root, process.env.DB_PATH || './data/alphastudio.db'),
  maxUploadBytes: intEnv('MAX_UPLOAD_BYTES', 100 * 1024 * 1024),
  uploadChunkBytes: boundedIntEnv('UPLOAD_CHUNK_BYTES', 5 * 1024 * 1024, 256 * 1024, 16 * 1024 * 1024),
  uploadSessionTtlMs: intEnv('UPLOAD_SESSION_TTL_MS', 24 * 60 * 60 * 1000),
  uploadChunkTimeoutMs: intEnv('UPLOAD_CHUNK_TIMEOUT_MS', 2 * 60 * 1000),
  maxOutputBytes: intEnv('MAX_OUTPUT_BYTES', 200 * 1024 * 1024),
  maxArchiveEntries: boundedIntEnv('MAX_ARCHIVE_ENTRIES', 10_000, 1, 100_000),
  maxExtractedBytes: intEnv('MAX_EXTRACTED_BYTES', 200 * 1024 * 1024),
  /** @deprecated Use WORKER_POOL_SIZE. Kept for backward-compatible diagnostics/tests. */
  maxConcurrentJobs: configuredPoolSize,
  workerCategoryLimits: {
    image: boundedIntEnv('IMAGE_WORKER_CONCURRENCY', defaultCategoryLimits.image, 1, 32),
    pdf: boundedIntEnv('PDF_WORKER_CONCURRENCY', defaultCategoryLimits.pdf, 1, 32),
    media: boundedIntEnv('MEDIA_WORKER_CONCURRENCY', defaultCategoryLimits.media, 1, 32),
    office: boundedIntEnv('OFFICE_WORKER_CONCURRENCY', defaultCategoryLimits.office, 1, 32),
    general: boundedIntEnv('GENERAL_WORKER_CONCURRENCY', defaultCategoryLimits.general, 1, 32),
  } satisfies Record<JobCategory, number>,
  workerHeartbeatMs: boundedIntEnv('WORKER_HEARTBEAT_MS', 2_000, 250, 60_000),
  workerStaleMs: boundedIntEnv('WORKER_STALE_MS', 12_000, 1_000, 120_000),
  workerCancelGraceMs: boundedIntEnv('WORKER_CANCEL_GRACE_MS', 2_000, 100, 30_000),
  maxJobAttempts: boundedIntEnv('MAX_JOB_ATTEMPTS', 2, 1, 10),
  jobTimeoutMs: intEnv('JOB_TIMEOUT_MS', 5 * 60 * 1000),
  /** Optional Python bridge timeout / address-space cap (Phase 1 runtime integration). */
  pythonTimeoutMs: intEnv('PYTHON_TIMEOUT_MS', 5 * 60 * 1000),
  pythonMaxMemoryMb: boundedIntEnv('PYTHON_MAX_MEMORY_MB', 1024, 128, 16384),
  tempTtlMs: intEnv('TEMP_TTL_MS', 60 * 60 * 1000),
  /** Workspace retention (ms). Default 7 days. */
  workspaceRetentionMs: intEnv('WORKSPACE_RETENTION_MS', 7 * 24 * 60 * 60 * 1000),
  logLevel: process.env.LOG_LEVEL || 'info',
  version: '3.6.0',
  get uploadsDir() {
    return path.join(this.dataDir, 'uploads');
  },
  get outputsDir() {
    return path.join(this.dataDir, 'outputs');
  },
  get tempDir() {
    return path.join(this.dataDir, 'temp');
  },
  get uploadSessionsDir() {
    return path.join(this.tempDir, 'upload-sessions');
  },
};

export type AppConfig = typeof config;
