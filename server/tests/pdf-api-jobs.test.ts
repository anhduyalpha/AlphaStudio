/**
 * API job pipeline for type=pdf: create, poll, SSE, cancel, download, resume, capabilities.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test-pdf-api');

process.env.PORT = '8801';
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

let app: Awaited<ReturnType<typeof buildApp>>;
const base = 'http://127.0.0.1:8801';

const REQUIRED_CAPS = [
  'pdf.merge',
  'pdf.split',
  'pdf.rotate',
  'pdf.reorder',
  'pdf.extract',
  'pdf.delete-pages',
  'pdf.duplicate-pages',
  'pdf.from-images',
  'pdf.to-images',
  'pdf.to-text',
  'pdf.ocr',
  'pdf.compress.structural',
  'pdf.compress.advanced',
  'pdf.inspect',
  'pdf.repair',
  'pdf.decrypt',
];

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  app = await buildApp();
  await app.listen({ port: 8801, host: '127.0.0.1' });
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

async function makePdf(label = 'API'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 200]);
  page.drawText(label, { x: 30, y: 100, size: 16, font });
  return Buffer.from(await doc.save());
}

async function uploadPdf(buf: Buffer, name = 'report.pdf') {
  const form = new FormData();
  // Blob needs Uint8Array for undici FormData on Node
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

describe('PDF API jobs', () => {
  it('rejects a one-file merge before persisting a job', async () => {
    const up = await uploadPdf(await makePdf('One'), 'one.pdf');
    const beforeCount = (getDb().prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count;
    const response = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pdf',
        uploadIds: [up.id],
        options: { operation: 'merge' },
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error?.code, 'BAD_REQUEST');
    assert.match(String(body.error?.message), /at least 2 file/i);
    const afterCount = (getDb().prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count;
    assert.equal(afterCount, beforeCount);
  });

  it('POST /api/jobs type=pdf merge + poll + download', async () => {
    const a = await uploadPdf(await makePdf('A'), 'alpha.pdf');
    const b = await uploadPdf(await makePdf('B'), 'beta.pdf');
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
    assert.ok(job.id);
    assert.equal(job.type, 'pdf');

    // Polling fallback path (same as client when SSE unavailable)
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error || final.message);
    assert.match(String(final.outputName || ''), /merged\.pdf$/i);
    assert.ok(final.downloadUrl);

    const dl = await fetch(`${base}${final.downloadUrl}`);
    assert.equal(dl.status, 200);
    const bytes = Buffer.from(await dl.arrayBuffer());
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
    assert.ok(bytes.length > 0);
  });

  it('SSE progress events for pdf job', async () => {
    const up = await uploadPdf(await makePdf('SSE'), 'sse.pdf');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pdf',
        uploadIds: [up.id],
        options: { operation: 'rotate', angle: 90 },
      }),
    });
    const job = await create.json();
    assert.ok(job.id);

    const events: unknown[] = [];
    const ac = new AbortController();
    const res = await fetch(`${base}/api/jobs/${job.id}/events`, {
      headers: { Accept: 'text/event-stream' },
      signal: ac.signal,
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/i);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 40_000;
    let terminal = false;
    while (!terminal && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split('\n\n');
      buf = chunks.pop() || '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          events.push(payload);
          if (['completed', 'failed', 'cancelled'].includes(payload.status)) {
            terminal = true;
          }
        } catch {
          /* ignore partial */
        }
      }
    }
    ac.abort();
    assert.ok(events.length >= 1, 'expected at least one SSE event');
    const last = events[events.length - 1] as { status?: string };
    assert.ok(['completed', 'failed', 'cancelled'].includes(String(last.status)));
  });

  it('cancel pdf job', async () => {
    const up = await uploadPdf(await makePdf('Cancel'), 'cancel.pdf');
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
    const cancelRes = await fetch(`${base}/api/jobs/${job.id}/cancel`, { method: 'POST' });
    assert.ok(cancelRes.ok);
    const cancelled = await cancelRes.json();
    // May already be completed if very fast; accept cancelled or completed
    assert.ok(['cancelled', 'completed', 'running', 'queued'].includes(cancelled.status));
    const final = await waitJob(job.id);
    assert.ok(['cancelled', 'completed', 'failed'].includes(final.status));
  });

  it('resume-after-reload: GET same job id without creating duplicate', async () => {
    const up = await uploadPdf(await makePdf('Resume'), 'resume.pdf');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pdf',
        uploadIds: [up.id],
        options: { operation: 'compress-structural', quality: 'balanced' },
      }),
    });
    const job = await create.json();
    const id = job.id as string;

    // Simulate reload: only poll existing id (no second POST)
    const mid = await (await fetch(`${base}/api/jobs/${id}`)).json();
    assert.equal(mid.id, id);
    const final = await waitJob(id);
    assert.equal(final.id, id);
    assert.equal(final.status, 'completed', final.error || final.message);

    // Count pdf jobs for this upload path — only one create was issued
    const list = await (await fetch(`${base}/api/jobs?limit=50`)).json();
    const same = (list.jobs || []).filter((j: { id: string }) => j.id === id);
    assert.equal(same.length, 1);
  });

  it('capabilities expose full pdf.* set with available/reason/requires', async () => {
    const res = await fetch(`${base}/api/capabilities?refresh=1`);
    assert.equal(res.status, 200);
    const data = await res.json();
    const tools = data.tools || data.capabilities?.tools || [];
    assert.ok(Array.isArray(tools) && tools.length > 0);
    for (const id of REQUIRED_CAPS) {
      const tool = tools.find((t: { id: string }) => t.id === id);
      assert.ok(tool, `missing ${id}`);
      assert.equal(typeof tool.available, 'boolean', id);
      // requires may be array
      if (tool.requires != null) assert.ok(Array.isArray(tool.requires), id);
      if (tool.available === false) {
        assert.ok(tool.reason, `${id} needs reason when unavailable`);
      }
    }
    assert.ok(Array.isArray(data.pdf?.operations));
    const merge = data.pdf.operations.find((operation: { id: string }) => operation.id === 'merge');
    assert.equal(merge.capability, 'pdf.merge');
    assert.deepEqual(merge.cardinality, { minFiles: 2, maxFiles: 20 });
    assert.ok(Array.isArray(merge.options));
    assert.deepEqual(merge.outputKinds, ['pdf']);
    assert.equal(typeof merge.enginePolicy?.strategy, 'string');
    assert.equal(typeof data.binaries?.ghostscript?.available, 'boolean');
    assert.equal(typeof data.binaries?.qpdf?.available, 'boolean');
  });

  it('password never stored in job options DB row', async () => {
    const SECRET = 'NeverPersist-PDF-Pass-xyz';
    const up = await uploadPdf(await makePdf('Pwd'), 'pwd.pdf');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pdf',
        uploadIds: [up.id],
        options: { operation: 'inspect', password: SECRET },
      }),
    });
    const job = await create.json();
    assert.ok(!JSON.stringify(job).includes(SECRET));
    const row = getDb().prepare('SELECT options FROM jobs WHERE id = ?').get(job.id) as {
      options: string;
    };
    assert.ok(row);
    assert.ok(!row.options.includes(SECRET));
    assert.ok(!JSON.stringify(row).includes(SECRET));
    await waitJob(job.id);
    const again = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
    assert.ok(!JSON.stringify(again).includes(SECRET));
  });
});
