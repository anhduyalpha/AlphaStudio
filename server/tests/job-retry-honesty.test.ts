/**
 * F-B01 / F-B02: same-row retry + password vault honesty after restart.
 * Drives shipped retryJob / POST /api/jobs/:id/retry.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test-job-retry');
const PORT = 8828;

process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'retry.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'error';
process.env.MAX_CONCURRENT_JOBS = '1';
process.env.MAX_JOB_ATTEMPTS = '3';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');
const {
  retryJob,
  hasVaultedPassword,
  clearJobPassword,
} = await import('../src/workers/jobs.js');

let app: Awaited<ReturnType<typeof buildApp>>;
const base = `http://127.0.0.1:${PORT}`;

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  app = await buildApp();
  await app.listen({ port: PORT, host: '127.0.0.1' });
});

after(async () => {
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 80));
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function insertFailedJob(opts: {
  id: string;
  retryable?: number;
  attempt_count?: number;
  max_attempts?: number;
  optionsJson?: string;
  type?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO jobs (id, type, status, progress, message, input_files, options,
      error, error_code, retryable, attempt_count, max_attempts, created_at, updated_at, finished_at)
     VALUES (?, ?, 'failed', 0, 'failed', '[]', ?, 'boom', 'WORKER_CRASH', ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.type || 'text',
    opts.optionsJson || '{}',
    opts.retryable ?? 1,
    opts.attempt_count ?? 1,
    opts.max_attempts ?? 3,
    now,
    now,
    now,
  );
}

describe('retryJob same-row requeue', () => {
  it('requeues failed retryable job without password', () => {
    insertFailedJob({ id: 'retry-plain', optionsJson: JSON.stringify({ operation: 'format-json' }) });
    const row = retryJob('retry-plain');
    assert.equal(row.status, 'queued');
    assert.equal(Number(row.retryable), 0);
    assert.equal(row.message, 'Queued for retry');
  });

  it('refuses non-retryable failed job', () => {
    insertFailedJob({ id: 'retry-no', retryable: 0 });
    assert.throws(() => retryJob('retry-no'), /not retryable/i);
  });

  it('refuses password-bearing job when vault empty (restart case)', () => {
    insertFailedJob({
      id: 'retry-pw',
      type: 'pdf',
      optionsJson: JSON.stringify({ operation: 'merge', passwordProvided: true }),
    });
    clearJobPassword('retry-pw');
    assert.equal(hasVaultedPassword('retry-pw'), false);
    try {
      retryJob('retry-pw');
      assert.fail('expected PASSWORD_REQUIRED');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      assert.equal(e.code, 'PASSWORD_REQUIRED');
      assert.match(String(e.message), /password/i);
    }
  });

  it('accepts password re-supply and requeues', () => {
    insertFailedJob({
      id: 'retry-pw2',
      type: 'pdf',
      optionsJson: JSON.stringify({ operation: 'merge', passwordProvided: true }),
    });
    clearJobPassword('retry-pw2');
    const row = retryJob('retry-pw2', { password: 'secret-xyz' });
    assert.equal(row.status, 'queued');
    assert.equal(hasVaultedPassword('retry-pw2'), true);
  });
});

describe('POST /api/jobs/:id/retry HTTP', () => {
  it('returns 400 PASSWORD_REQUIRED without body password', async () => {
    insertFailedJob({
      id: 'http-pw',
      type: 'pdf',
      optionsJson: JSON.stringify({ operation: 'extract', passwordProvided: true }),
    });
    clearJobPassword('http-pw');
    const res = await fetch(`${base}/api/jobs/http-pw/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'PASSWORD_REQUIRED');
  });

  it('requeues when password provided', async () => {
    insertFailedJob({
      id: 'http-pw-ok',
      type: 'pdf',
      optionsJson: JSON.stringify({ operation: 'extract', passwordProvided: true }),
    });
    clearJobPassword('http-pw-ok');
    const res = await fetch(`${base}/api/jobs/http-pw-ok/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'abc' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status?: string; id?: string };
    assert.equal(body.status, 'queued');
    assert.equal(body.id, 'http-pw-ok');
  });
});
