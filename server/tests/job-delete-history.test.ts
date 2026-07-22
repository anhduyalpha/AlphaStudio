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
    getDb().prepare(
      `INSERT OR REPLACE INTO job_result_cache
       (cache_key, output_path, output_name, output_mime, result_json, created_at)
       VALUES (?, ?, ?, ?, '{}', ?)`,
    ).run(`delete-test-${job.id}`, row.output_path, final.outputName, final.outputMime, new Date().toISOString());

    const del = await fetch(`${base}/api/jobs/${job.id}`, { method: 'DELETE' });
    const delBody = await del.json();
    assert.equal(del.status, 200, JSON.stringify(delBody));
    assert.equal(delBody.ok, true);
    assert.equal(delBody.deletedOutput, true);
    assert.equal(delBody.cleanup.jobs, 1);
    assert.ok(delBody.cleanup.activity >= 1);
    assert.equal(delBody.cleanup.outputs, 1);
    assert.equal(delBody.cleanup.jobFiles, 2);
    assert.ok(delBody.cleanup.resultCache >= 1);

    const gone = await fetch(`${base}/api/jobs/${job.id}`);
    assert.equal(gone.status, 404);
    assert.ok(!fs.existsSync(row.output_path));

    const act = getDb()
      .prepare('SELECT COUNT(*) as c FROM activity WHERE job_id = ?')
      .get(job.id) as { c: number };
    assert.equal(act.c, 0);
    const links = getDb()
      .prepare('SELECT COUNT(*) as c FROM outputs WHERE job_id = ?')
      .get(job.id) as { c: number };
    assert.equal(links.c, 0);
    const jobFiles = getDb()
      .prepare('SELECT COUNT(*) as c FROM job_files WHERE job_id = ?')
      .get(job.id) as { c: number };
    assert.equal(jobFiles.c, 0);
    const cached = getDb()
      .prepare('SELECT COUNT(*) as c FROM job_result_cache WHERE output_path = ?')
      .get(row.output_path) as { c: number };
    assert.equal(cached.c, 0);

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
    assert.equal(del.status, 409, JSON.stringify(body));
    assert.equal(body.error?.code, 'JOB_ACTIVE');
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
    assert.equal(del.status, 409, JSON.stringify(body));
    assert.equal(body.error?.code, 'JOB_ACTIVE');
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
    assert.equal(del.status, 409, JSON.stringify(body));
    assert.equal(body.error?.code, 'OUTPUT_OWNERSHIP_INVALID');
    // Unsafe ownership metadata remains so an operator can correct and retry it.
    assert.ok(fs.existsSync(outsideFile), 'file outside outputsDir must not be deleted');
    const preserved = getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(id);
    assert.ok(preserved);

    getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('rejects output root and sibling job paths without deleting either job', async () => {
    const now = new Date().toISOString();
    const siblingId = 'owned-sibling-job';
    const siblingDir = path.join(config.outputsDir, siblingId);
    const siblingFile = path.join(siblingDir, 'keep.pdf');
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(siblingFile, '%PDF-1.4\nkeep');

    const insert = getDb().prepare(
      `INSERT INTO jobs (
        id, type, status, progress, message, input_files, options, output_path,
        output_name, output_mime, created_at, updated_at, finished_at
      ) VALUES (?, 'pdf', 'completed', 100, 'Done', '[]', '{}', ?, 'x.pdf',
        'application/pdf', ?, ?, ?)`,
    );
    insert.run(siblingId, siblingFile, now, now, now);
    insert.run('points-at-sibling-job', siblingFile, now, now, now);
    insert.run('points-at-output-root', config.outputsDir, now, now, now);

    for (const id of ['points-at-sibling-job', 'points-at-output-root']) {
      const res = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
      const body = await res.json();
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(body.error?.code, 'OUTPUT_OWNERSHIP_INVALID');
      assert.ok(getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(id));
    }
    assert.ok(fs.existsSync(siblingFile), 'sibling output must survive');

    getDb().prepare(`DELETE FROM jobs WHERE id IN (?, ?, ?)`).run(
      siblingId,
      'points-at-sibling-job',
      'points-at-output-root',
    );
    fs.rmSync(siblingDir, { recursive: true, force: true });
  });

  it('cleans metadata when an owned output is already missing', async () => {
    const id = 'missing-owned-output-job';
    const missing = path.join(config.outputsDir, id, 'gone.pdf');
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO jobs (
        id, type, status, progress, message, input_files, options, output_path,
        output_name, output_mime, created_at, updated_at, finished_at
      ) VALUES (?, 'pdf', 'failed', 100, 'Failed', '[]', '{}', ?, 'gone.pdf',
        'application/pdf', ?, ?, ?)`,
    ).run(id, missing, now, now, now);

    const res = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.deletedOutput, false);
    assert.equal(body.cleanup.jobs, 1);
    assert.equal(getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(id), undefined);

    const duplicate = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    assert.equal(duplicate.status, 404);
  });

  it('rejects a symlink or reparse-point escape from the canonical job directory', async (t) => {
    const id = 'reparse-output-job';
    const outsideDir = path.join(testData, 'reparse-outside');
    const outsideFile = path.join(outsideDir, 'keep.pdf');
    const jobRoot = path.join(config.outputsDir, id);
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(outsideFile, '%PDF-1.4\nkeep');
    try {
      fs.symlinkSync(outsideDir, jobRoot, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      fs.rmSync(outsideDir, { recursive: true, force: true });
      t.skip(`symlink/reparse creation unavailable: ${error instanceof Error ? error.message : error}`);
      return;
    }

    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO jobs (
        id, type, status, progress, message, input_files, options, output_path,
        output_name, output_mime, created_at, updated_at, finished_at
      ) VALUES (?, 'pdf', 'completed', 100, 'Done', '[]', '{}', ?, 'keep.pdf',
        'application/pdf', ?, ?, ?)`,
    ).run(id, path.join(jobRoot, 'keep.pdf'), now, now, now);

    const res = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    const body = await res.json();
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.equal(body.error?.code, 'OUTPUT_OWNERSHIP_INVALID');
    assert.ok(fs.existsSync(outsideFile), 'reparse target must survive');
    assert.ok(getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(id));

    getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
    fs.unlinkSync(jobRoot);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('preserves ownership metadata when disk cleanup fails, then succeeds on retry', async () => {
    const id = 'retryable-output-cleanup-job';
    const jobRoot = path.join(config.outputsDir, id);
    const outputPath = path.join(jobRoot, 'retry.pdf');
    fs.mkdirSync(jobRoot, { recursive: true });
    fs.writeFileSync(outputPath, '%PDF-1.4\nretry');
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO jobs (
        id, type, status, progress, message, input_files, options, output_path,
        output_name, output_mime, created_at, updated_at, finished_at
      ) VALUES (?, 'pdf', 'completed', 100, 'Done', '[]', '{}', ?, 'retry.pdf',
        'application/pdf', ?, ?, ?)`,
    ).run(id, outputPath, now, now, now);

    const originalRmSync = fs.rmSync;
    Object.defineProperty(fs, 'rmSync', {
      configurable: true,
      writable: true,
      value(target: fs.PathLike, options?: fs.RmDirOptions) {
        if (path.resolve(String(target)) === path.resolve(jobRoot)) {
          throw Object.assign(new Error('simulated access denied'), { code: 'EACCES' });
        }
        return originalRmSync(target, options as never);
      },
    });
    try {
      const failed = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
      const body = await failed.json();
      assert.equal(failed.status, 500, JSON.stringify(body));
      assert.equal(body.error?.code, 'OUTPUT_CLEANUP_FAILED');
      assert.ok(getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(id));
      assert.ok(fs.existsSync(outputPath));
    } finally {
      Object.defineProperty(fs, 'rmSync', {
        configurable: true,
        writable: true,
        value: originalRmSync,
      });
    }

    const retried = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    assert.equal(retried.status, 200, await retried.text());
    assert.equal(getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(id), undefined);
  });

  it('rejects an uploads path and preserves the source file and job row', async () => {
    const id = 'points-at-upload-job';
    const uploadPath = path.join(config.uploadsDir, 'source-must-stay.pdf');
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.writeFileSync(uploadPath, '%PDF-1.4\nsource');
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO jobs (
        id, type, status, progress, message, input_files, options, output_path,
        output_name, output_mime, created_at, updated_at, finished_at
      ) VALUES (?, 'pdf', 'completed', 100, 'Done', '[]', '{}', ?, 'source.pdf',
        'application/pdf', ?, ?, ?)`,
    ).run(id, uploadPath, now, now, now);

    const res = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    const body = await res.json();
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.equal(body.error?.code, 'OUTPUT_OWNERSHIP_INVALID');
    assert.ok(fs.existsSync(uploadPath));
    assert.ok(getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(id));

    getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
    fs.rmSync(uploadPath, { force: true });
  });

  it('deletes only the requested job and preserves unrelated job data', async () => {
    const ids = ['delete-only-this-job', 'preserve-unrelated-job'];
    const now = new Date().toISOString();
    const insertJob = getDb().prepare(
      `INSERT INTO jobs (
        id, type, status, progress, message, input_files, options, output_path,
        output_name, output_mime, created_at, updated_at, finished_at
      ) VALUES (?, 'pdf', 'completed', 100, 'Done', '[]', '{}', ?, ?,
        'application/pdf', ?, ?, ?)`,
    );
    for (const id of ids) {
      const dir = path.join(config.outputsDir, id);
      const outputPath = path.join(dir, `${id}.pdf`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, '%PDF-1.4\nowned');
      insertJob.run(id, outputPath, `${id}.pdf`, now, now, now);
      getDb().prepare(
        `INSERT INTO outputs (id, workspace_id, job_id, name, mime, path, size, created_at)
         VALUES (?, NULL, ?, ?, 'application/pdf', ?, 15, ?)`,
      ).run(`output-${id}`, id, `${id}.pdf`, outputPath, now);
      getDb().prepare(
        `INSERT INTO activity (id, job_id, tool, action, status, detail, created_at)
         VALUES (?, ?, 'pdf', 'pdf:test', 'completed', ?, ?)`,
      ).run(`activity-${id}`, id, id, now);
      getDb().prepare(
        `INSERT INTO job_result_cache
         (cache_key, output_path, output_name, output_mime, result_json, created_at)
         VALUES (?, ?, ?, 'application/pdf', '{}', ?)`,
      ).run(`cache-${id}`, outputPath, `${id}.pdf`, now);
    }

    const res = await fetch(`${base}/api/jobs/${ids[0]}`, { method: 'DELETE' });
    assert.equal(res.status, 200, await res.text());
    const other = ids[1];
    assert.ok(getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(other));
    assert.ok(getDb().prepare('SELECT id FROM outputs WHERE job_id = ?').get(other));
    assert.ok(getDb().prepare('SELECT id FROM activity WHERE job_id = ?').get(other));
    assert.ok(getDb().prepare('SELECT cache_key FROM job_result_cache WHERE cache_key = ?').get(`cache-${other}`));
    assert.ok(fs.existsSync(path.join(config.outputsDir, other, `${other}.pdf`)));

    const cleanup = await fetch(`${base}/api/jobs/${other}`, { method: 'DELETE' });
    assert.equal(cleanup.status, 200, await cleanup.text());
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
