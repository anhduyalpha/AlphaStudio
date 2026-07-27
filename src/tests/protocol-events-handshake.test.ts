/**
 * Regression for a stream that wedges before response headers arrive.
 * SPEC §3.2 requires heartbeat/reconnect ownership, and §6.5 item 4 requires
 * restart resilience; both include the fetch handshake, not only body reads.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../api/client.js', () => ({
  api: {
    workspaceEventsUrl: (id: string) => `/api/workspaces/${id}/events`,
  },
}));

const { connectWorkspaceEvents, closeAllWorkspaceEvents } = await import('../protocol/events.js');

let calls: AbortSignal[] = [];
let originalFetch: typeof globalThis.fetch;

function hangingFetch(_url: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal as AbortSignal;
  calls.push(signal);
  return new Promise<Response>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('The operation was aborted.', 'AbortError')),
      { once: true },
    );
  });
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
  originalFetch = globalThis.fetch;
  globalThis.fetch = hangingFetch as typeof globalThis.fetch;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  closeAllWorkspaceEvents();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

it('aborts and reconnects when fetch hangs before response headers', async () => {
  connectWorkspaceEvents(
    'ws-handshake',
    {},
    { heartbeatMs: 1_000, initialRetryMs: 100, maxRetryMs: 100, jitter: () => 1 },
  );
  await settle();
  expect(calls).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(1_000);
  await settle();
  expect(calls[0].aborted).toBe(true);

  await vi.advanceTimersByTimeAsync(100);
  await settle();
  expect(calls).toHaveLength(2);
});
