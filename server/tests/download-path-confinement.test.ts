/**
 * S-01 / S-02: download & preview path re-confinement + active content disposition.
 * Drives real shipped routes with a poisoned DB path and HTML/SVG preview.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test-path-confine');
const PORT = 8827;

process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'confine.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'error';
process.env.MAX_CONCURRENT_JOBS = '1';

const { ensureDataDirs, assertDownloadablePath, isActivePreviewContent, isPathInside } =
  await import('../src/lib/paths.js');
const { config } = await import('../src/config.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');

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

describe('assertDownloadablePath unit', () => {
  it('allows paths under uploads/outputs/temp', () => {
    assert.doesNotThrow(() =>
      assertDownloadablePath(path.join(config.uploadsDir, 'a.bin')),
    );
    assert.doesNotThrow(() =>
      assertDownloadablePath(path.join(config.outputsDir, 'job1', 'out.pdf')),
    );
    assert.doesNotThrow(() =>
      assertDownloadablePath(path.join(config.tempDir, 'x.tmp')),
    );
  });

  it('rejects paths outside data roots', () => {
    assert.throws(() => assertDownloadablePath(path.join(root, 'package.json')), /traversal/i);
    assert.throws(() => assertDownloadablePath('C:\\Windows\\System32\\drivers\\etc\\hosts'), /traversal/i);
  });

  it('isPathInside rejects parent escape', () => {
    assert.equal(isPathInside(config.uploadsDir, path.join(config.uploadsDir, '..', 'secret')), false);
  });

  it('detects active preview content', () => {
    assert.equal(isActivePreviewContent('x.html', 'text/html'), true);
    assert.equal(isActivePreviewContent('icon.svg', 'image/svg+xml'), true);
    assert.equal(isActivePreviewContent('photo.png', 'image/png'), false);
  });
});

describe('S-01 job download rejects poisoned path', () => {
  it('does not stream files outside outputs/uploads', async () => {
    const outside = path.join(root, 'package.json');
    assert.ok(fs.existsSync(outside));

    const db = getDb();
    const now = new Date().toISOString();
    const id = 'poison-dl-job';
    db.prepare(
      `INSERT INTO jobs (id, type, status, progress, message, input_files, options,
        output_path, output_name, output_mime, created_at, updated_at, finished_at)
       VALUES (?, 'text', 'completed', 100, 'done', '[]', '{}', ?, 'package.json',
        'application/json', ?, ?, ?)`,
    ).run(id, outside, now, now, now);

    const res = await fetch(`${base}/api/jobs/${id}/download`);
    assert.notEqual(res.status, 200, 'must not stream poisoned path');
    assert.ok(res.status === 400 || res.status === 404, `status ${res.status}`);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.match(String(body.error?.message || ''), /traversal|not found|Path/i);
  });
});

function ensureTestWorkspace(db: ReturnType<typeof getDb>, id = 'ws-confine'): string {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, route, status, created_at, updated_at, last_seen_at)
     VALUES (?, 'dashboard', 'active', ?, ?, ?)`,
  ).run(id, now, now, now);
  return id;
}

describe('S-01 file download rejects poisoned path', () => {
  it('blocks /api/files/:id/download escape', async () => {
    const outside = path.join(root, 'package.json');
    const db = getDb();
    const now = new Date().toISOString();
    const ws = ensureTestWorkspace(db);
    const id = 'poison-file';
    db.prepare(
      `INSERT INTO files (id, workspace_id, original_name, stored_name, path, mime, size, status, created_at, updated_at)
       VALUES (?, ?, 'pkg.json', 'pkg.json', ?, 'application/json', 100, 'ready', ?, ?)`,
    ).run(id, ws, outside, now, now);

    const res = await fetch(`${base}/api/files/${id}/download`);
    assert.notEqual(res.status, 200);
    assert.ok(res.status === 400 || res.status === 404);
  });

  it('blocks /api/outputs/:id/download escape', async () => {
    const outside = path.join(root, 'package.json');
    const db = getDb();
    const now = new Date().toISOString();
    const id = 'poison-out';
    db.prepare(
      `INSERT INTO outputs (id, job_id, name, path, mime, size, created_at)
       VALUES (?, NULL, 'pkg.json', ?, 'application/json', 100, ?)`,
    ).run(id, outside, now);

    const res = await fetch(`${base}/api/outputs/${id}/download`);
    assert.notEqual(res.status, 200);
    assert.ok(res.status === 400 || res.status === 404);
  });
});

describe('S-02 active preview is not inline HTML/SVG', () => {
  it('serves HTML as attachment + nosniff + CSP sandbox', async () => {
    const uploadsDir = config.uploadsDir;
    fs.mkdirSync(uploadsDir, { recursive: true });
    const stored = path.join(uploadsDir, 'evil.html');
    fs.writeFileSync(stored, '<html><script>alert(1)</script></html>', 'utf8');

    const db = getDb();
    const now = new Date().toISOString();
    const ws = ensureTestWorkspace(db);
    const id = 'html-preview';
    db.prepare(
      `INSERT INTO files (id, workspace_id, original_name, stored_name, path, mime, size, status, created_at, updated_at)
       VALUES (?, ?, 'evil.html', 'evil.html', ?, 'text/html', ?, 'ready', ?, ?)`,
    ).run(id, ws, stored, fs.statSync(stored).size, now, now);

    const res = await fetch(`${base}/api/files/${id}/preview`);
    assert.equal(res.status, 200);
    const cd = res.headers.get('content-disposition') || '';
    assert.match(cd, /attachment/i);
    assert.match(res.headers.get('content-type') || '', /octet-stream/i);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy') || '', /sandbox/i);
  });

  it('allows image preview with image content-type', async () => {
    const uploadsDir = config.uploadsDir;
    // Minimal 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const stored = path.join(uploadsDir, 'dot.png');
    fs.writeFileSync(stored, png);

    const db = getDb();
    const now = new Date().toISOString();
    const ws = ensureTestWorkspace(db);
    const id = 'png-preview';
    db.prepare(
      `INSERT INTO files (id, workspace_id, original_name, stored_name, path, mime, size, status, created_at, updated_at)
       VALUES (?, ?, 'dot.png', 'dot.png', ?, 'image/png', ?, 'ready', ?, ?)`,
    ).run(id, ws, stored, png.length, now, now);

    const res = await fetch(`${base}/api/files/${id}/preview`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /image\/png/i);
    const cd = res.headers.get('content-disposition') || '';
    assert.ok(!/attachment/i.test(cd), 'images may inline');
  });
});

describe('legitimate job download still works', () => {
  it('streams completed job output under outputsDir', async () => {
    const jobId = 'legit-job';
    const outDir = path.join(config.outputsDir, jobId);
    fs.mkdirSync(outDir, { recursive: true });
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const outPath = path.join(outDir, 'out.pdf');
    fs.writeFileSync(outPath, bytes);

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO jobs (id, type, status, progress, message, input_files, options,
        output_path, output_name, output_mime, created_at, updated_at, finished_at)
       VALUES (?, 'pdf', 'completed', 100, 'done', '[]', '{}', ?, 'out.pdf',
        'application/pdf', ?, ?, ?)`,
    ).run(jobId, outPath, now, now, now);

    const res = await fetch(`${base}/api/jobs/${jobId}/download`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /pdf/i);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 50);
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  });
});
