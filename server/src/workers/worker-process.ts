import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getProcessor } from '../processors/index.js';
import type { ProcessResult } from '../processors/types.js';
import { randomServerName } from '../lib/paths.js';
import {
  clearJobChildren,
  killAllJobChildren,
  killJobChildren,
  setChildLifecycleObserver,
} from '../lib/child-registry.js';
import {
  WORKER_PROTOCOL_VERSION,
  boundedWorkerMessage,
  isApiToWorkerMessage,
  type WorkerJobPayload,
  type WorkerToApiMessage,
} from './ipc.js';

const workerId = String(process.env.ALPHASTUDIO_WORKER_ID || `worker-${process.pid}`);
const allowedTypes = new Set([
  'text',
  'image',
  'qr',
  'pdf',
  'archive',
  'security',
  'media',
  'audio',
  'converter',
  'pyop',
]);

let active: { jobId: string; lease: string; cancelled: boolean } | null = null;
let shuttingDown = false;

type StripWorkerEnvelope<T> = T extends unknown
  ? Omit<T, 'protocol' | 'workerId' | 'at'>
  : never;
type WorkerMessagePayload = StripWorkerEnvelope<WorkerToApiMessage>;

function send(message: WorkerMessagePayload): void {
  if (!process.connected || !process.send) return;
  try {
    process.send({
      ...message,
      protocol: WORKER_PROTOCOL_VERSION,
      workerId,
      at: Date.now(),
    } as WorkerToApiMessage);
  } catch {
    /* parent disconnected */
  }
}

function isInside(root: string, candidate: string): boolean {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const relative = path.relative(base, target);
  if (!relative || relative === '.') return true;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function validatePayload(job: WorkerJobPayload): void {
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(job.jobId)) throw new Error('Invalid worker job id');
  if (!/^[A-Za-z0-9-]{8,200}$/.test(job.lease)) throw new Error('Invalid worker lease');
  if (!allowedTypes.has(job.type)) throw new Error('Unknown worker job type');
  if (!Array.isArray(job.inputPaths) || job.inputPaths.length > 20) {
    throw new Error('Invalid worker input list');
  }
  if (!Array.isArray(job.inputNames) || job.inputNames.length !== job.inputPaths.length) {
    throw new Error('Invalid worker input names');
  }
  const expectedWork = path.join(config.tempDir, job.jobId);
  const expectedOutput = path.join(config.outputsDir, job.jobId);
  if (path.resolve(job.workDir) !== path.resolve(expectedWork)) {
    throw new Error('Worker work directory rejected');
  }
  if (path.resolve(job.outputDir) !== path.resolve(expectedOutput)) {
    throw new Error('Worker output directory rejected');
  }
  for (const inputPath of job.inputPaths) {
    if (typeof inputPath !== 'string' || !isInside(config.uploadsDir, inputPath)) {
      throw new Error('Worker input path rejected');
    }
  }
  if (job.cachedResult && !isInside(config.outputsDir, job.cachedResult.outputPath)) {
    throw new Error('Worker cache path rejected');
  }
  const serialized = JSON.stringify({
    options: job.options,
    inputDetects: job.inputDetects,
    inputNames: job.inputNames,
  });
  if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) {
    throw new Error('Worker payload exceeds IPC limit');
  }
}

function safeResult(result: ProcessResult): ProcessResult {
  const meta = result.meta;
  if (!meta) return result;
  try {
    if (Buffer.byteLength(JSON.stringify(meta), 'utf8') <= 64 * 1024) return result;
  } catch {
    /* omit unserializable metadata */
  }
  return { ...result, meta: undefined };
}

async function ensureOutputInside(job: WorkerJobPayload, result: ProcessResult): Promise<ProcessResult> {
  const source = path.resolve(result.outputPath);
  if (isInside(job.outputDir, source)) return { ...result, outputPath: source };
  if (!isInside(job.workDir, source)) throw new Error('Processor returned an unsafe output path');
  const destination = path.join(
    job.outputDir,
    randomServerName(path.extname(source) || path.extname(result.outputName)),
  );
  await fs.promises.copyFile(source, destination);
  return { ...result, outputPath: destination };
}

async function run(job: WorkerJobPayload): Promise<void> {
  if (active) {
    send({
      type: 'error',
      jobId: job.jobId,
      lease: job.lease,
      error: 'Worker received a job while busy',
      errorCode: 'WORKER_BUSY',
    });
    return;
  }

  active = { jobId: job.jobId, lease: job.lease, cancelled: false };
  try {
    validatePayload(job);
    await fs.promises.mkdir(job.workDir, { recursive: true });
    await fs.promises.mkdir(job.outputDir, { recursive: true });

    let result: ProcessResult;
    if (job.cachedResult) {
      const ext = path.extname(job.cachedResult.outputPath) || path.extname(job.cachedResult.outputName);
      const destination = path.join(job.outputDir, randomServerName(ext));
      await fs.promises.copyFile(job.cachedResult.outputPath, destination);
      result = {
        outputPath: destination,
        outputName: job.cachedResult.outputName,
        outputMime: job.cachedResult.outputMime,
        meta: { ...(job.cachedResult.meta || {}), cacheHit: true },
      };
      send({
        type: 'progress',
        jobId: job.jobId,
        lease: job.lease,
        progress: 50,
        message: 'Cache hit — reusing prior result',
      });
    } else {
      const processor = await getProcessor(job.type);
      result = await processor({
        jobId: job.jobId,
        inputPaths: job.inputPaths,
        inputNames: job.inputNames,
        options: job.options,
        workDir: job.workDir,
        outputDir: job.outputDir,
        inputDetects: job.inputDetects,
        onProgress: (progress, message) => {
          if (!active || active.cancelled) return;
          send({
            type: 'progress',
            jobId: job.jobId,
            lease: job.lease,
            progress: Math.max(0, Math.min(99, Number(progress) || 0)),
            message: boundedWorkerMessage(message),
          });
        },
        isCancelled: () => Boolean(active?.cancelled),
      });
    }

    if (active?.cancelled) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    const confined = await ensureOutputInside(job, result);
    send({
      type: 'result',
      jobId: job.jobId,
      lease: job.lease,
      result: safeResult(confined),
    });
  } catch (error) {
    const err = error as Error & { code?: string };
    const cancelled = Boolean(active?.cancelled) || err.code === 'CANCELLED';
    send({
      type: cancelled ? 'cancelled' : 'error',
      jobId: job.jobId,
      lease: job.lease,
      error: boundedWorkerMessage(err.message || (cancelled ? 'Cancelled' : 'Worker job failed')),
      errorCode: cancelled ? 'CANCELLED' : boundedWorkerMessage(err.code || 'WORKER_JOB_FAILED', 80),
    });
  } finally {
    clearJobChildren(job.jobId);
    try {
      await fs.promises.rm(job.workDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    active = null;
    send({ type: 'idle', jobId: null, lease: null });
    if (shuttingDown) process.exit(0);
  }
}

setChildLifecycleObserver((event) => {
  if (!active || event.jobId !== active.jobId) return;
  send({
    type: event.type === 'started' ? 'child-started' : 'child-exited',
    jobId: active.jobId,
    lease: active.lease,
    pid: event.pid,
  });
});

process.on('message', (raw: unknown) => {
  if (!isApiToWorkerMessage(raw) || raw.workerId !== workerId) return;
  if (raw.type === 'run') {
    void run(raw.job);
    return;
  }
  if (raw.type === 'cancel') {
    if (active && active.jobId === raw.jobId && active.lease === raw.lease) {
      active.cancelled = true;
      killJobChildren(active.jobId);
    }
    return;
  }
  if (raw.type === 'shutdown') {
    shuttingDown = true;
    if (active) {
      active.cancelled = true;
      killJobChildren(active.jobId);
    } else {
      process.exit(0);
    }
    return;
  }
  if (raw.type === 'ping') {
    send({
      type: 'heartbeat',
      jobId: active?.jobId || null,
      lease: active?.lease || null,
    });
  }
});

const heartbeat = setInterval(() => {
  send({
    type: 'heartbeat',
    jobId: active?.jobId || null,
    lease: active?.lease || null,
  });
}, config.workerHeartbeatMs);
heartbeat.unref?.();

function emergencyExit(): void {
  shuttingDown = true;
  if (active) active.cancelled = true;
  killAllJobChildren();
  clearInterval(heartbeat);
  process.exit(0);
}

process.once('disconnect', emergencyExit);
process.once('SIGTERM', emergencyExit);
process.once('SIGINT', emergencyExit);

send({ type: 'ready', jobId: null, lease: null });
