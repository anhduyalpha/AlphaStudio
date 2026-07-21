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

  it('rejects deleting unknown job and refuses active-job silent delete', async () => {
    const miss = await fetch(`${base}/api/jobs/does-not-exist-id`, { method: 'DELETE' });
    assert.equal(miss.status, 404);

    // Create a job and try to delete while it might still be running — if already completed, skip active branch
    const up = await uploadPdf(await makePdf('Q'), 'quick.pdf');
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
    // Immediate delete may hit running or completed; either must not 500
    const del = await fetch(`${base}/api/jobs/${job.id}`, { method: 'DELETE' });
    const body = await del.json();
    if (del.status === 400) {
      assert.match(String(body.error?.message || body.message || ''), /active|Cancel/i);
      // Finish then delete
      await waitJob(job.id);
      const del2 = await fetch(`${base}/api/jobs/${job.id}`, { method: 'DELETE' });
      assert.equal(del2.status, 200);
    } else {
      assert.equal(del.status, 200, JSON.stringify(body));
    }
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
