/**
 * HTTP integration: GET /api/workspaces/:id/events receives real file.created
 * and job progress/update events with required fields after multipart upload + short job.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const testData = path.join(root, '..', 'data-test-workspace-sse');

process.env.PORT = '8793';
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'sse.db');
process.env.LOG_LEVEL = 'error';
process.env.CORS_ORIGIN = 'http://localhost:5173';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { createJob } = await import('../src/workers/jobs.js');

const base = 'http://127.0.0.1:8793';
let app: Awaited<ReturnType<typeof buildApp>>;

function tinyPng(): Buffer {
  // 1x1 PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** Read SSE lines until predicate matches or timeout */
async function collectSseEvents(
  url: string,
  {
    timeoutMs = 12_000,
    stopWhen,
  }: { timeoutMs?: number; stopWhen: (events: any[]) => boolean },
): Promise<any[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const events: any[] = [];
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: ac.signal,
    });
    assert.equal(res.status, 200, `SSE status ${res.status}`);
    assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/);
    const body = res.body;
    assert.ok(body, 'SSE body stream');
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Parse complete SSE data lines
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const block of parts) {
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              events.push(json);
            } catch {
              /* ignore non-json */
            }
          }
        }
      }
      if (stopWhen(events)) {
        ac.abort();
        break;
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  } finally {
    clearTimeout(timer);
  }
  return events;
}

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  app = await buildApp();
  await app.listen({ port: 8793, host: '127.0.0.1' });
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
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('workspace SSE HTTP integration', () => {
  it('streams connected + file.created after multipart upload with required fields', async () => {
    const wsRes = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: 'converter' }),
    });
    assert.equal(wsRes.status, 201);
    const ws = await wsRes.json();
    const workspaceId = ws.id as string;
    assert.ok(workspaceId);

    // Start SSE first (subscribe before upload)
    const ssePromise = collectSseEvents(`${base}/api/workspaces/${workspaceId}/events`, {
      timeoutMs: 15_000,
      stopWhen: (evs) =>
        evs.some((e) => e.type === 'file.created' && e.fileId) &&
        evs.some((e) => e.type === 'connected'),
    });

    // Small delay so SSE connects
    await new Promise((r) => setTimeout(r, 200));

    // Multipart upload
    const form = new FormData();
    form.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'sse-test.png');
    form.append('workspaceId', workspaceId);
    const upRes = await fetch(`${base}/api/uploads?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'POST',
      body: form,
    });
    const upText = await upRes.text();
    assert.equal(upRes.status, 201, upText);
    const up = JSON.parse(upText);
    assert.ok(up.id, 'stable file id');

    const events = await ssePromise;
    const connected = events.find((e) => e.type === 'connected');
    assert.ok(connected, 'connected event');
    assert.equal(connected.workspaceId, workspaceId);
    assert.ok(connected.version != null);
    assert.ok(connected.updatedAt);

    const created =
      events.find((e) => e.type === 'file.created' && e.fileId === up.id) ||
      events.find((e) => e.type === 'file.created');
    assert.ok(created, `file.created; got types=${events.map((e) => e.type).join(',')} ids=${events.map((e) => e.fileId).join(',')}`);
    assert.equal(created.workspaceId, workspaceId);
    assert.ok(created.fileId, 'fileId');
    assert.equal(created.fileId, up.id);
    assert.ok(created.status, 'status field');
    assert.ok(created.updatedAt, 'updatedAt');
    assert.ok(created.version != null, 'version');
  });

  it('streams job.created / job.updated with required fields for short text job', async () => {
    const wsRes = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: 'converter' }),
    });
    const ws = await wsRes.json();
    const workspaceId = ws.id as string;

    const ssePromise = collectSseEvents(`${base}/api/workspaces/${workspaceId}/events`, {
      timeoutMs: 15_000,
      stopWhen: (evs) =>
        evs.some((e) => e.type === 'job.created' || e.type === 'job.updated' || e.type === 'job.progress') &&
        evs.some(
          (e) =>
            (e.type === 'job.updated' || e.type === 'job.progress' || e.type === 'job.created') &&
            (e.status === 'completed' || e.status === 'running' || e.status === 'queued'),
        ),
    });

    await new Promise((r) => setTimeout(r, 200));

    // Text hash job needs no upload
    const job = createJob({
      type: 'text',
      uploadIds: [],
      workspaceId,
      options: { operation: 'hash', input: 'alpha-sse', algorithm: 'sha256' },
    });
    assert.ok(job.id);

    const events = await ssePromise;
    const jobEv = events.find((e) => e.jobId === job.id || e.job?.id === job.id);
    assert.ok(jobEv, `job event for ${job.id}; types=${events.map((e) => `${e.type}:${e.status}`).join(',')}`);
    assert.equal(jobEv.workspaceId, workspaceId);
    assert.ok(jobEv.jobId || jobEv.job?.id);
    assert.ok(jobEv.status, 'status');
    assert.ok(jobEv.updatedAt || jobEv.job?.updatedAt, 'updatedAt');
    assert.ok(jobEv.version != null || jobEv.job?.version != null, 'version');
    // stage / message / progress present on progress path when running
    const hasStage = jobEv.stage != null || jobEv.message != null || jobEv.job?.message != null;
    assert.ok(hasStage || jobEv.progress != null || jobEv.status === 'queued' || jobEv.status === 'completed');
  });
});
