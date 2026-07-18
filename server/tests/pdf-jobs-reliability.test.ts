/**
 * Reliability coverage for job dedupe, cache keys (checksums), output validation,
 * workspace event versions, cancel flags / progress batching, and path sanitization
 * on job error paths. Imports real shipped modules only — no reimplementation.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test-pdf-jobs-reliability');

process.env.PORT = '8827';
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'reliability.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'error';
process.env.MAX_CONCURRENT_JOBS = '2';

const { config } = await import('../src/config.js');
const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const {
  findActiveDuplicateJob,
  createJob,
  cancelJob,
  getJob,
  buildJobCacheKey,
  normalizeOptionsForCache,
  validateJobOutput,
  shouldWriteProgress,
  createProgressBatcher,
  pumpQueue,
  stopWorkerPool,
  PROGRESS_MIN_DELTA,
} = await import('../src/workers/jobs.js');
const {
  emitWorkspaceEvent,
  nextEventVersion,
  onWorkspaceEvent,
} = await import('../src/lib/workspace-events.js');
const { sanitizeUserError } = await import('../src/convert/pdfInspect.js');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function insertUpload(id: string, fileName: string, buf: Buffer): string {
  const uploadsDir = path.join(testData, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const uploadPath = path.join(uploadsDir, fileName);
  fs.writeFileSync(uploadPath, buf);
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO uploads (id, original_name, stored_name, path, mime, size, ext, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      fileName,
      fileName,
      uploadPath,
      'image/png',
      buf.length,
      path.extname(fileName) || '.png',
      new Date().toISOString(),
    );
  return uploadPath;
}

function forceCancelDb(id: string): void {
  try {
    cancelJob(id);
  } catch {
    /* ignore */
  }
  try {
    getDb().prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = ?`).run(id);
  } catch {
    /* ignore */
  }
}

async function waitForJobStatus(
  id: string,
  statuses: string[],
  timeoutMs = 12_000,
): Promise<NonNullable<ReturnType<typeof getJob>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const j = getJob(id);
    if (j && statuses.includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 40));
  }
  const last = getJob(id);
  throw new Error(
    `timeout waiting for job ${id} in [${statuses.join(',')}]; last=${last?.status} err=${last?.error}`,
  );
}

before(() => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
});

after(async () => {
  // A terminal DB status can be observed just before the worker settlement
  // finishes its filesystem cleanup. Drain the real pool before closing the
  // shared SQLite connection so no scheduled pump can outlive this suite.
  await stopWorkerPool();
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('findActiveDuplicateJob / createJob converter dedupe', () => {
  it('createJob returns same active job for identical converter inputs (no duplicate active)', () => {
    const uploadId = 'up-rel-dedupe-1';
    insertUpload(uploadId, 'rel-dedupe-1.png', TINY_PNG);

    const prevMax = config.maxConcurrentJobs;
    config.maxConcurrentJobs = 0;
    let j1Id: string | undefined;
    let jDiffId: string | undefined;
    try {
      const j1 = createJob({
        type: 'converter',
        uploadIds: [uploadId],
        options: { format: 'webp', quality: 75 },
        workspaceId: 'ws-rel-dedupe',
      });
      j1Id = j1.id;
      assert.equal(j1.status, 'queued');

      const found = findActiveDuplicateJob({
        type: 'converter',
        workspaceId: 'ws-rel-dedupe',
        uploadIds: [uploadId],
        options: { quality: 75, format: 'webp' },
      });
      assert.ok(found, 'findActiveDuplicateJob should see queued converter');
      assert.equal(found!.id, j1.id);

      const j2 = createJob({
        type: 'converter',
        uploadIds: [uploadId],
        options: { quality: 75, format: 'webp' },
        workspaceId: 'ws-rel-dedupe',
      });
      assert.equal(j2.id, j1.id, 'createJob must not insert a second active converter job');

      // Different format → new job
      const jDiff = createJob({
        type: 'converter',
        uploadIds: [uploadId],
        options: { format: 'png' },
        workspaceId: 'ws-rel-dedupe',
      });
      jDiffId = jDiff.id;
      assert.notEqual(jDiff.id, j1.id);

      // After cancel, active duplicate is gone
      cancelJob(j1.id);
      const afterCancel = findActiveDuplicateJob({
        type: 'converter',
        workspaceId: 'ws-rel-dedupe',
        uploadIds: [uploadId],
        options: { format: 'webp', quality: 75 },
      });
      assert.equal(afterCancel, undefined, 'cancelled job must not count as active duplicate');
    } finally {
      config.maxConcurrentJobs = prevMax;
      for (const id of [j1Id, jDiffId]) {
        if (id) forceCancelDb(id);
      }
    }
  });

  it('matches by clientRequestId / dedupeKey when provided', () => {
    const prevMax = config.maxConcurrentJobs;
    config.maxConcurrentJobs = 0;
    let id: string | undefined;
    try {
      const j1 = createJob({
        type: 'text',
        uploadIds: [],
        options: { operation: 'hash', input: 'idem-a', algorithm: 'sha256' },
        workspaceId: 'ws-rel-idemp',
        clientRequestId: 'client-req-rel-1',
        dedupeKey: 'dedupe-rel-1',
      });
      id = j1.id;

      const byClient = findActiveDuplicateJob({
        type: 'text',
        workspaceId: 'ws-rel-idemp',
        uploadIds: [],
        options: { operation: 'hash', input: 'different-payload' },
        clientRequestId: 'client-req-rel-1',
      });
      assert.equal(byClient?.id, j1.id);

      const byKey = findActiveDuplicateJob({
        type: 'text',
        workspaceId: 'ws-rel-idemp',
        uploadIds: [],
        options: { operation: 'hash', input: 'also-different' },
        dedupeKey: 'dedupe-rel-1',
      });
      assert.equal(byKey?.id, j1.id);

      const j2 = createJob({
        type: 'text',
        uploadIds: [],
        options: { operation: 'hash', input: 'idem-b', algorithm: 'sha256' },
        workspaceId: 'ws-rel-idemp',
        clientRequestId: 'client-req-rel-1',
      });
      assert.equal(j2.id, j1.id, 'idempotent create via clientRequestId');
    } finally {
      config.maxConcurrentJobs = prevMax;
      if (id) forceCancelDb(id);
    }
  });
});

describe('buildJobCacheKey uses checksums', () => {
  it('includes checksums so different inputs yield different keys', () => {
    const opts = { format: 'png', operation: 'convert', quality: 80 };
    const a = buildJobCacheKey('converter', ['checksum-aaa'], opts);
    const b = buildJobCacheKey('converter', ['checksum-bbb'], opts);
    assert.notEqual(a, b, 'different checksums must change cache key');

    const sameOrder = buildJobCacheKey('converter', ['c2', 'c1'], opts);
    const reordered = buildJobCacheKey('converter', ['c1', 'c2'], opts);
    assert.equal(sameOrder, reordered, 'checksum list is sorted for stability');

    // Payload shape: sha256 hex of JSON containing type + checksums + options
    assert.match(a, /^[a-f0-9]{64}$/);
    const withOpts = buildJobCacheKey('converter', ['checksum-aaa'], {
      ...opts,
      quality: 90,
    });
    assert.notEqual(a, withOpts);

    const norm = normalizeOptionsForCache({
      format: 'png',
      workspaceId: 'ws-x',
      _detectByPath: { p: 1 },
      clientRequestId: 'ignore-me',
    }) as Record<string, unknown>;
    assert.equal(norm.workspaceId, undefined);
    assert.equal(norm._detectByPath, undefined);
    assert.equal(norm.clientRequestId, undefined);
    assert.equal(norm.format, 'png');
  });
});

describe('validateJobOutput rejects empty / whitespace-only text', () => {
  it('rejects zero-byte files', () => {
    const empty = path.join(testData, 'empty-out.bin');
    fs.writeFileSync(empty, Buffer.alloc(0));
    assert.throws(
      () =>
        validateJobOutput(
          {
            outputPath: empty,
            outputName: 'empty.bin',
            outputMime: 'application/octet-stream',
          },
          empty,
        ),
      /empty/i,
    );
  });

  it('rejects whitespace-only .txt / text/plain outputs', () => {
    const wsOnly = path.join(testData, 'whitespace-only.txt');
    fs.writeFileSync(wsOnly, '  \n\t\r\n  ', 'utf8');
    assert.throws(
      () =>
        validateJobOutput(
          {
            outputPath: wsOnly,
            outputName: 'result.txt',
            outputMime: 'text/plain',
          },
          wsOnly,
        ),
      /no meaningful content|text output/i,
    );

    // Same content but non-text extension must not use the text-only rule
    // (still non-empty so should pass size check)
    const asBin = path.join(testData, 'whitespace-as.bin');
    fs.writeFileSync(asBin, '  \n\t  ', 'utf8');
    const ok = validateJobOutput(
      {
        outputPath: asBin,
        outputName: 'result.bin',
        outputMime: 'application/octet-stream',
      },
      asBin,
    );
    assert.ok(ok.size > 0);

    // Meaningful text is accepted
    const good = path.join(testData, 'good.txt');
    fs.writeFileSync(good, 'hello reliability\n', 'utf8');
    const accepted = validateJobOutput(
      {
        outputPath: good,
        outputName: 'good.txt',
        outputMime: 'text/plain',
      },
      good,
    );
    assert.ok(accepted.size > 0);
  });
});

describe('nextEventVersion / emitWorkspaceEvent version monotonic', () => {
  it('versions strictly increase across nextEventVersion and emitWorkspaceEvent', () => {
    const v0 = nextEventVersion();
    const a = emitWorkspaceEvent({
      type: 'file.created',
      workspaceId: 'ws-rel-ver',
      fileId: 'f-rel-1',
      status: 'processing',
    });
    const b = emitWorkspaceEvent({
      type: 'file.updated',
      workspaceId: 'ws-rel-ver',
      fileId: 'f-rel-1',
      status: 'ready',
    });
    const v1 = nextEventVersion();

    assert.ok(a.version > v0);
    assert.ok(b.version > a.version);
    assert.ok(v1 > b.version);

    const received: { version: number }[] = [];
    const unsub = onWorkspaceEvent('ws-rel-ver-2', (ev) => received.push(ev));
    const c = emitWorkspaceEvent({
      type: 'job.updated',
      workspaceId: 'ws-rel-ver-2',
      jobId: 'j1',
      status: 'running',
    });
    const d = emitWorkspaceEvent({
      type: 'job.updated',
      workspaceId: 'ws-rel-ver-2',
      jobId: 'j1',
      status: 'completed',
    });
    unsub();
    assert.equal(received.length, 2);
    assert.ok(received[0]!.version < received[1]!.version);
    assert.ok(c.version < d.version);
  });
});

describe('cancel flags / shouldWriteProgress (shipped)', () => {
  it('shouldWriteProgress respects delta, message, force, interval', () => {
    assert.equal(PROGRESS_MIN_DELTA, 5);
    const base = {
      lastProgress: 10,
      lastMessage: 'Working',
      lastWriteAt: 1_000_000,
      now: 1_000_100,
    };
    assert.equal(shouldWriteProgress({ ...base, progress: 12 }), false);
    assert.equal(shouldWriteProgress({ ...base, progress: 15 }), true);
    assert.equal(
      shouldWriteProgress({ ...base, progress: 11, message: 'Stage B' }),
      true,
    );
    assert.equal(shouldWriteProgress({ ...base, progress: 11, force: true }), true);
  });

  it('createProgressBatcher stops writing after cancelJob sets cancel flag', () => {
    const prevMax = config.maxConcurrentJobs;
    config.maxConcurrentJobs = 0;
    let jobId: string | undefined;
    try {
      const job = createJob({
        type: 'text',
        uploadIds: [],
        options: { operation: 'hash', input: 'cancel-flag-probe', algorithm: 'sha256' },
        workspaceId: 'ws-rel-cancel',
      });
      jobId = job.id;

      const writes: number[] = [];
      const batcher = createProgressBatcher(jobId, {
        write: (p) => writes.push(p),
      });

      batcher.update(20, 'before cancel', true);
      assert.equal(writes.length, 1, 'force write before cancel');

      const cancelled = cancelJob(jobId);
      assert.ok(
        cancelled.status === 'cancelled' || cancelled.cancel_requested,
        'cancelJob should mark cancel',
      );

      batcher.update(50, 'after cancel', true);
      batcher.update(90, 'still after', true);
      batcher.flush();
      assert.equal(
        writes.length,
        1,
        'progress batcher must honor cancelFlags and skip writes after cancel',
      );
    } finally {
      config.maxConcurrentJobs = prevMax;
      if (jobId) forceCancelDb(jobId);
    }
  });
});

describe('job error path sanitizes absolute paths', () => {
  it('sanitizeUserError (shipped) redacts Windows and Unix paths', () => {
    const win = sanitizeUserError('failed at C:\\Users\\Duy\\secret\\file.pdf with error');
    assert.ok(!win.includes('Users\\Duy'));
    assert.match(win, /\[path\]/);

    const unix = sanitizeUserError('open /Users/someone/private/doc.pdf failed');
    assert.ok(!unix.includes('/Users/someone'));
    assert.match(unix, /\[path\]/);
  });

  it('runJob stores sanitized error when processor fails with absolute path', async () => {
    const uploadId = 'up-rel-path-san';
    const uploadPath = insertUpload(uploadId, 'path-san-src.png', TINY_PNG);

    const prevMax = config.maxConcurrentJobs;
    config.maxConcurrentJobs = 0;
    let jobId: string | undefined;
    try {
      // Text job reads upload file when options.input is not a string
      const job = createJob({
        type: 'text',
        uploadIds: [uploadId],
        options: { operation: 'hash', algorithm: 'sha256' },
        workspaceId: 'ws-rel-path-san',
      });
      jobId = job.id;
      assert.equal(job.status, 'queued');

      // Remove source so processor throws ENOENT including absolute path
      fs.rmSync(uploadPath, { force: true });

      config.maxConcurrentJobs = 1;
      pumpQueue();

      const failed = await waitForJobStatus(jobId, ['failed', 'cancelled']);
      assert.equal(failed.status, 'failed');
      assert.ok(failed.error, 'error message should be set');
      const err = String(failed.error);
      // Must not leak the absolute test data path
      assert.ok(
        !err.includes(testData) && !err.includes(uploadPath),
        `error must not contain absolute path; got: ${err}`,
      );
      // Windows or Unix redaction from jobs.ts catch path
      assert.ok(
        err.includes('[path]') || (!/[A-Za-z]:\\/.test(err) && !/\/(?:Users|home|tmp|var)\//.test(err)),
        `error should be sanitized; got: ${err}`,
      );
    } finally {
      config.maxConcurrentJobs = prevMax;
      if (jobId) forceCancelDb(jobId);
    }
  });
});
