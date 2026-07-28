/**
 * Regression coverage for B3 spec-review findings: subscription identity and
 * malformed-frame backoff must preserve the single-stream/reconnect contract.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../api/client.js', () => ({
  api: {
    workspaceEventsUrl: (id: string) => `/api/workspaces/${id}/events`,
  },
}));

const { connectWorkspaceEvents, closeAllWorkspaceEvents } = await import('../protocol/events.js');

type StreamHandle = {
  push: (chunk: string) => void;
  close: () => void;
};

const encoder = new TextEncoder();
let calls: AbortSignal[] = [];
let streams: StreamHandle[] = [];
let originalFetch: typeof globalThis.fetch;

function streamFetch(_url: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal as AbortSignal;
  calls.push(signal);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let done = false;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  signal.addEventListener(
    'abort',
    () => {
      if (done) return;
      done = true;
      controller.error(new DOMException('The operation was aborted.', 'AbortError'));
    },
    { once: true },
  );
  streams.push({
    push(chunk: string) {
      if (!done) controller.enqueue(encoder.encode(chunk));
    },
    close() {
      if (done) return;
      done = true;
      controller.close();
    },
  });
  return Promise.resolve(new Response(body, { status: 200 }));
}

function settle(turns = 3): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 0; i < turns; i += 1) {
    chain = chain.then(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
  return chain;
}

beforeEach(() => {
  calls = [];
  streams = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = streamFetch as typeof globalThis.fetch;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  closeAllWorkspaceEvents();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

it('counts two subscriptions separately when they share one handlers object', async () => {
  const handlers = { onEvent: vi.fn() };
  const first = connectWorkspaceEvents('ws-shared', handlers);
  const second = connectWorkspaceEvents('ws-shared', handlers);
  await settle();

  expect(calls).toHaveLength(1);
  first.close();
  expect(calls[0].aborted).toBe(false);

  second.close();
  expect(calls[0].aborted).toBe(true);
});

it('does not reset exponential backoff after a malformed JSON frame', async () => {
  connectWorkspaceEvents(
    'ws-malformed',
    {},
    { initialRetryMs: 100, maxRetryMs: 400, heartbeatMs: 60_000, jitter: () => 1 },
  );
  await settle();

  streams[0].push('data: not-json\n\n');
  streams[0].close();
  await settle();
  await vi.advanceTimersByTimeAsync(100);
  await settle();
  expect(calls).toHaveLength(2);

  streams[1].push('data: still-not-json\n\n');
  streams[1].close();
  await settle();
  await vi.advanceTimersByTimeAsync(199);
  await settle();
  expect(calls).toHaveLength(2);

  await vi.advanceTimersByTimeAsync(1);
  await settle();
  expect(calls).toHaveLength(3);
});
