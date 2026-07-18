/**
 * Durable unit tests for pure helpers: fingerprint, progress batching, tool-cache skip-probe.
 * Quality presets live in quality.test.ts (convert/quality).
 * detectFileQuick lives in detect.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  quickFingerprint,
  readFileHead,
  streamChecksum,
  checksumFileChunked,
  fingerprintKey,
  FINGERPRINT_WINDOW,
  MAGIC_HEAD_BYTES,
} from '../src/lib/fingerprint.js';
import { createProgressBatcher } from '../src/lib/progress-batch.js';
import {
  shouldSkipProbe,
  resolveFromValidConfig,
  listSkipProbeTools,
} from '../src/lib/tool-cache.js';
import { PROGRESS_MIN_DELTA, PROGRESS_MIN_INTERVAL_MS } from '../src/workers/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const samplePng = path.join(root, 'audit', 'fixtures', 'sample.png');
const sampleTxt = path.join(root, 'audit', 'fixtures', 'sample.txt');

describe('quickFingerprint / fingerprint helpers', () => {
  it('readFileHead returns only N bytes and PNG magic', () => {
    assert.ok(fs.existsSync(samplePng), 'fixture sample.png required');
    const head = readFileHead(samplePng, 32);
    assert.equal(head.length, 32);
    assert.equal(head[0], 0x89);
    assert.equal(head.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(MAGIC_HEAD_BYTES >= 4100);
    assert.ok(FINGERPRINT_WINDOW >= 1024);
  });

  it('quickFingerprint is stable for same file and changes when content changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-fp-'));
    const a = path.join(dir, 'a.bin');
    const b = path.join(dir, 'b.bin');
    fs.writeFileSync(a, Buffer.alloc(100_000, 0x11));
    fs.writeFileSync(b, Buffer.alloc(100_000, 0x11));
    const fa = quickFingerprint(a);
    const fb = quickFingerprint(b);
    assert.equal(fa, fb);
    assert.match(fa, /^[0-9a-f]{64}$/);

    // Change only the tail region (beyond head window for small tweak of last bytes)
    const buf = Buffer.alloc(100_000, 0x11);
    buf[buf.length - 1] = 0x22;
    fs.writeFileSync(b, buf);
    const fb2 = quickFingerprint(b);
    assert.notEqual(fa, fb2);

    // Size change also changes fingerprint
    fs.writeFileSync(b, Buffer.alloc(100_001, 0x11));
    assert.notEqual(fa, quickFingerprint(b));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fingerprintKey combines size and hash', () => {
    assert.equal(fingerprintKey(10, 'abc'), '10:abc');
  });

  it('streamChecksum matches checksumFileChunked on fixture', async () => {
    assert.ok(fs.existsSync(sampleTxt));
    const syncHash = checksumFileChunked(sampleTxt);
    const streamHash = await streamChecksum(sampleTxt);
    assert.equal(syncHash, streamHash);
    assert.match(syncHash, /^[0-9a-f]{64}$/);
  });
});

describe('createProgressBatcher', () => {
  it('exports job batching thresholds used by workers', () => {
    assert.equal(PROGRESS_MIN_DELTA, 5);
    assert.equal(PROGRESS_MIN_INTERVAL_MS, 500);
  });

  it('emits first update immediately, then coalesces small deltas inside interval', () => {
    let clock = 1000;
    const emitted: Array<{ p: number; m?: string }> = [];
    const batcher = createProgressBatcher(
      (p, m) => {
        emitted.push({ p, m });
      },
      {
        minIntervalMs: 500,
        minDelta: 5,
        forceAt: 99,
        now: () => clock,
      },
    );

    batcher.update(1, 'start');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].p, 1);

    // +2% within interval → pending, no emit
    clock += 50;
    batcher.update(3, 'tick');
    assert.equal(emitted.length, 1);
    assert.ok(batcher.pending());

    // Jump by ≥ minDelta still needs interval unless forced
    batcher.update(10, 'jump');
    assert.equal(emitted.length, 1);

    // After interval, next update with delta emits
    clock += 500;
    batcher.update(15, 'later');
    assert.equal(emitted.length, 2);
    assert.equal(emitted[1].p, 15);
    assert.equal(emitted[1].m, 'later');
  });

  it('forceAt flushes immediately regardless of interval', () => {
    let clock = 0;
    const emitted: number[] = [];
    const batcher = createProgressBatcher((p) => emitted.push(p), {
      minIntervalMs: 10_000,
      minDelta: 50,
      forceAt: 99,
      now: () => clock,
    });
    batcher.update(1);
    clock += 1;
    batcher.update(99, 'almost done');
    assert.equal(emitted.length, 2);
    assert.equal(emitted[1], 99);
  });

  it('flush emits pending sample', () => {
    let clock = 0;
    const emitted: number[] = [];
    const batcher = createProgressBatcher((p) => emitted.push(p), {
      minIntervalMs: 1000,
      minDelta: 5,
      now: () => clock,
    });
    batcher.update(10);
    clock += 10;
    batcher.update(12); // pending
    assert.equal(emitted.length, 1);
    batcher.flush();
    assert.equal(emitted.length, 2);
    assert.equal(emitted[1], 12);
    assert.equal(batcher.pending(), null);
  });

  it('message change emits after interval even with tiny delta', () => {
    let clock = 0;
    const emitted: Array<{ p: number; m?: string }> = [];
    const batcher = createProgressBatcher(
      (p, m) => emitted.push({ p, m }),
      { minIntervalMs: 100, minDelta: 20, now: () => clock },
    );
    batcher.update(10, 'a');
    clock += 100;
    batcher.update(11, 'b');
    assert.equal(emitted.length, 2);
    assert.equal(emitted[1].m, 'b');
  });
});

describe('tool-cache shouldSkipProbe', () => {
  it('returns false for missing path / missing file / missing version', () => {
    const exists = (p: string) => p === 'C:\\exists\\ffmpeg.exe' || p === '/exists/ffmpeg';
    assert.equal(shouldSkipProbe(null, { existsSync: exists }), false);
    assert.equal(shouldSkipProbe({}, { existsSync: exists }), false);
    assert.equal(shouldSkipProbe({ path: '', version: '1' }, { existsSync: exists }), false);
    assert.equal(
      shouldSkipProbe({ path: 'C:\\missing\\x', version: '1' }, { existsSync: exists }),
      false,
    );
    assert.equal(
      shouldSkipProbe({ path: 'C:\\exists\\ffmpeg.exe' }, { existsSync: exists }),
      false,
    );
    assert.equal(
      shouldSkipProbe({ path: 'C:\\exists\\ffmpeg.exe', version: '' }, { existsSync: exists }),
      false,
    );
  });

  it('returns true when path exists and version is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tool-'));
    const bin = path.join(dir, 'tool.bin');
    fs.writeFileSync(bin, 'x');
    assert.equal(shouldSkipProbe({ path: bin, version: '1.2.3' }), true);
    const resolved = resolveFromValidConfig('ffmpeg', { path: bin, version: '1.2.3' });
    assert.equal(resolved.available, true);
    assert.equal(resolved.skippedProbe, true);
    assert.equal(resolved.path, bin);
    assert.equal(resolved.version, '1.2.3');

    const list = listSkipProbeTools({
      ffmpeg: { path: bin, version: '1' },
      broken: { path: path.join(dir, 'nope'), version: '1' },
      incomplete: { path: bin },
    });
    assert.deepEqual(list, ['ffmpeg']);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('requireVersion=false allows skip when only path exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tool2-'));
    const bin = path.join(dir, 't.bin');
    fs.writeFileSync(bin, 'x');
    assert.equal(shouldSkipProbe({ path: bin }, { requireVersion: false }), true);
    assert.equal(shouldSkipProbe({ path: bin }, { requireVersion: true }), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
