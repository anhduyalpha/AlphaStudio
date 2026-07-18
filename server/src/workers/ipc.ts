import type { ProcessResult } from '../processors/types.js';
import type { JobCategory } from '../config.js';

export const WORKER_PROTOCOL_VERSION = 1 as const;

export type WorkerJobPayload = {
  jobId: string;
  lease: string;
  type: string;
  category: JobCategory;
  inputPaths: string[];
  inputNames: string[];
  inputDetects: Array<Record<string, unknown> | null>;
  options: Record<string, unknown>;
  workDir: string;
  outputDir: string;
  cachedResult?: {
    outputPath: string;
    outputName: string;
    outputMime: string;
  } | null;
};

export type ApiToWorkerMessage =
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'run';
      workerId: string;
      job: WorkerJobPayload;
    }
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'cancel';
      workerId: string;
      jobId: string;
      lease: string;
      reason: 'cancel' | 'timeout' | 'shutdown';
    }
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'shutdown';
      workerId: string;
    }
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'ping';
      workerId: string;
    };

export type WorkerToApiMessage =
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'ready' | 'idle' | 'heartbeat';
      workerId: string;
      jobId?: string | null;
      lease?: string | null;
      at: number;
    }
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'progress';
      workerId: string;
      jobId: string;
      lease: string;
      progress: number;
      message?: string;
      at: number;
    }
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'result';
      workerId: string;
      jobId: string;
      lease: string;
      result: ProcessResult;
      at: number;
    }
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'error' | 'cancelled';
      workerId: string;
      jobId: string;
      lease: string;
      error?: string;
      errorCode?: string;
      at: number;
    }
  | {
      protocol: typeof WORKER_PROTOCOL_VERSION;
      type: 'child-started' | 'child-exited';
      workerId: string;
      jobId: string;
      lease: string;
      pid: number;
      at: number;
    };

export function isApiToWorkerMessage(value: unknown): value is ApiToWorkerMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ApiToWorkerMessage>;
  return (
    message.protocol === WORKER_PROTOCOL_VERSION &&
    typeof message.type === 'string' &&
    typeof message.workerId === 'string' &&
    ['run', 'cancel', 'shutdown', 'ping'].includes(message.type)
  );
}

export function isWorkerToApiMessage(value: unknown): value is WorkerToApiMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<WorkerToApiMessage>;
  if (
    message.protocol !== WORKER_PROTOCOL_VERSION ||
    typeof message.type !== 'string' ||
    typeof message.workerId !== 'string'
  ) {
    return false;
  }
  return [
    'ready',
    'idle',
    'heartbeat',
    'progress',
    'result',
    'error',
    'cancelled',
    'child-started',
    'child-exited',
  ].includes(message.type);
}

export function boundedWorkerMessage(message: unknown, max = 500): string | undefined {
  if (message == null) return undefined;
  return String(message).replace(/[\r\n\0]+/g, ' ').slice(0, max);
}
