import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
// Unique per process so parallel suite isolation cannot race-rm shared dirs
const testData = path.join(root, `data-test-workspace-${process.pid}`);
const testPort = 8795 + (process.pid % 100);

process.env.PORT = String(testPort);
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'ws.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'error';
process.env.WORKSPACE_RETENTION_MS = String(7 * 24 * 3600 * 1000);

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb, getDb, resumeQueuedJobs } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');
const { cleanupExpiredFiles } = await import('../src/workers/jobs.js');
const { config } = await import('../src/config.js');

let app: Awaited<ReturnType<typeof buildApp>>;
const base = `http://127.0.0.1:${testPort}`;

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  app = await buildApp();
  await app.listen({ port: testPort, host: '127.0.0.1' });
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

async function uploadPng(workspaceId?: string) {
  ensureDataDirs();
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 9, g: 8, b: 7 } },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'persist.png');
  const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  const res = await fetch(`${base}/api/uploads${qs}`, { method: 'POST', body: form });
  const data = await res.json();
  assert.equal(res.status, 201, `upload failed: ${JSON.stringify(data)}`);
  return { res, data, png };
}

describe('schema migrations', () => {
  it('has workspaces, files, jobs, job_files, tool_settings, outputs', () => {
    const db = getDb();
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    ).map((t) => t.name);
    for (const t of [
      'workspaces',
      'files',
      'jobs',
      'job_files',
      'tool_settings',
      'outputs',
      'schema_migrations',
    ]) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
    const fks = db.prepare(`PRAGMA foreign_key_list(files)`).all() as unknown[];
    assert.ok(fks.length > 0, 'files should have FK to workspaces');
  });
});

describe('upload persist + hydrate', () => {
  it('upload writes disk + DB checksum; hydrate has no raw path; survives restart shape', async () => {
    const ws = await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'converter' }),
      })
    ).json();
    assert.ok(ws.id);

    const { res, data } = await uploadPng(ws.id);
    assert.equal(res.status, 201, JSON.stringify(data));
    assert.ok(data.id);
    // Fast path: quick detect + fingerprint immediately; full checksum may finalize async
    assert.ok(data.detect || data.fingerprint != null || data.checksum);
    assert.ok(data.downloadUrl);
    assert.ok(!('path' in data), 'must not expose path');
    assert.ok(!JSON.stringify(data).includes(testData.replace(/\\/g, '\\\\')));

    // Wait briefly for async finalize if needed
    let row = getDb().prepare('SELECT path, checksum, status FROM files WHERE id = ?').get(data.id) as {
      path: string;
      checksum: string | null;
      status: string;
    };
    for (let i = 0; i < 40 && (!row.checksum || row.status !== 'ready'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      row = getDb().prepare('SELECT path, checksum, status FROM files WHERE id = ?').get(data.id) as {
        path: string;
        checksum: string | null;
        status: string;
      };
    }
    assert.ok(fs.existsSync(row.path));
    assert.ok(row.checksum, 'full checksum after finalize');
    assert.equal(row.status, 'ready');

    // hydrate
    const hyd = await (await fetch(`${base}/api/workspaces/${ws.id}`)).json();
    assert.equal(hyd.id, ws.id);
    assert.ok(hyd.files.some((f: { id: string }) => f.id === data.id));
    // no raw filesystem path field on public file DTOs
    for (const f of hyd.files) {
      assert.equal(Object.prototype.hasOwnProperty.call(f, 'path'), false);
      assert.ok(f.downloadUrl?.startsWith('/api/files/'));
      assert.ok(!String(f.downloadUrl).includes(testData));
    }

    // download still works
    const dl = await fetch(`${base}/api/files/${data.id}/download`);
    assert.equal(dl.status, 200);
    const body = Buffer.from(await dl.arrayBuffer());
    assert.ok(body.length > 20);
  });

  it('settings-without-convert persist via patch', async () => {
    const ws = await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'converter' }),
      })
    ).json();
    const { data: file } = await uploadPng(ws.id);

    const patched = await (
      await fetch(`${base}/api/workspaces/${ws.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route: 'converter',
          selectedFileIds: [file.id],
          toolSettings: {
            converter: { format: 'webp', quality: 'max', preserveMetadata: false },
          },
          ui: { panel: 'export' },
        }),
      })
    ).json();

    assert.equal(patched.toolSettings.converter.format, 'webp');
    assert.equal(patched.toolSettings.converter.quality, 'max');
    assert.equal(patched.toolSettings.converter.preserveMetadata, false);
    assert.deepEqual(patched.selectedFileIds, [file.id]);
    assert.equal(patched.ui.panel, 'export');

    // re-read
    const again = await (await fetch(`${base}/api/workspaces/${ws.id}`)).json();
    assert.equal(again.toolSettings.converter.format, 'webp');
    assert.equal(again.files.length, 1);
  });

  it('remove file and clear workspace', async () => {
    const ws = await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'converter' }),
      })
    ).json();
    const { data: file } = await uploadPng(ws.id);
    await fetch(`${base}/api/workspaces/${ws.id}/files/${file.id}`, { method: 'DELETE' });
    let hyd = await (await fetch(`${base}/api/workspaces/${ws.id}`)).json();
    assert.equal(hyd.files.length, 0);

    const { data: f2 } = await uploadPng(ws.id);
    assert.ok(f2.id);
    await fetch(`${base}/api/workspaces/${ws.id}/clear`, { method: 'POST' });
    hyd = await (await fetch(`${base}/api/workspaces/${ws.id}`)).json();
    assert.equal(hyd.files.length, 0);
    assert.deepEqual(hyd.toolSettings, {});
  });
});

describe('job recovery policy', () => {
  it('running jobs become failed via real initDb; queued remain + resumeQueuedJobs pumps', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO jobs (id, type, status, progress, message, input_files, options, created_at, updated_at, started_at)
       VALUES ('job-run', 'text', 'running', 50, 'mid', '[]', '{}', ?, ?, ?)`,
    ).run(now, now, now);
    db.prepare(
      `INSERT INTO jobs (id, type, status, progress, message, input_files, options, created_at, updated_at)
       VALUES ('job-q', 'text', 'queued', 0, 'Queued', '[]', '{}', ?, ?)`,
    ).run(now, now);

    // Real restart path: close handle and re-open via initDb recovery (not inlined SQL)
    closeDb();
    ensureDataDirs();
    initDb();

    const run = getDb().prepare(`SELECT status, error, message FROM jobs WHERE id = 'job-run'`).get() as {
      status: string;
      error: string | null;
      message: string | null;
    };
    const q = getDb().prepare(`SELECT status FROM jobs WHERE id = 'job-q'`).get() as { status: string };
    assert.equal(run.status, 'failed');
    assert.match(String(run.error || ''), /restart/i);
    assert.match(String(run.message || ''), /interrupt/i);
    assert.equal(q.status, 'queued');

    let pumps = 0;
    resumeQueuedJobs(() => {
      pumps += 1;
    });
    assert.equal(pumps, 1, 'resumeQueuedJobs must pump when queued jobs exist');
  });

  it('cleanupExpiredFiles must not delete workspace files before retention', async () => {
    const ws = await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'converter' }),
      })
    ).json();
    const { data } = await uploadPng(ws.id);
    const row = getDb().prepare('SELECT path FROM files WHERE id = ?').get(data.id) as { path: string };
    assert.ok(fs.existsSync(row.path));

    // Age the binary past TEMP_TTL so a naive mtime cleaner would remove it
    const old = new Date(Date.now() - config.tempTtlMs - 60_000);
    fs.utimesSync(row.path, old, old);

    cleanupExpiredFiles();

    assert.ok(fs.existsSync(row.path), 'workspace upload must survive TEMP_TTL cleanup');
    const hyd = await (await fetch(`${base}/api/workspaces/${ws.id}`)).json();
    const f = hyd.files.find((x: { id: string }) => x.id === data.id);
    assert.ok(f, 'hydrate still lists file');
    assert.notEqual(f.status, 'missing');
    const dl = await fetch(`${base}/api/files/${data.id}/download`);
    assert.equal(dl.status, 200);
  });

  it('nested job output under outputs/<jobId>/ survives TEMP_TTL cleanup + /api/outputs download', async () => {
    const ws = await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'converter' }),
      })
    ).json();
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('nested output ttl')], { type: 'text/plain' }), 'nested.txt');
    const up = await (
      await fetch(`${base}/api/uploads?workspaceId=${ws.id}`, { method: 'POST', body: form })
    ).json();

    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'converter',
        uploadIds: [up.id],
        workspaceId: ws.id,
        options: { format: 'pdf' },
      }),
    });
    assert.equal(create.status, 201);
    const job = await create.json();

    let final = job;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 80));
      final = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
      if (['completed', 'failed', 'cancelled'].includes(final.status)) break;
    }
    assert.equal(final.status, 'completed', final.error);

    // Real shipped layout: outputs live under outputs/<jobId>/…
    const outRow = getDb()
      .prepare(`SELECT id, path FROM outputs WHERE job_id = ?`)
      .get(job.id) as { id: string; path: string };
    assert.ok(outRow?.path, 'outputs row must exist');
    assert.ok(
      outRow.path.includes(path.join('outputs', job.id)) ||
        outRow.path.replace(/\\/g, '/').includes(`outputs/${job.id}`),
      `expected nested path under outputs/${job.id}, got ${outRow.path}`,
    );
    assert.ok(fs.existsSync(outRow.path), 'nested output file on disk');

    const jobOutDir = path.join(config.outputsDir, job.id);
    assert.ok(fs.existsSync(jobOutDir), 'job output directory exists');

    // Age both the leaf and the job directory past TEMP_TTL (the bug: top-level
    // dir name is not in protectedPaths, so recursive rm wiped nested leaves).
    const old = new Date(Date.now() - config.tempTtlMs - 60_000);
    fs.utimesSync(outRow.path, old, old);
    fs.utimesSync(jobOutDir, old, old);

    cleanupExpiredFiles();

    assert.ok(fs.existsSync(outRow.path), 'nested job output must survive TEMP_TTL cleanup');
    assert.ok(fs.existsSync(jobOutDir), 'job output dir must not be recursive-rm\'d');

    const hyd = await (await fetch(`${base}/api/workspaces/${ws.id}`)).json();
    const out = hyd.outputs?.find((o: { id: string }) => o.id === outRow.id);
    assert.ok(out, 'hydrate still lists output');
    assert.ok(out.downloadUrl?.startsWith('/api/outputs/'));

    const dl = await fetch(`${base}${out.downloadUrl}`);
    assert.equal(dl.status, 200, 'download via secure output id must work after cleanup');
    const body = Buffer.from(await dl.arrayBuffer());
    assert.ok(body.length > 0);

    // job download path also still works
    const jdl = await fetch(`${base}/api/jobs/${job.id}/download`);
    assert.equal(jdl.status, 200);
  });

  it('job with workspace completes and appears in hydrate', async () => {
    const ws = await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'converter' }),
      })
    ).json();
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('hello workspace')], { type: 'text/plain' }), 'a.txt');
    const up = await (
      await fetch(`${base}/api/uploads?workspaceId=${ws.id}`, { method: 'POST', body: form })
    ).json();

    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'converter',
        uploadIds: [up.id],
        workspaceId: ws.id,
        options: { format: 'pdf' },
      }),
    });
    assert.equal(create.status, 201);
    const job = await create.json();
    assert.equal(job.workspaceId, ws.id);

    let final = job;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 80));
      final = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
      if (['completed', 'failed', 'cancelled'].includes(final.status)) break;
    }
    assert.equal(final.status, 'completed', final.error);

    const hyd = await (await fetch(`${base}/api/workspaces/${ws.id}`)).json();
    const hydJob = hyd.jobs.find((j: { id: string; status: string }) => j.id === job.id && j.status === 'completed');
    assert.ok(hydJob, 'completed job appears in hydrate');
    assert.ok(hyd.outputs?.length >= 1);
    assert.ok(hyd.outputs[0].downloadUrl.startsWith('/api/outputs/'));

    // Converted Files source column: hydrate must expose input ids + original names (no paths)
    const opts = hydJob.options || {};
    assert.ok(Array.isArray(opts._uploadIds), 'options._uploadIds from job_files / createJob');
    assert.ok(opts._uploadIds.includes(up.id), '_uploadIds includes input file id');
    assert.ok(Array.isArray(opts.inputFileNames), 'options.inputFileNames from files.original_name');
    assert.ok(opts.inputFileNames.includes('a.txt'), `inputFileNames has original name, got ${JSON.stringify(opts.inputFileNames)}`);
    const hydJson = JSON.stringify(hydJob);
    assert.ok(!hydJson.includes(testData), 'hydrate job must not expose filesystem data dir paths');
    assert.ok(!('path' in opts), 'options must not include path');
  });
});

describe('outputs download-zip', () => {
  function seedOutput(
    workspaceId: string,
    opts: { name: string; content: string | Buffer; jobId?: string | null },
  ) {
    const id = `out-${Math.random().toString(16).slice(2, 10)}`;
    const dir = path.join(config.outputsDir, `zip-test-${id}`);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, opts.name);
    const buf = Buffer.isBuffer(opts.content) ? opts.content : Buffer.from(opts.content);
    fs.writeFileSync(filePath, buf);
    const t = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO outputs (id, workspace_id, job_id, name, mime, path, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, workspaceId, opts.jobId ?? null, opts.name, 'application/octet-stream', filePath, buf.length, t);
    return { id, path: filePath, size: buf.length };
  }

  it('POST download-zip returns 200 and ZIP magic for seeded outputs', async () => {
    const ws = await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'converter' }),
      })
    ).json();
    assert.ok(ws.id);

    const a = seedOutput(ws.id, { name: 'one.txt', content: 'alpha-one' });
    const b = seedOutput(ws.id, { name: 'two.bin', content: Buffer.from([1, 2, 3, 4, 5]) });

    const res = await fetch(`${base}/api/workspaces/${ws.id}/outputs/download-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    assert.ok(
      String(res.headers.get('content-type') || '').includes('application/zip') ||
        String(res.headers.get('content-type') || '').includes('application/octet-stream'),
    );
    const cd = res.headers.get('content-disposition') || '';
    assert.ok(cd.includes('alphastudio-outputs.zip'));

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 4);
    // ZIP local file header magic PK\x03\x04
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
    assert.equal(buf[2], 0x03);
    assert.equal(buf[3], 0x04);

    // Filter by outputIds still works
    const resOne = await fetch(`${base}/api/workspaces/${ws.id}/outputs/download-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputIds: [a.id] }),
    });
    assert.equal(resOne.status, 200, `expected 200, got ${resOne.status}`);
    const oneBuf = Buffer.from(await resOne.arrayBuffer());
    assert.equal(oneBuf[0], 0x50);
    assert.equal(oneBuf[1], 0x4b);
    assert.ok(oneBuf.length < buf.length || b.size > 0);
  });

  it('empty selection with no on-disk outputs returns 400', async () => {
    const ws = await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'converter' }),
      })
    ).json();

    const res = await fetch(`${base}/api/workspaces/${ws.id}/outputs/download-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body?.error?.message);

    // Missing files on disk also yield 400 even if rows exist
    const ghostId = `out-ghost-${Math.random().toString(16).slice(2, 8)}`;
    getDb()
      .prepare(
        `INSERT INTO outputs (id, workspace_id, job_id, name, mime, path, size, created_at)
         VALUES (?, ?, NULL, 'ghost.txt', 'text/plain', ?, 10, ?)`,
      )
      .run(ghostId, ws.id, path.join(config.outputsDir, 'does-not-exist-ever.txt'), new Date().toISOString());

    const res2 = await fetch(`${base}/api/workspaces/${ws.id}/outputs/download-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputIds: [ghostId] }),
    });
    assert.equal(res2.status, 400);
  });
});
