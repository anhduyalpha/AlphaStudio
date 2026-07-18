import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test');

process.env.PORT = '8799';
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'test.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.MAX_UPLOAD_BYTES = String(2 * 1024 * 1024);
process.env.LOG_LEVEL = 'error';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');

let app: Awaited<ReturnType<typeof buildApp>>;
const base = 'http://127.0.0.1:8799';

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  app = await buildApp();
  await app.listen({ port: 8799, host: '127.0.0.1' });
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
  // Windows may keep WAL handles briefly; best-effort cleanup
  await new Promise((r) => setTimeout(r, 100));
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* ignore locked files on Windows */
  }
});

async function uploadBuffer(buf: Buffer, filename: string, mime = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), filename);
  const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
  const data = await res.json();
  return { res, data };
}

async function waitJob(id: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${base}/api/jobs/${id}`);
    const job = await res.json();
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Job timeout');
}

describe('system', () => {
  it('health', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it('version', async () => {
    const res = await fetch(`${base}/api/version`);
    const body = await res.json();
    assert.ok(body.version);
  });

  it('capabilities lists tools', async () => {
    const res = await fetch(`${base}/api/capabilities`);
    const body = await res.json();
    assert.ok(Array.isArray(body.tools));
    assert.ok(body.tools.some((t: { id: string }) => t.id === 'text.hash'));
    assert.ok(body.binaries.sharp.available);
  });

  it('diagnostics exposes process-worker health and queue metrics', async () => {
    const res = await fetch(`${base}/api/diagnostics`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.version, '3.6.0');
    assert.ok(['healthy', 'degraded', 'stopped'].includes(body.workerPool.status));
    assert.ok(Number.isInteger(body.workerPool.queueDepth));
    assert.ok(body.workerPool.categoryLimits.office >= 0);
  });
});

describe('uploads security', () => {
  it('accepts valid png', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 200 } },
    })
      .png()
      .toBuffer();
    const { res, data } = await uploadBuffer(png, 'ok.png', 'image/png');
    assert.equal(res.status, 201);
    assert.ok(data.id);
  });

  it('rejects empty file', async () => {
    const { res, data } = await uploadBuffer(Buffer.alloc(0), 'empty.png', 'image/png');
    assert.ok(res.status >= 400);
    assert.ok(data.error);
  });

  it('rejects oversized upload', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 100, 1);
    // pretends to be png but will fail magic or size first
    const { res, data } = await uploadBuffer(big, 'big.bin', 'application/octet-stream');
    assert.ok(res.status === 413 || res.status === 415 || res.status >= 400);
    assert.ok(data.error);
  });

  it('rejects corrupted pdf magic', async () => {
    const { res, data } = await uploadBuffer(Buffer.from('not-a-pdf'), 'bad.pdf', 'application/pdf');
    assert.ok(res.status >= 400);
    assert.ok(data.error);
  });

  it('rejects path-like original names safely (stores basename only)', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#111' },
    })
      .png()
      .toBuffer();
    const { res, data } = await uploadBuffer(png, '..\\..\\evil.png', 'image/png');
    assert.equal(res.status, 201);
    assert.ok(!String(data.originalName).includes('..'));
  });
});

describe('jobs', () => {
  it('text hash job completes', async () => {
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'text',
        options: { operation: 'hash', algorithm: 'sha256', input: 'alphastudio' },
      }),
    });
    assert.equal(create.status, 201);
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed');
    assert.ok(final.downloadUrl);
    const dl = await fetch(`${base}${final.downloadUrl}`);
    const body = await dl.json();
    assert.equal(typeof body.digest, 'string');
    assert.equal(body.digest.length, 64);
  });

  it('image convert job', async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const { data: up } = await uploadBuffer(png, 'red.png', 'image/png');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image',
        uploadIds: [up.id],
        options: { operation: 'convert', format: 'webp', quality: 70 },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error || final.message);
    const dl = await fetch(`${base}/api/jobs/${job.id}/download`);
    assert.equal(dl.status, 200);
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.ok(buf.length > 20);
  });

  it('pdf merge job', async () => {
    async function makePdf(label: string) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([200, 200]);
      page.drawText(label, { x: 20, y: 100, size: 12 });
      return Buffer.from(await doc.save());
    }
    const a = await makePdf('A');
    const b = await makePdf('B');
    const upA = await uploadBuffer(a, 'a.pdf', 'application/pdf');
    const upB = await uploadBuffer(b, 'b.pdf', 'application/pdf');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pdf',
        uploadIds: [upA.data.id, upB.data.id],
        options: { operation: 'merge' },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
  });

  it('qr generate job', async () => {
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'qr',
        options: { operation: 'generate', content: 'https://example.com', format: 'png', size: 128 },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
  });

  it('cancel running job ends as cancelled (not completed)', async () => {
    // Cooperative delay so cancel is observed mid-run
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'text',
        options: { operation: 'hash', algorithm: 'sha256', input: 'cancel-target', delayMs: 4000 },
      }),
    });
    assert.equal(create.status, 201);
    const job = await create.json();
    // Wait until running
    let sawRunning = false;
    for (let i = 0; i < 30; i++) {
      const cur = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
      if (cur.status === 'running') {
        sawRunning = true;
        break;
      }
      if (cur.status === 'queued') await new Promise((r) => setTimeout(r, 20));
      else break;
    }
    const cancel = await fetch(`${base}/api/jobs/${job.id}/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 200);
    const final = await waitJob(job.id, 10_000);
    assert.equal(final.status, 'cancelled', `expected cancelled, got ${final.status} (runningSeen=${sawRunning})`);
    assert.notEqual(final.status, 'completed');
  });

  it('pdf.to-images follows the detected rasterizer capability', async () => {
    const rasterizerAvailable = Boolean(
      detectCapabilities().tools.find((tool) => tool.id === 'pdf.to-images')?.available,
    );
    const doc = await PDFDocument.create();
    doc.addPage();
    const pdf = Buffer.from(await doc.save());
    const { data: up } = await uploadBuffer(pdf, 'x.pdf', 'application/pdf');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'pdf',
        uploadIds: [up.id],
        options: { operation: 'to-images' },
      }),
    });
    // The test environment may or may not provide pdftoppm/mutool/Ghostscript.
    // Assert the API follows its advertised capability instead of assuming one.
    if (create.status === 503) {
      const body = await create.json();
      assert.equal(body.error.code, 'UNAVAILABLE');
      assert.equal(rasterizerAvailable, false);
    } else {
      const job = await create.json();
      const final = await waitJob(job.id);
      if (rasterizerAvailable) {
        assert.equal(final.status, 'completed');
        assert.ok(final.downloadUrl);
      } else {
        assert.notEqual(final.status, 'completed');
      }
    }
  });
});

describe('archive zip-slip', () => {
  it('unit assertSafeArchiveEntry rejects traversal', async () => {
    const { assertSafeArchiveEntry } = await import('../src/security/validation.js');
    assert.throws(() => assertSafeArchiveEntry(testData, '../evil.txt'));
    assert.throws(() => assertSafeArchiveEntry(testData, '..\\evil.txt'));
    assert.throws(() => assertSafeArchiveEntry(testData, '/etc/passwd'));
    const safe = assertSafeArchiveEntry(testData, 'ok/file.txt');
    assert.ok(safe.includes('ok'));
  });

  it('extract job fails closed on zip with ../ entry', async () => {
    const evilZip = buildZipWithTraversal('../evil.txt', Buffer.from('pwned'));
    const { res, data: up } = await uploadBuffer(evilZip, 'evil.zip', 'application/zip');
    assert.equal(res.status, 201, JSON.stringify(up));
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'archive',
        uploadIds: [up.id],
        options: { operation: 'extract', format: 'zip' },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id, 15_000);
    assert.notEqual(final.status, 'completed', `zip-slip must not succeed: ${JSON.stringify(final)}`);
    assert.equal(final.status, 'failed');
    assert.match(String(final.error || final.message || ''), /traversal|Unsafe|zip-slip|Path|rejected/i);
  });
});

describe('pdf parsePages', () => {
  it('supports open range 1- and empty=all', async () => {
    const { parsePages } = await import('../src/processors/pdf.js');
    assert.deepEqual(parsePages('1-', 5), [0, 1, 2, 3, 4]);
    assert.deepEqual(parsePages('-2', 5), [0, 1]);
    assert.deepEqual(parsePages('2-4', 5), [1, 2, 3]);
    assert.deepEqual(parsePages('', 3), [0, 1, 2]);
    assert.deepEqual(parsePages('1,3', 5), [0, 2]);
  });
});

describe('security signature match', () => {
  it('extensionMatchesDetection reports false on mismatch', async () => {
    const { extensionMatchesDetection } = await import('../src/processors/security.js');
    assert.equal(extensionMatchesDetection('.jpg', '.png', 'image/png'), false);
    assert.equal(extensionMatchesDetection('.png', '.png', 'image/png'), true);
    assert.equal(extensionMatchesDetection('.jpeg', '.jpg', 'image/jpeg'), true);
  });

  it('signature job reports match:false for png bytes named .jpg', async () => {
    // Plant file on disk (upload validation would reject mime mismatch) and run processor path
    const { getDb } = await import('../src/db/index.js');
    const { config } = await import('../src/config.js');
    const { randomServerName } = await import('../src/lib/paths.js');
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const stored = randomServerName('.bin');
    const full = path.join(config.uploadsDir, stored);
    fs.writeFileSync(full, png);
    const id = `up-${Date.now()}`;
    getDb()
      .prepare(
        `INSERT INTO uploads (id, original_name, stored_name, path, mime, size, ext, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, 'photo.jpg', stored, full, 'image/png', png.length, '.jpg', new Date().toISOString());

    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'security',
        uploadIds: [id],
        options: { operation: 'signature' },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
    const dl = await fetch(`${base}/api/jobs/${job.id}/download`);
    const body = await dl.json();
    assert.equal(body.match, false, JSON.stringify(body));
    assert.equal(body.extension, '.jpg');
    assert.ok(body.detectedExt === '.png' || body.detectedMime === 'image/png');
  });
});

describe('profile settings persist', () => {
  it('profile put/get', async () => {
    const put = await fetch(`${base}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'TestUser', studioName: 'TestStudio' }),
    });
    assert.equal(put.status, 200);
    const get = await fetch(`${base}/api/profile`);
    const body = await get.json();
    assert.equal(body.displayName, 'TestUser');
    assert.equal(body.studioName, 'TestStudio');
  });

  it('settings put/get', async () => {
    const put = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { density: 'compact', theme: 'dark' } }),
    });
    assert.equal(put.status, 200);
    const get = await fetch(`${base}/api/settings`);
    const body = await get.json();
    assert.equal(body.settings.density, 'compact');
    assert.equal(body.settings.theme, 'dark');
  });
});

describe('security processor', () => {
  it('file hash', async () => {
    const buf = Buffer.from('checksum-me');
    const { data: up } = await uploadBuffer(buf, 'note.txt', 'text/plain');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'security',
        uploadIds: [up.id],
        options: { operation: 'hash', algorithms: ['sha256'] },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
  });
});

/** Minimal ZIP with a single stored (no compression) entry — allows traversal names. */
function buildZipWithTraversal(entryName: string, data: Buffer): Buffer {
  const name = Buffer.from(entryName, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // local file signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // method store
  localHeader.writeUInt16LE(0, 10); // time
  localHeader.writeUInt16LE(0, 12); // date
  const crc = crc32(data);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra len

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42); // relative offset of local header

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  const centralOffset = localHeader.length + name.length + data.length;
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, name, data, central, name, end]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

// silence unused
void randomBytes;
