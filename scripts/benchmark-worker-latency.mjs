#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.BENCH_PORT || 8898);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(root, `data-benchmark-worker-${process.pid}`);
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] || '') : null;
const sampleBytes = Math.max(
  8 * 1024 * 1024,
  Math.min(90 * 1024 * 1024, Number(process.env.BENCH_FILE_BYTES || 80 * 1024 * 1024)),
);

if (!fs.existsSync(path.join(root, 'server', 'dist', 'index.js'))) {
  throw new Error('Production server is not built. Run npm run build:server first.');
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function summarize(values) {
  return {
    samples: values.length,
    minMs: Number(Math.min(...values).toFixed(3)),
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${url}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function waitFor(read, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (last) return last;
    } catch {
      // Production process may still be opening its listening socket.
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for benchmark condition; last=${JSON.stringify(last)}`);
}

async function healthLatency() {
  const started = performance.now();
  const health = await jsonRequest(`${baseUrl}/api/health`);
  if (!health.ok) throw new Error('Health endpoint returned ok=false');
  return performance.now() - started;
}

async function measureIdle(count) {
  const samples = [];
  for (let index = 0; index < count; index += 1) samples.push(await healthLatency());
  return samples;
}

async function terminate(child) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000).then(() => {
      if (child.exitCode == null) child.kill('SIGKILL');
    }),
  ]);
}

fs.rmSync(dataDir, { recursive: true, force: true });
const server = spawn(process.execPath, ['server/dist/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    SERVE_FRONTEND: '1',
    DATA_DIR: dataDir,
    DB_PATH: path.join(dataDir, 'benchmark.db'),
    LOG_LEVEL: 'error',
    WORKER_POOL_SIZE: '1',
    GENERAL_WORKER_CONCURRENCY: '1',
    MAX_UPLOAD_BYTES: String(100 * 1024 * 1024),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
  shell: false,
});

let stderr = '';
server.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4_000);
});

try {
  await waitFor(async () => {
    const health = await jsonRequest(`${baseUrl}/api/health`);
    return health.ok ? health : null;
  });

  const hostedResponse = await fetch(`${baseUrl}/`);
  const hostedHtml = await hostedResponse.text();
  const sameOriginUi = hostedResponse.ok && hostedHtml.includes('<div id="root"></div>');
  const versionResponse = await jsonRequest(`${baseUrl}/api/version`);

  const idleSamples = await measureIdle(30);

  // Real streamed upload + real SHA-256 conversions. Multiple jobs keep one
  // process worker busy long enough to sample API latency under sustained load.
  const source = Buffer.alloc(sampleBytes, 0x61);
  const form = new FormData();
  form.append('file', new Blob([source], { type: 'text/plain' }), 'worker-benchmark.txt');
  const upload = await jsonRequest(`${baseUrl}/api/uploads`, { method: 'POST', body: form });
  await waitFor(async () => {
    const file = await jsonRequest(`${baseUrl}/api/uploads/${upload.id}`);
    return file.status === 'ready' ? file : null;
  }, 60_000);

  const jobs = [];
  for (let index = 0; index < 4; index += 1) {
    jobs.push(
      await jsonRequest(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'text',
          uploadIds: [upload.id],
          options: { operation: 'hash', algorithm: index % 2 === 0 ? 'sha256' : 'sha512' },
        }),
      }),
    );
  }

  await waitFor(async () => {
    const diagnostics = await jsonRequest(`${baseUrl}/api/diagnostics`);
    return diagnostics.workerPool.activeJobs > 0 ? diagnostics : null;
  });

  const heavySamples = [];
  let samplesWhileActive = 0;
  let healthFailures = 0;
  for (let index = 0; index < 80; index += 1) {
    try {
      const diagnostics = await jsonRequest(`${baseUrl}/api/diagnostics`);
      if (diagnostics.workerPool.activeJobs > 0) samplesWhileActive += 1;
      heavySamples.push(await healthLatency());
    } catch {
      healthFailures += 1;
    }
  }

  const terminalJobs = await Promise.all(
    jobs.map((job) =>
      waitFor(async () => {
        const current = await jsonRequest(`${baseUrl}/api/jobs/${job.id}`);
        return ['completed', 'failed', 'cancelled'].includes(current.status) ? current : null;
      }, 60_000),
    ),
  );

  const idle = summarize(idleSamples);
  const underHeavyJob = summarize(heavySamples);
  const result = {
    benchmark: 'AlphaStudio process-worker health latency',
    version: '3.6.0',
    measuredAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    workload: {
      realUploadBytes: sampleBytes,
      jobs: jobs.length,
      operation: 'streamed SHA-256/SHA-512',
      workerPoolSize: 1,
    },
    productionSmoke: {
      sameOriginUi,
      apiVersion: versionResponse.version,
    },
    idleBeforeHeavyJob: idle,
    underHeavyJob,
    p95DeltaMs: Number((underHeavyJob.p95Ms - idle.p95Ms).toFixed(3)),
    p95Ratio: idle.p95Ms > 0 ? Number((underHeavyJob.p95Ms / idle.p95Ms).toFixed(3)) : null,
    samplesWhileWorkerActive: samplesWhileActive,
    healthFailures,
    jobStatuses: terminalJobs.map((job) => job.status),
    acceptance:
      healthFailures === 0 &&
      samplesWhileActive > 0 &&
      sameOriginUi &&
      versionResponse.version === '3.6.0' &&
      terminalJobs.every((job) => job.status === 'completed'),
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.acceptance) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  throw new Error(`${message}\nProduction server stderr:\n${stderr}`);
} finally {
  await terminate(server);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
