/**
 * Per-job history deletion: terminal jobs only, trusted output cleanup, activity cleanup.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test-job-delete');

process.env.PORT = '8809';
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'test.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.MAX_UPLOAD_BYTES = String(8 * 1024 * 1024);
process.env.LOG_LEVEL = 'error';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');
const { startWorkerPool, stopWorkerPool } = await import('../src/workers/jobs.js');
const { config } = await import('../src/config.js');

let app: Awaited<ReturnType<typeof buildApp>>;
const base = 'http://127.0.0.1:8809';

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  app = await buildApp();
  await app.listen({ port: 8809, host: '127.0.0.1' });
  startWorkerPool();
});

after(async () => {
  try {
    await stopWorkerPool();
  } catch {
    /* ignore */
  }
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
  await new Promise((r) => setTimeout(r, 150));
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function makePdf(label = 'Del'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 200]);
  page.drawText(label, { x: 30, y: 100, size: 16, font });
  return Buffer.from(await doc.save());
}

async function uploadPdf(buf: Buffer, name = 'abc.pdf') {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], { type: 'application/pdf' }), name);
  const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
  const data = await res.json();
  assert.equal(res.status, 201, JSON.stringify(data));
  return data as { id: string };
}

async function waitJob(id: string, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${base}/api/jobs/${id}`);
    const job = await res.json();
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('Job timeout');
}

describe('job history deletion', () => {
  it('deletes completed job, activity, and output file; stays gone after GET', async () => {
    const a = await uploadPdf(await makePdf('A'), 'abc.pdf');
    const b = await uploadPdf(await makePdf('B'), 'xyz.pdf');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pdf',
        uploadIds: [a.id, b.id],
        options: { operation: 'merge' },
      }),
    });
    const job = await create.json();
    assert.equal(create.status, 201, JSON.stringify(job));
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
    assert.equal(final.outputName, 'abc-merged.pdf');
    assert.ok(final.downloadUrl);

    const row = getDb().prepare('SELECT output_path FROM jobs WHERE id = ?').get(job.id) as {
      output_path: string;
    };
    assert.ok(row?.output_path);
    assert.ok(fs.existsSync(row.output_path));
    assert.ok(row.output_path.includes(config.outputsDir) || path.resolve(row.output_path).startsWith(path.resolve(config.outputsDir)));

    const del = await fetch(`${base}/api/jobs/${job.id}`, { method: 'DELETE' });
    const delBody = await del.json();
    assert.equal(del.status, 200, JSON.stringify(delBody));
    assert.equal(delBody.ok, true);
    assert.equal(delBody.deletedOutput, true);

    const gone = await fetch(`${base}/api/jobs/${job.id}`);
    assert.equal(gone.status, 404);
    assert.ok(!fs.existsSync(row.output_path));

    const act = getDb()
      .prepare('SELECT COUNT(*) as c FROM activity WHERE job_id = ?')
      .get(job.id) as { c: number };
    assert.equal(act.c, 0);

    // Source uploads remain
    const up = await fetch(`${base}/api/uploads/${a.id}`);
    assert.equal(up.status, 200);
  });

  it('rejects deleting unknown job', async () => {
    const miss = await fetch(`${base}/api/jobs/does-not-exist-id`, { method: 'DELETE' });
    assert.equal(miss.status, 404);
  });

  it('deterministically rejects deleting a queued (active) job', async () => {
    // Insert a queued row directly — no race with worker completion
    const id = 'active-queued-job-for-delete-test';
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO jobs (
          id, type, status, progress, message, error, input_files, options,
          output_path, output_name, output_mime, result_json,
          created_at, updated_at, started_at, finished_at, cancel_requested
        ) VALUES (?, 'pdf', 'queued', 0, 'Queued', NULL, '[]', '{}',
          NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, 0)`,
      )
      .run(id, now, now);

    const del = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    const body = await del.json();
    assert.equal(del.status, 400, JSON.stringify(body));
    assert.match(String(body.error?.message || body.message || JSON.stringify(body)), /active|Cancel/i);

    // Still present
    const still = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(id) as { status: string };
    assert.equal(still.status, 'queued');

    // Cleanup test row
    getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
  });

  it('deterministically rejects deleting a running (active) job', async () => {
    const id = 'active-running-job-for-delete-test';
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO jobs (
          id, type, status, progress, message, error, input_files, options,
          output_path, output_name, output_mime, result_json,
          created_at, updated_at, started_at, finished_at, cancel_requested
        ) VALUES (?, 'pdf', 'running', 10, 'Running', NULL, '[]', '{}',
          NULL, NULL, NULL, NULL, ?, ?, ?, NULL, 0)`,
      )
      .run(id, now, now, now);

    const del = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    const body = await del.json();
    assert.equal(del.status, 400, JSON.stringify(body));
    assert.match(String(body.error?.message || body.message || JSON.stringify(body)), /active|Cancel/i);

    getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
  });

  it('refuses to delete files outside outputsDir (path safety)', async () => {
    // Plant a sentinel file OUTSIDE the configured outputs directory
    const outsideDir = path.join(testData, 'outside-trusted');
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, 'must-not-delete.txt');
    fs.writeFileSync(outsideFile, 'sentinel-keep-me');

    const id = 'path-safety-job-delete-test';
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO jobs (
          id, type, status, progress, message, error, input_files, options,
          output_path, output_name, output_mime, result_json,
          created_at, updated_at, started_at, finished_at, cancel_requested
        ) VALUES (?, 'pdf', 'completed', 100, 'Done', NULL, '[]', '{}',
          ?, 'evil.pdf', 'application/pdf', NULL, ?, ?, ?, ?, 0)`,
      )
      .run(id, outsideFile, now, now, now, now);

    // Confirm outside outputsDir
    const resolvedOut = path.resolve(config.outputsDir);
    const resolvedEvil = path.resolve(outsideFile);
    assert.ok(
      !resolvedEvil.startsWith(resolvedOut + path.sep) && resolvedEvil !== resolvedOut,
      'test setup: file must be outside outputsDir',
    );

    const del = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    const body = await del.json();
    assert.equal(del.status, 200, JSON.stringify(body));
    // Job row removed, but outside file must survive (no path traversal / unsafe delete)
    assert.equal(body.deletedOutput, false);
    assert.ok(fs.existsSync(outsideFile), 'file outside outputsDir must not be deleted');
    const gone = getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(id);
    assert.equal(gone, undefined);

    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('activity DELETE withJob removes job history entry', async () => {
    const up = await uploadPdf(await makePdf('Act'), 'act.pdf');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pdf',
        uploadIds: [up.id],
        options: { operation: 'inspect' },
      }),
    });
    const job = await create.json();
    await waitJob(job.id);

    const actList = await (await fetch(`${base}/api/activity?limit=20`)).json();
    const row = (actList.activity || []).find((r: { jobId?: string }) => r.jobId === job.id);
    assert.ok(row, 'activity row for job');

    const del = await fetch(`${base}/api/activity/${row.id}?withJob=1`, { method: 'DELETE' });
    const body = await del.json();
    assert.equal(del.status, 200, JSON.stringify(body));
    assert.equal(body.deletedJob, true);

    const gone = await fetch(`${base}/api/jobs/${job.id}`);
    assert.equal(gone.status, 404);
  });
});
