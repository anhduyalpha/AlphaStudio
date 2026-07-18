/**
 * Progress update batching — coalesce high-frequency onProgress calls
 * to reduce SQLite write / SSE / WS chatter while keeping UX responsive.
 */

export type ProgressEmit = (progress: number, message?: string) => void;

export type ProgressBatcherOptions = {
  /** Minimum ms between emissions (default 100) */
  minIntervalMs?: number;
  /** Minimum progress delta (0–100) required to emit early (default 1) */
  minDelta?: number;
  /** Always emit progress ≥ this immediately (default 100) */
  forceAt?: number;
  /** Clock override for tests */
  now?: () => number;
};

export type ProgressBatcher = {
  update: (progress: number, message?: string) => void;
  /** Flush pending update if any */
  flush: () => void;
  /** Pending state (for tests) */
  pending: () => { progress: number; message?: string } | null;
};

function clampProgress(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, p));
}

/**
 * Create a progress batcher that throttles emit calls.
 * - First update always emits
 * - Subsequent updates coalesce until minIntervalMs and minDelta
 * - Message changes emit when the interval has elapsed
 * - progress ≥ forceAt (default 100) always flushes immediately
 * - flush() emits the last pending sample
 */
export function createProgressBatcher(
  emit: ProgressEmit,
  options: ProgressBatcherOptions = {},
): ProgressBatcher {
  const minIntervalMs = options.minIntervalMs ?? 100;
  const minDelta = options.minDelta ?? 1;
  const forceAt = options.forceAt ?? 100;
  const now = options.now ?? (() => Date.now());

  let lastEmittedAt = -Infinity;
  let lastEmittedProgress = -1;
  let lastEmittedMessage: string | undefined;
  let pending: { progress: number; message?: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function doEmit(progress: number, message?: string): void {
    lastEmittedAt = now();
    lastEmittedProgress = progress;
    lastEmittedMessage = message;
    pending = null;
    emit(progress, message);
  }

  function scheduleFlush(): void {
    if (timer != null) return;
    const wait = Math.max(0, minIntervalMs - (now() - lastEmittedAt));
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        const p = pending;
        doEmit(p.progress, p.message);
      }
    }, wait);
    // Don't keep process alive for progress timers alone
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref?.();
    }
  }

  return {
    update(progress: number, message?: string) {
      const p = clampProgress(progress);
      const forced = p >= forceAt;
      const deltaOk =
        lastEmittedProgress < 0 || Math.abs(p - lastEmittedProgress) >= minDelta;
      const intervalOk = now() - lastEmittedAt >= minIntervalMs;
      const first = lastEmittedProgress < 0;
      const messageChanged =
        message !== undefined && message !== lastEmittedMessage;

      if (first || forced || (deltaOk && intervalOk) || (messageChanged && intervalOk)) {
        clearTimer();
        doEmit(p, message);
        return;
      }

      // Coalesce — keep latest sample
      pending = { progress: p, message };
      scheduleFlush();
    },

    flush() {
      clearTimer();
      if (pending) {
        const p = pending;
        doEmit(p.progress, p.message);
      }
    },

    pending() {
      return pending ? { ...pending } : null;
    },
  };
}
