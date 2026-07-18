import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, `data-test-resumable-${process.pid}`);
const testPort = 8890 + (process.pid % 70);

process.env.PORT = String(testPort);
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'resumable.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.MAX_UPLOAD_BYTES = String(2 * 1024 * 1024);
process.env.UPLOAD_CHUNK_BYTES = String(256 * 1024);
process.env.LOG_LEVEL = 'error';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');

let app: Awaited<ReturnType<typeof buildApp>>;
const base = `http://127.0.0.1:${testPort}`;

async function startServer() {
  ensureDataDirs();
  initDb();
  app = await buildApp();
  await app.listen({ port: testPort, host: '127.0.0.1' });
}

async function restartServer() {
  await app.close();
  closeDb();
  await startServer();
}

async function jsonFetch(route: string, init?: RequestInit) {
  const res = await fetch(`${base}${route}`, {
    ...init,
    headers: { connection: 'close', ...(init?.headers || {}) },
  });
  const data = await res.json();
  return { res, data };
}

async function initSession(name: string, size: number) {
  const { res, data } = await jsonFetch('/api/upload-sessions/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalName: name, size, mime: 'text/plain', chunkSize: 256 * 1024 }),
  });
  assert.equal(res.status, 201, JSON.stringify(data));
  return data;
}

async function putChunk(session: any, index: number, bytes: Buffer, checksum?: string) {
  const start = index * session.chunkSize;
  const end = start + bytes.length - 1;
  return jsonFetch(`/api/upload-sessions/${session.id}/chunks/${index}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${session.size}`,
      'x-chunk-sha256': checksum || createHash('sha256').update(bytes).digest('hex'),
    },
    body: bytes,
  });
}

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  await startServer();
});

after(async () => {
  try { await app.close(); } catch { /* ignore */ }
  try { closeDb(); } catch { /* ignore */ }
  fs.rmSync(testData, { recursive: true, force: true });
});

describe('resumable chunk upload', () => {
  it('survives simulated network loss and server restart, rejects missing chunks, and finalizes', async () => {
    const body = Buffer.alloc(700_000, 0x61);
    const session = await initSession('resume.txt', body.length);
    const first = body.subarray(0, session.chunkSize);
    const uploaded = await putChunk(session, 0, first);
    assert.equal(uploaded.res.status, 201, JSON.stringify(uploaded.data));
    assert.equal(uploaded.data.session.receivedBytes, first.length);

    // Simulated network loss: client disappears after one committed chunk.
    const statusBefore = await jsonFetch(`/api/upload-sessions/${session.id}`);
    assert.deepEqual(statusBefore.data.receivedChunks, [0]);
    const missing = await jsonFetch(`/api/upload-sessions/${session.id}/finalize`, { method: 'POST' });
    assert.equal(missing.res.status, 409);
    assert.deepEqual(missing.data.error.details.missing, [1, 2]);

    await restartServer();
    const statusAfter = await jsonFetch(`/api/upload-sessions/${session.id}`);
    assert.equal(statusAfter.res.status, 200);
    assert.deepEqual(statusAfter.data.receivedChunks, [0]);

    const paused = await jsonFetch(`/api/upload-sessions/${session.id}/pause`, { method: 'POST' });
    assert.equal(paused.data.status, 'paused');
    const resumed = await jsonFetch(`/api/upload-sessions/${session.id}/resume`, { method: 'POST' });
    assert.equal(resumed.data.status, 'uploading');

    for (let index = 1; index < session.totalChunks; index += 1) {
      const start = index * session.chunkSize;
      const chunk = body.subarray(start, Math.min(body.length, start + session.chunkSize));
      const result = await putChunk(session, index, chunk);
      assert.equal(result.res.status, 201, JSON.stringify(result.data));
    }
    const finalized = await jsonFetch(`/api/upload-sessions/${session.id}/finalize`, { method: 'POST' });
    assert.equal(finalized.res.status, 201, JSON.stringify(finalized.data));
    assert.ok(finalized.data.file.id);
    assert.equal(finalized.data.file.status, 'processing');
    assert.equal(finalized.data.session.status, 'completed');
  });

  it('accepts an identical repeated chunk idempotently and rejects conflicting data', async () => {
    const body = Buffer.alloc(300_000, 0x62);
    const session = await initSession('repeat.txt', body.length);
    const chunk = body.subarray(0, session.chunkSize);
    const first = await putChunk(session, 0, chunk);
    assert.equal(first.res.status, 201);
    const repeated = await putChunk(session, 0, chunk);
    assert.equal(repeated.res.status, 200);
    assert.equal(repeated.data.idempotent, true);
    const conflict = await putChunk(session, 0, Buffer.alloc(chunk.length, 0x63));
    assert.equal(conflict.res.status, 409);
  });

  it('validates checksum/range, cancels durably, and rejects files above the limit', async () => {
    const session = await initSession('cancel.txt', 300_000);
    const chunk = Buffer.alloc(session.chunkSize, 0x64);
    const badChecksum = await putChunk(session, 0, chunk, '0'.repeat(64));
    assert.equal(badChecksum.res.status, 400);
    const badRange = await jsonFetch(`/api/upload-sessions/${session.id}/chunks/0`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 1-${chunk.length}/${session.size}`,
        'x-chunk-sha256': createHash('sha256').update(chunk).digest('hex'),
      },
      body: chunk,
    });
    assert.equal(badRange.res.status, 409);

    const ok = await putChunk(session, 0, chunk);
    assert.equal(ok.res.status, 201);
    const cancelled = await jsonFetch(`/api/upload-sessions/${session.id}`, { method: 'DELETE' });
    assert.equal(cancelled.res.status, 200);
    assert.equal(cancelled.data.cancelled, true);
    assert.equal(
      (getDb().prepare('SELECT COUNT(*) AS count FROM upload_chunks WHERE session_id = ?').get(session.id) as any).count,
      0,
    );
    const gone = await jsonFetch(`/api/upload-sessions/${session.id}`);
    assert.equal(gone.res.status, 404);

    const oversized = await jsonFetch('/api/upload-sessions/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalName: 'too-large.txt', size: 2 * 1024 * 1024 + 1 }),
    });
    assert.equal(oversized.res.status, 413);
  });

  it('does not confuse equal head/tail fingerprints when middle bytes differ', async () => {
    const head = Buffer.alloc(64 * 1024, 0x68);
    const tail = Buffer.alloc(64 * 1024, 0x74);
    const a = Buffer.concat([head, Buffer.alloc(64 * 1024, 0x61), tail]);
    const b = Buffer.concat([head, Buffer.alloc(64 * 1024, 0x62), tail]);

    const upload = async (name: string, body: Buffer) => {
      const session = await initSession(name, body.length);
      for (let index = 0; index < session.totalChunks; index += 1) {
        const start = index * session.chunkSize;
        const result = await putChunk(session, index, body.subarray(start, Math.min(body.length, start + session.chunkSize)));
        assert.equal(result.res.status, 201);
      }
      const finalized = await jsonFetch(`/api/upload-sessions/${session.id}/finalize`, { method: 'POST' });
      assert.equal(finalized.res.status, 201);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await jsonFetch(`/api/uploads/${finalized.data.file.id}`);
        if (current.data.status === 'ready') return current.data;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('File did not become ready');
    };

    const first = await upload('middle-a.txt', a);
    const second = await upload('middle-b.txt', b);
    assert.notEqual(first.checksum, second.checksum);
    assert.equal(second.duplicateOf, null);
  });
});
