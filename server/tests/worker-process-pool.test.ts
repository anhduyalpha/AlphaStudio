import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, `data-test-worker-process-${process.pid}`);

process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'worker-process.db');
process.env.LOG_LEVEL = 'error';
process.env.WORKER_POOL_SIZE = '1';
process.env.IMAGE_WORKER_CONCURRENCY = '1';
process.env.PDF_WORKER_CONCURRENCY = '1';
process.env.MEDIA_WORKER_CONCURRENCY = '1';
process.env.OFFICE_WORKER_CONCURRENCY = '1';
process.env.GENERAL_WORKER_CONCURRENCY = '1';
process.env.MAX_JOB_ATTEMPTS = '2';

const { config } = await import('../src/config.js');
const { ensureDataDirs } = await import('../src/lib/paths.js');
const { closeDb, getDb, initDb } = await import('../src/db/index.js');
const {
  cancelJob,
  classifyJobCategory,
  claimNextQueuedJob,
  createJob,
  getJob,
  getWorkerDiagnostics,
  startWorkerPool,
  stopWorkerPool,
  terminateWorkerForTest,
  validateJobOutput,
} = await import('../src/workers/jobs.js');

async function waitUntil<T>(read: () => T | null | undefined | false, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Condition was not met within ${timeoutMs} ms`);
}

function insertQueued(id: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO jobs (
         id, type, status, progress, message, input_files, options, created_at, updated_at,
         job_category, max_attempts
       ) VALUES (?, 'text', 'queued', 0, 'Queued', '[]', ?, ?, ?, 'general', 2)`,
    )
    .run(id, JSON.stringify({ operation: 'hash', input: id }), now, now);
}

function insertLargeUpload(id: string, bytes = 256 * 1024 * 1024): string {
  const storedName = `${id}.bin`;
  const filePath = path.join(config.uploadsDir, storedName);
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.closeSync(fs.openSync(filePath, 'w'));
  fs.truncateSync(filePath, bytes);
  getDb()
    .prepare(
      `INSERT INTO uploads (id, original_name, stored_name, path, mime, size, ext, created_at)
       VALUES (?, ?, ?, ?, 'application/octet-stream', ?, '.bin', ?)`,
    )
    .run(id, storedName, storedName, filePath, bytes, new Date().toISOString());
  return filePath;
}

async function waitTerminal(jobId: string) {
  return waitUntil(() => {
    const job = getJob(jobId);
    return job && ['completed', 'failed', 'cancelled'].includes(job.status) ? job : null;
  });
}

before(() => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
});

after(async () => {
  await stopWorkerPool();
  closeDb();
  fs.rmSync(testData, { recursive: true, force: true });
});

describe('atomic SQLite claims and restart recovery', () => {
  it('never returns the same queued job for two claims', () => {
    insertQueued('atomic-claim-one');
    const first = claimNextQueuedJob();
    const second = claimNextQueuedJob();
    assert.equal(first, 'atomic-claim-one');
    assert.equal(second, null);
    const row = getJob('atomic-claim-one');
    assert.equal(row?.attempt_count, 1);
    assert.ok(row?.worker_lease);
  });

  it('classifies running, queued and completed rows correctly after restart', () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE jobs SET status = 'running', attempt_count = 1, max_attempts = 2,
       worker_id = 'dead-worker', worker_lease = 'dead-worker-lease', output_path = NULL
       WHERE id = 'atomic-claim-one'`,
    ).run();
    insertQueued('restart-queued');
    db.prepare(
      `INSERT INTO jobs (
         id, type, status, progress, message, input_files, options, output_path,
         output_name, output_mime, created_at, updated_at, finished_at, job_category
       ) VALUES ('restart-completed', 'text', 'completed', 100, 'Completed', '[]', '{}',
         ?, 'kept.txt', 'text/plain', ?, ?, ?, 'general')`,
    ).run(path.join(config.outputsDir, 'kept.txt'), now, now, now);

    closeDb();
    initDb();

    const interrupted = getJob('atomic-claim-one');
    assert.equal(interrupted?.status, 'failed');
    assert.equal(interrupted?.error_code, 'SERVER_RESTART');
    assert.equal(Boolean(interrupted?.retryable), true);
    assert.equal(interrupted?.worker_lease, null);
    assert.equal(getJob('restart-queued')?.status, 'queued');
    const completed = getJob('restart-completed');
    assert.equal(completed?.status, 'completed');
    assert.equal(completed?.output_name, 'kept.txt');

    getDb().prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = 'restart-queued'`).run();
  });
});

describe('category scheduling', () => {
  it('classifies image, PDF, media and office converter work independently', () => {
    assert.equal(classifyJobCategory('image'), 'image');
    assert.equal(classifyJobCategory('pdf'), 'pdf');
    assert.equal(classifyJobCategory('audio'), 'media');
    assert.equal(classifyJobCategory('converter', { format: 'docx' }, ['source.txt']), 'office');
    assert.equal(classifyJobCategory('converter', { format: 'webm' }, ['source.mov']), 'media');
    assert.equal(classifyJobCategory('converter', { format: 'png' }, ['source.jpg']), 'image');
    assert.equal(classifyJobCategory('converter', { format: 'pdf' }, ['source.docx']), 'office');
    assert.equal(classifyJobCategory('converter', { format: 'png' }, ['slides.pptx']), 'office');
    assert.equal(classifyJobCategory('converter', { format: 'pdf' }, ['book.epub']), 'office');
  });

  it('publishes a bounded limit for every persisted category', () => {
    const diagnostics = getWorkerDiagnostics();
    for (const category of ['image', 'pdf', 'media', 'office', 'general']) {
      const limit = diagnostics.categoryLimits[category];
      assert.ok(Number.isInteger(limit));
      assert.ok(limit >= 0 && limit <= diagnostics.adaptivePoolSize);
    }
  });
});

describe('dedicated worker lifecycle', () => {
  it('isolates a real worker crash and marks its active job retryable', async () => {
    startWorkerPool();
    await waitUntil(() => {
      const diagnostics = getWorkerDiagnostics();
      return diagnostics.readyWorkers === 1 ? diagnostics : null;
    });

    const uploadId = 'worker-crash-large';
    insertLargeUpload(uploadId);
    const job = createJob({
      type: 'text',
      uploadIds: [uploadId],
      options: { operation: 'hash', algorithm: 'sha256' },
    });
    await waitUntil(() => (getWorkerDiagnostics().activeJobs === 1 ? true : null));
    assert.equal(terminateWorkerForTest(job.id), true);

    const failed = await waitTerminal(job.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'WORKER_CRASH');
    assert.equal(Boolean(failed.retryable), true);
    await waitUntil(() => (getWorkerDiagnostics().processCount === 1 ? true : null));
  });

  it('cancel stops the worker-owned job and never reports completion', async () => {
    const uploadId = 'worker-cancel-large';
    insertLargeUpload(uploadId);
    const job = createJob({
      type: 'text',
      uploadIds: [uploadId],
      options: { operation: 'hash', algorithm: 'sha512' },
    });
    await waitUntil(() => (getWorkerDiagnostics().activeJobs === 1 ? true : null));
    cancelJob(job.id);
    const cancelled = await waitTerminal(job.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.output_path, null);
  });

  it('enforces timeout and records a retryable timeout error', async () => {
    const previousTimeout = config.jobTimeoutMs;
    const previousGrace = config.workerCancelGraceMs;
    config.jobTimeoutMs = 20;
    config.workerCancelGraceMs = 50;
    try {
      const uploadId = 'worker-timeout-large';
      insertLargeUpload(uploadId, 512 * 1024 * 1024);
      const job = createJob({
        type: 'text',
        uploadIds: [uploadId],
        options: { operation: 'hash', algorithm: 'sha256' },
      });
      const failed = await waitTerminal(job.id);
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error_code, 'JOB_TIMEOUT');
      assert.equal(Boolean(failed.retryable), true);
      assert.equal(failed.output_path, null);
    } finally {
      config.jobTimeoutMs = previousTimeout;
      config.workerCancelGraceMs = previousGrace;
    }
  });
});

describe('output validation', () => {
  it('rejects forged PNG output before a job can be completed', () => {
    const forged = path.join(config.outputsDir, 'forged.png');
    fs.mkdirSync(config.outputsDir, { recursive: true });
    fs.writeFileSync(forged, 'not-a-png');
    assert.throws(
      () =>
        validateJobOutput(
          { outputPath: forged, outputName: 'forged.png', outputMime: 'image/png' },
          forged,
        ),
      /PNG/i,
    );
  });
});
