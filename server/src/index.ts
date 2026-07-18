import { config } from './config.js';
import { ensureDataDirs } from './lib/paths.js';
import { logger } from './lib/logger.js';
import { initDb, closeDb, resumeQueuedJobs } from './db/index.js';
import { detectCapabilities } from './capabilities.js';
import { buildApp } from './app.js';
import {
  cleanupExpiredFiles,
  pumpQueue,
  orphanFileGc,
  startWorkerPool,
  stopWorkerPool,
} from './workers/jobs.js';
import { cleanupExpiredWorkspaces, resumeProcessingFiles } from './services/workspace.js';
import { cleanupExpiredUploadSessions } from './services/upload-session.js';
import { assertSafeBindHost } from './lib/bind-guard.js';

async function main() {
  assertSafeBindHost(config.host);
  ensureDataDirs();
  initDb();
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, host: config.host }, 'AlphaStudio API listening');
  const resumedFiles = resumeProcessingFiles();
  if (resumedFiles > 0) logger.info({ count: resumedFiles }, 'Resumed background file detection');

  // Listen first: health/upload endpoints are ready before worker startup and
  // remain independent from converter process load.
  startWorkerPool();
  resumeQueuedJobs(() => pumpQueue());

  // External binary probing can be slow on Windows. Warm it only after the API
  // is listening; bundled jobs (QR/image/text) remain immediately available.
  setImmediate(() => {
    try {
      detectCapabilities(false);
    } catch (err) {
      logger.warn({ err }, 'Capability warm-up failed');
    }
  });

  const cleanupTimer = setInterval(() => {
    try {
      cleanupExpiredFiles();
      cleanupExpiredWorkspaces();
      cleanupExpiredUploadSessions();
      // Safe orphan GC (not dry-run) for expired soft-deleted workspaces
      orphanFileGc({ dryRun: false });
    } catch (err) {
      logger.warn({ err }, 'Cleanup failed');
    }
  }, 15 * 60 * 1000);
  cleanupTimer.unref?.();

  // Defer initial cleanup so listen is not blocked by filesystem walks
  setImmediate(() => {
    try {
      cleanupExpiredFiles();
      cleanupExpiredWorkspaces();
      cleanupExpiredUploadSessions();
    } catch {
      /* ignore */
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown');
    clearInterval(cleanupTimer);
    try {
      await app.close();
    } catch (err) {
      logger.error({ err }, 'Error closing server');
    }
    await stopWorkerPool();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // Cross-platform process supervisors and the audit harness can request a
  // graceful stop over the private parent/child IPC channel. No network route
  // or shell command is exposed.
  process.on('message', (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: unknown }).type === 'alphastudio:shutdown'
    ) {
      void shutdown('IPC');
    }
  });
  process.once('disconnect', () => {
    if (process.channel) return;
    void shutdown('IPC_DISCONNECT');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
