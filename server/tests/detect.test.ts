import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const fixtures = path.join(root, 'fixtures', 'samples');
const testData = path.join(root, 'data-test-detect');

process.env.PORT = '8797';
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'test.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.MAX_UPLOAD_BYTES = String(5 * 1024 * 1024);
process.env.LOG_LEVEL = 'error';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb } = await import('../src/db/index.js');
const {
  detectFile,
  detectFileQuick,
  detectFileDeep,
  readFileHead,
  magicHeadHex,
  MAGIC_HEAD_BYTES,
  clearDetectCache,
  getDetectCacheStats,
  checksumFilePath,
} = await import('../src/convert/detect.js');
const { getToolsSnapshot, invalidateToolsSnapshot } = await import('../src/convert/matrix.js');

function sha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const samplePng = path.join(fixtures, 'sample.png');
const samplePdf = path.join(fixtures, 'sample.pdf');
const sampleTxt = path.join(fixtures, 'sample.txt');
const sampleWav = path.join(fixtures, 'sample.wav');

function rmQuiet(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    /* Windows EPERM when another process still holds a handle */
  }
}

before(() => {
  rmQuiet(testData);
  ensureDataDirs();
  initDb();
  clearDetectCache();
  invalidateToolsSnapshot();
});

after(() => {
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  clearDetectCache();
  rmQuiet(testData);
});

describe('readFileHead / magic helpers', () => {
  it('reads only first N bytes', () => {
    const full = fs.statSync(samplePng).size;
    const head = readFileHead(samplePng, 32);
    assert.equal(head.length, 32);
    assert.ok(full > 32 || full === head.length);
    // PNG magic
    assert.equal(head[0], 0x89);
    assert.equal(head.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(magicHeadHex(head, 4), '89504e47');
  });

  it('caps at file size for small files', () => {
    const size = fs.statSync(sampleTxt).size;
    const head = readFileHead(sampleTxt, MAGIC_HEAD_BYTES);
    assert.equal(head.length, size);
  });
});

describe('detectFileQuick vs detectFileDeep', () => {
  it('quick detects png without image dimensions', async () => {
    clearDetectCache();
    const checksum = sha256(samplePng);
    const q = await detectFileQuick(samplePng, 'sample.png', { checksum, bypassCache: true });
    assert.equal(q.family, 'image');
    assert.equal(q.format, 'png');
    assert.equal(q.depth, 'quick');
    assert.ok(q.meta.magicHead);
    assert.equal(q.meta.depth, 'quick');
    // no full sharp meta
    assert.equal(q.meta.width, undefined);
    assert.equal(q.meta.height, undefined);
    assert.ok(Array.isArray(q.outputs));
    assert.ok(q.outputs.some((o) => o.format === 'webp'));
    assert.ok(q.recommendedOutput);
  });

  it('deep detects png with sharp width/height', async () => {
    clearDetectCache();
    const checksum = sha256(samplePng);
    const d = await detectFileDeep(samplePng, 'sample.png', { checksum, bypassCache: true });
    assert.equal(d.family, 'image');
    assert.equal(d.format, 'png');
    assert.equal(d.depth, 'deep');
    assert.equal(typeof d.meta.width, 'number');
    assert.equal(typeof d.meta.height, 'number');
    assert.ok((d.meta.width as number) > 0);
  });

  it('quick detects pdf magic without page count', async () => {
    clearDetectCache();
    const checksum = sha256(samplePdf);
    const q = await detectFileQuick(samplePdf, 'sample.pdf', { checksum, bypassCache: true });
    assert.equal(q.family, 'pdf');
    assert.equal(q.format, 'pdf');
    assert.equal(q.depth, 'quick');
    assert.equal(q.meta.pages, undefined);
    assert.ok(String(q.meta.magicHead || '').startsWith('25504446')); // %PDF
  });

  it('deep detects pdf page count', async () => {
    clearDetectCache();
    const checksum = sha256(samplePdf);
    const d = await detectFile(samplePdf, 'sample.pdf', { checksum, bypassCache: true });
    assert.equal(d.family, 'pdf');
    assert.equal(d.depth, 'deep');
    assert.equal(typeof d.meta.pages, 'number');
    assert.ok((d.meta.pages as number) >= 1);
  });

  it('quick detects txt and lists pure outputs', async () => {
    clearDetectCache();
    const checksum = sha256(sampleTxt);
    const q = await detectFileQuick(sampleTxt, 'sample.txt', { checksum, bypassCache: true });
    assert.equal(q.family, 'text');
    assert.equal(q.format, 'txt');
    assert.ok(q.outputs.some((o) => o.format === 'pdf' && o.available));
  });

  it('quick detects wav; deep may add duration when ffprobe present', async () => {
    clearDetectCache();
    const checksum = sha256(sampleWav);
    const q = await detectFileQuick(sampleWav, 'sample.wav', { checksum, bypassCache: true });
    assert.equal(q.family, 'audio');
    assert.equal(q.format, 'wav');
    assert.equal(q.depth, 'quick');
    assert.equal(q.meta.duration, undefined);
    assert.equal(q.meta.streams, undefined);

    const d = await detectFileDeep(sampleWav, 'sample.wav', { checksum, bypassCache: true });
    assert.equal(d.family, 'audio');
    assert.equal(d.depth, 'deep');
    // ffprobe optional in CI
    if (d.tools.ffprobe?.available) {
      assert.ok(
        typeof d.meta.duration === 'number' ||
          d.meta.probeError ||
          Array.isArray(d.meta.streams),
        `expected probe meta: ${JSON.stringify(d.meta)}`,
      );
    }
  });

  it('rejects bad pdf magic on quick path', async () => {
    const p = path.join(testData, 'bad.pdf');
    fs.mkdirSync(testData, { recursive: true });
    fs.writeFileSync(p, Buffer.from('not-a-pdf'));
    await assert.rejects(() => detectFileQuick(p, 'bad.pdf', { bypassCache: true }));
  });
});

describe('detect cache by checksum', () => {
  it('second deep call hits memory cache', async () => {
    clearDetectCache();
    const checksum = sha256(samplePng);
    const a = await detectFile(samplePng, 'sample.png', { checksum, bypassCache: true });
    assert.equal(a.depth, 'deep');
    // without bypass — should return cached deep
    const b = await detectFile(samplePng, 'sample.png', { checksum });
    assert.equal(b.depth, 'deep');
    assert.equal(b.meta.width, a.meta.width);
    const stats = getDetectCacheStats();
    assert.ok(stats.keys.includes(checksum));
  });

  it('detectFile reuses quick classification then upgrades meta', async () => {
    clearDetectCache();
    const checksum = sha256(samplePng);
    const q = await detectFileQuick(samplePng, 'photo.png', { checksum });
    assert.equal(q.depth, 'quick');
    assert.equal(q.meta.width, undefined);

    const d = await detectFile(samplePng, 'photo.png', { checksum });
    assert.equal(d.depth, 'deep');
    assert.equal(d.format, q.format);
    assert.equal(typeof d.meta.width, 'number');
  });

  it('reuseDetect option skips re-classify', async () => {
    clearDetectCache();
    const checksum = sha256(sampleTxt);
    const first = await detectFileQuick(sampleTxt, 'sample.txt', { checksum, bypassCache: true });
    clearDetectCache();
    const reused = await detectFileQuick(sampleTxt, 'sample.txt', {
      checksum,
      reuseDetect: first,
    });
    assert.equal(reused.family, 'text');
    assert.equal(reused.format, 'txt');
  });

  it('checksumFilePath matches sha256 helper', () => {
    assert.equal(checksumFilePath(sampleTxt), sha256(sampleTxt));
  });
});

describe('getToolsSnapshot cache', () => {
  it('returns stable object reference within TTL', () => {
    invalidateToolsSnapshot();
    const a = getToolsSnapshot();
    const b = getToolsSnapshot();
    // same in-memory snapshot (no re-resolve)
    assert.equal(a, b);
    assert.ok(typeof a.sharp?.available === 'boolean');
    assert.ok(typeof a.ffmpeg?.available === 'boolean');

    invalidateToolsSnapshot();
    const c = getToolsSnapshot();
    // after invalidate, a fresh resolve is performed
    assert.notEqual(c, a);
    assert.equal(getToolsSnapshot(), c);
    assert.equal(c.sharp?.available, a.sharp?.available);
  });
});
