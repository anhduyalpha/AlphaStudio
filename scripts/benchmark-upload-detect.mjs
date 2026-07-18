#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.BENCH_PORT || 8897);
const base = `http://127.0.0.1:${port}`;
const dataDir = path.join(root, `data-benchmark-upload-${process.pid}`);
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] || '') : null;
const smallBytes = Number(process.env.BENCH_SMALL_BYTES || 64 * 1024);
const largeBytes = Number(process.env.BENCH_LARGE_BYTES || 12 * 1024 * 1024);

async function timedJson(route, init) {
  const started = performance.now();
  const response = await fetch(`${base}${route}`, init);
  const body = await response.json();
  const elapsedMs = performance.now() - started;
  if (!response.ok) throw new Error(`${response.status} ${route}: ${JSON.stringify(body)}`);
  return { body, elapsedMs };
}

async function waitReady(id, timeoutMs = 60_000) {
  const started = performance.now();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await timedJson(`/api/uploads/${id}`);
    if (body.status === 'ready' && body.checksum) {
      return { file: body, elapsedMs: performance.now() - started };
    }
    if (body.status === 'failed') throw new Error(`Detect failed: ${JSON.stringify(body)}`);
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${id}`);
}

async function stop(child) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000).then(() => { if (child.exitCode == null) child.kill('SIGKILL'); }),
  ]);
}

fs.rmSync(dataDir, { recursive: true, force: true });
const server = spawn(process.execPath, ['server/dist/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    DB_PATH: path.join(dataDir, 'benchmark.db'),
    LOG_LEVEL: 'error',
    MAX_UPLOAD_BYTES: String(Math.max(32 * 1024 * 1024, largeBytes + 1)),
    UPLOAD_CHUNK_BYTES: String(1024 * 1024),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
  shell: false,
});

let stderr = '';
server.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });

try {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const { body } = await timedJson('/api/health');
      if (body.ok) break;
    } catch {
      if (attempt === 199) throw new Error('Server did not become healthy');
    }
    await delay(25);
  }

  const small = Buffer.alloc(smallBytes, 0x73);
  const smallForm = new FormData();
  smallForm.append('file', new Blob([small], { type: 'text/plain' }), 'benchmark-small.txt');
  const smallUpload = await timedJson('/api/uploads', { method: 'POST', body: smallForm });
  const smallReady = await waitReady(smallUpload.body.id);

  const large = Buffer.alloc(largeBytes, 0x6c);
  const sessionInit = await timedJson('/api/upload-sessions/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ originalName: 'benchmark-large.txt', size: large.length, mime: 'text/plain', chunkSize: 1024 * 1024 }),
  });
  const session = sessionInit.body;
  const chunkResponseMs = [];
  for (let index = 0; index < session.totalChunks; index += 1) {
    const start = index * session.chunkSize;
    const chunk = large.subarray(start, Math.min(large.length, start + session.chunkSize));
    const checksum = createHash('sha256').update(chunk).digest('hex');
    const uploaded = await timedJson(`/api/upload-sessions/${session.id}/chunks/${index}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'content-range': `bytes ${start}-${start + chunk.length - 1}/${large.length}`,
        'x-chunk-sha256': checksum,
      },
      body: chunk,
    });
    chunkResponseMs.push(uploaded.elapsedMs);
  }
  const largeFinalize = await timedJson(`/api/upload-sessions/${session.id}/finalize`, { method: 'POST' });
  const largeReady = await waitReady(largeFinalize.body.file.id);
  const version = (await timedJson('/api/version')).body.version;

  const result = {
    benchmark: 'AlphaStudio upload response and detect latency',
    version: '3.6.0',
    measuredAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    smallLegacyUpload: {
      bytes: smallBytes,
      responseMs: Number(smallUpload.elapsedMs.toFixed(3)),
      quickDetectInResponse: Boolean(smallUpload.body.detect),
      backgroundReadyMs: Number(smallReady.elapsedMs.toFixed(3)),
    },
    largeResumableUpload: {
      bytes: largeBytes,
      chunks: session.totalChunks,
      initResponseMs: Number(sessionInit.elapsedMs.toFixed(3)),
      chunkResponseAverageMs: Number((chunkResponseMs.reduce((a, b) => a + b, 0) / chunkResponseMs.length).toFixed(3)),
      chunkResponseMaxMs: Number(Math.max(...chunkResponseMs).toFixed(3)),
      finalizeAndQuickDetectMs: Number(largeFinalize.elapsedMs.toFixed(3)),
      quickDetectInResponse: Boolean(largeFinalize.body.file.detect),
      backgroundChecksumAndDeepDetectMs: Number(largeReady.elapsedMs.toFixed(3)),
    },
    acceptance:
      version === '3.6.0' &&
      Boolean(smallUpload.body.detect) &&
      Boolean(largeFinalize.body.file.detect) &&
      largeReady.file.status === 'ready',
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.acceptance) process.exitCode = 1;
} catch (error) {
  throw new Error(`${error instanceof Error ? error.stack || error.message : error}\nServer stderr:\n${stderr}`);
} finally {
  await stop(server);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
