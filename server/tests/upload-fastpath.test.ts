import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, `data-test-fastupload-${process.pid}`);
const testPort = 8810 + (process.pid % 80);

process.env.PORT = String(testPort);
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'fast.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.LOG_LEVEL = 'error';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');
const {
  FINGERPRINT_WINDOW,
  quickFingerprint,
  streamChecksum,
  checksumFileChunked,
  readFileHead,
} = await import('../src/lib/fingerprint.js');
const { detectFileQuick, clearDetectCache } = await import('../src/convert/detect.js');

let app: Awaited<ReturnType<typeof buildApp>>;
const base = `http://127.0.0.1:${testPort}`;

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  clearDetectCache();
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

describe('quickFingerprint unit', () => {
  it('hashes size + head/tail without requiring full-file equality for different middles', () => {
    const dir = path.join(testData, 'fp-unit');
    fs.mkdirSync(dir, { recursive: true });
    // Two files larger than 2*window with same head/tail but different middle
    const window = FINGERPRINT_WINDOW;
    const head = Buffer.alloc(window, 0x41);
    const tail = Buffer.alloc(window, 0x42);
    const midA = Buffer.alloc(window, 0x10);
    const midB = Buffer.alloc(window, 0x20);
    const a = path.join(dir, 'a.bin');
    const b = path.join(dir, 'b.bin');
    fs.writeFileSync(a, Buffer.concat([head, midA, tail]));
    fs.writeFileSync(b, Buffer.concat([head, midB, tail]));

    const fa = quickFingerprint(a);
    const fb = quickFingerprint(b);
    // Same size + head + tail → same quick fingerprint (early dedupe is approximate)
    assert.equal(fa, fb);
    assert.equal(fa.length, 64);

    // Full checksum differs
    const ca = checksumFileChunked(a);
    const cb = checksumFileChunked(b);
    assert.notEqual(ca, cb);
  });

  it('is stable for identical content and size-sensitive', () => {
    const dir = path.join(testData, 'fp-stable');
    fs.mkdirSync(dir, { recursive: true });
    const p1 = path.join(dir, 'x.txt');
    const p2 = path.join(dir, 'y.txt');
    fs.writeFileSync(p1, 'hello-fingerprint');
    fs.writeFileSync(p2, 'hello-fingerprint');
    assert.equal(quickFingerprint(p1), quickFingerprint(p2));

    const p3 = path.join(dir, 'z.txt');
    fs.writeFileSync(p3, 'hello-fingerprint!');
    assert.notEqual(quickFingerprint(p1), quickFingerprint(p3));
  });

  it('streamChecksum matches chunked and classic hash', async () => {
    const p = path.join(testData, 'sum.bin');
    const body = randomBytes(200_000);
    fs.writeFileSync(p, body);
    const expected = createHash('sha256').update(body).digest('hex');
    const streamed = await streamChecksum(p);
    const chunked = checksumFileChunked(p);
    assert.equal(streamed, expected);
    assert.equal(chunked, expected);
  });

  it('readFileHead only returns requested prefix', () => {
    const p = path.join(testData, 'head.bin');
    fs.writeFileSync(p, Buffer.concat([Buffer.from('HEADDATA'), randomBytes(10_000)]));
    const head = readFileHead(p, 8);
    assert.equal(head.toString('utf8'), 'HEADDATA');
    assert.equal(head.length, 8);
  });
});

describe('detectFileQuick unit', () => {
  it('detects PNG from head magic without full-file hash', async () => {
    const p = path.join(testData, 'q.png');
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(p, png);

    // No checksum provided — must still work
    const det = await detectFileQuick(p, 'sample.png');
    assert.equal(det.family, 'image');
    assert.equal(det.format, 'png');
    assert.ok(Array.isArray(det.outputs));
    assert.ok(det.outputs.length > 0);
    assert.equal(det.depth, 'quick');
    assert.equal(det.meta?.depth, 'quick');
    // Quick path must not require deep image dimensions
    assert.equal(typeof det.meta?.width, 'undefined');
  });

  it('detects text by extension without full hash', async () => {
    const p = path.join(testData, 'note.txt');
    fs.writeFileSync(p, 'plain text body for quick detect');
    const det = await detectFileQuick(p, 'note.txt');
    assert.equal(det.family, 'text');
    assert.ok(det.outputs.some((o) => o.format === 'pdf'));
  });
});

describe('POST /api/uploads fast path', () => {
  it('returns id + quick detect immediately; checksum may be null/processing', async () => {
    const png = await sharp({
      create: { width: 12, height: 12, channels: 3, background: { r: 9, g: 8, b: 7 } },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'fast.png');
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    const data = await res.json();
    assert.equal(res.status, 201, JSON.stringify(data));
    assert.ok(data.id, 'file id for jobs');
    assert.ok(data.detect, 'quick detect present');
    assert.equal(data.detect.family, 'image');
    assert.ok(data.detect.outputs?.length > 0);
    assert.ok(data.fingerprint, 'quick fingerprint present');
    assert.ok(['processing', 'ready'].includes(data.status));
    // Must not expose raw path
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'path'), false);

    // Poll until ready for full checksum
    let ready = data;
    for (let i = 0; i < 40; i++) {
      if (ready.status === 'ready' && ready.checksum) break;
      await new Promise((r) => setTimeout(r, 50));
      ready = await (await fetch(`${base}/api/uploads/${data.id}`)).json();
    }
    assert.equal(ready.status, 'ready');
    assert.ok(ready.checksum);
    assert.equal(ready.checksum.length, 64);
  });

  it('never copies prior full checksum from fingerprint match alone', async () => {
    // Upload same PNG twice: second must still start as processing with null checksum
    // until finalize verifies full hash (fingerprint is not identity).
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();

    const form1 = new FormData();
    form1.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
    const r1 = await fetch(`${base}/api/uploads`, { method: 'POST', body: form1 });
    const d1 = await r1.json();
    assert.equal(r1.status, 201, JSON.stringify(d1));

    // Wait for first to fully finalize
    let ready = d1;
    for (let i = 0; i < 50; i++) {
      if (ready.status === 'ready' && ready.checksum) break;
      await new Promise((r) => setTimeout(r, 50));
      ready = await (await fetch(`${base}/api/uploads/${d1.id}`)).json();
    }
    assert.equal(ready.status, 'ready');
    assert.ok(ready.checksum);

    const form2 = new FormData();
    form2.append('file', new Blob([png], { type: 'image/png' }), 'b.png');
    const r2 = await fetch(`${base}/api/uploads`, { method: 'POST', body: form2 });
    const d2 = await r2.json();
    assert.equal(r2.status, 201, JSON.stringify(d2));
    // Immediate response: must not claim ready with a borrowed checksum
    assert.equal(d2.status, 'processing');
    assert.equal(d2.checksum, null);
    assert.ok(d2.detect, 'may reuse detect as UI hint');
    assert.ok(d2.fingerprint);

    // Background finalize still assigns a real checksum
    let ready2 = d2;
    for (let i = 0; i < 50; i++) {
      if (ready2.status === 'ready' && ready2.checksum) break;
      await new Promise((r) => setTimeout(r, 50));
      ready2 = await (await fetch(`${base}/api/uploads/${d2.id}`)).json();
    }
    assert.equal(ready2.status, 'ready');
    assert.equal(ready2.checksum, ready.checksum);
  });

  it('does not require full hash before returning detect', async () => {
    // Large-ish buffer so full hash would be more work than head detect
    const big = Buffer.concat([
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
      randomBytes(512 * 1024),
    ]);
    // Still a valid-ish png header for magic; validation may reject trailing junk —
    // use pure large text instead
    const textBody = Buffer.alloc(600_000, 0x61); // 'a' * 600k
    const form = new FormData();
    form.append('file', new Blob([textBody], { type: 'text/plain' }), 'big.txt');
    const t0 = Date.now();
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    const elapsed = Date.now() - t0;
    const data = await res.json();
    assert.equal(res.status, 201, JSON.stringify(data));
    assert.ok(data.detect);
    assert.equal(data.detect.family, 'text');
    // Response should not wait on deep meta; typically well under a few seconds
    assert.ok(elapsed < 15_000, `upload too slow: ${elapsed}ms`);
    assert.ok(data.id);
  });
});
