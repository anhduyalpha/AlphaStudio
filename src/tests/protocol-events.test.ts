/**
 * Parser + reconnect suite for `src/protocol/events.ts` (PLAN B3, SPEC §7.2).
 *
 * SPEC §3.2 (events row), §6.3 (reconnect/epoch re-hydrate), and §6.4
 * (the client epoch rule) are pinned here.
 *
 * Each case is written as the hazard it kills. The named ones: a second stream
 * per workspace (the F3-H1 leak class), a wedged half-open connection that never
 * errors (§6.5 item 4), a stale mirror after a reconnect that reported nothing,
 * and an epoch flip merged before the consumer is told to drop ordering state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client.js', () => ({
  api: {
    workspaceEventsUrl: (id: string) => `/api/workspaces/${id}/events`,
  },
}));

const { connectWorkspaceEvents, closeAllWorkspaceEvents, createSseDecoder } = await import(
  '../protocol/events.js'
);

/* ---------------------------------------------------------------- *
 * Stream harness. The fake `fetch` hands back a real `Response` over
 * a real `ReadableStream`, so chunking, aborts and back-pressure are
 * the platform's rather than a mock's approximation of them.
 * ---------------------------------------------------------------- */

type StreamHandle = {
  push: (chunk: string) => void;
  close: () => void;
  aborted: () => boolean;
};

type FetchCall = { url: string; headers: Record<string, string>; signal: AbortSignal };

type Plan = { kind: 'stream' } | { kind: 'status'; status: number } | { kind: 'error' };

const encoder = new TextEncoder();

let calls: FetchCall[] = [];
let streams: StreamHandle[] = [];
let plan: Plan[] = [];
let originalFetch: typeof globalThis.fetch;

/** Queue the outcome of the next `fetch`; the default is a live stream. */
function queue(...steps: Plan[]): void {
  plan.push(...steps);
}

function fakeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries((init.headers as Record<string, string>) || {})) {
    headers[key] = value;
  }
  const signal = init.signal as AbortSignal;
  calls.push({ url, headers, signal });

  const step: Plan = plan.shift() ?? { kind: 'stream' };
  if (step.kind === 'error') return Promise.reject(new TypeError('fetch failed'));
  if (step.kind === 'status') {
    return Promise.resolve(new Response('unavailable', { status: step.status }));
  }

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let aborted = false;
  let done = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  signal?.addEventListener('abort', () => {
    aborted = true;
    if (done) return;
    done = true;
    controller.error(new DOMException('The operation was aborted.', 'AbortError'));
  });
  streams.push({
    push: (chunk: string) => {
      if (!done) controller.enqueue(encoder.encode(chunk));
    },
    close: () => {
      if (done) return;
      done = true;
      controller.close();
    },
    aborted: () => aborted,
  });
  return Promise.resolve(new Response(stream, { status: 200 }));
}

/**
 * Let the read loop run. `setImmediate` is deliberately left un-faked (see
 * `beforeEach`) so stream plumbing keeps using real macrotasks while the
 * module's own `setTimeout`s stay under the test's control.
 */
function settle(turns = 3): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 0; i < turns; i += 1) {
    chain = chain.then(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
  return chain;
}

/** Advance the module's timers and let whatever they started run. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

function frame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'job.progress',
    workspaceId: 'ws-1',
    jobId: 'job-1',
    status: 'running',
    progress: 40,
    message: null,
    updatedAt: '2026-07-27T12:00:00.000Z',
    version: 7,
    epoch: 'epoch-a',
    seq: 7,
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  streams = [];
  plan = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch as unknown as typeof globalThis.fetch;
  // Only the module's own scheduling is faked; `setImmediate`/microtasks stay
  // real so `settle()` can drive the stream reader.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  closeAllWorkspaceEvents();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

/* ---------------------------------------------------------------- *
 * The incremental parser. The wire is `data: <json>\n\n` frames and
 * `: ping\n\n` comments today, but the format's other fields are
 * implemented because silently mis-parsing them later is expensive.
 * ---------------------------------------------------------------- */

describe('createSseDecoder', () => {
  const bytes = (text: string): Uint8Array => encoder.encode(text);

  it('dispatches only on a blank line and joins multi-line data with newlines', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(bytes('data: one\ndata: two\n'))).toEqual([]);
    expect(decoder.push(bytes('\n'))).toEqual([{ event: '', data: 'one\ntwo', id: null, retry: null }]);
  });

  it('reads \\r\\n and lone \\r line endings', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(bytes('data: crlf\r\n\r\n'))).toEqual([
      { event: '', data: 'crlf', id: null, retry: null },
    ]);
    expect(decoder.push(bytes('data: cr\r\r'))).toEqual([
      { event: '', data: 'cr', id: null, retry: null },
    ]);
  });

  it('survives a chunk boundary inside a CRLF pair', () => {
    const decoder = createSseDecoder();
    // The '\r' is the last byte of this chunk: treating it as a line end now
    // would emit a spurious blank line when the '\n' arrives.
    expect(decoder.push(bytes('data: split\r'))).toEqual([]);
    expect(decoder.push(bytes('\n\r\n'))).toEqual([
      { event: '', data: 'split', id: null, retry: null },
    ]);
  });

  it('survives a chunk boundary inside a multi-byte character', () => {
    const decoder = createSseDecoder();
    const payload = bytes('data: café\n\n');
    const cut = payload.indexOf(0xc3); // first byte of the two-byte 'é'
    expect(decoder.push(payload.slice(0, cut + 1))).toEqual([]);
    expect(decoder.push(payload.slice(cut + 1))).toEqual([
      { event: '', data: 'café', id: null, retry: null },
    ]);
  });

  it('ignores comment frames — the 25s server heartbeat is not an event', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(bytes(': ping\n\n'))).toEqual([]);
    expect(decoder.push(bytes(':\n\n'))).toEqual([]);
  });

  it('parses event, id and retry, stripping exactly one leading space', () => {
    const decoder = createSseDecoder();
    const messages = decoder.push(
      bytes('event: job.progress\nid: 42\nretry: 2500\ndata:  padded\n\n'),
    );
    expect(messages).toEqual([
      { event: 'job.progress', data: ' padded', id: '42', retry: 2500 },
    ]);
  });

  it('dispatches nothing for a frame that carries no data field', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(bytes('event: heartbeat\n\n'))).toEqual([]);
  });

  it('carries the last id forward and ignores a non-numeric retry', () => {
    const decoder = createSseDecoder();
    decoder.push(bytes('id: 7\ndata: first\n\n'));
    const messages = decoder.push(bytes('retry: soon\ndata: second\n\n'));
    expect(messages).toEqual([{ event: '', data: 'second', id: '7', retry: null }]);
  });

  it('strips a leading byte-order mark', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(bytes('﻿data: bom\n\n'))).toEqual([
      { event: '', data: 'bom', id: null, retry: null },
    ]);
  });

  it('treats a field line with no colon as an empty value', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(bytes('data\ndata: body\n\n'))).toEqual([
      { event: '', data: '\nbody', id: null, retry: null },
    ]);
  });
});

/* ---------------------------------------------------------------- *
 * The connection. SPEC §3.2: exactly one live connection per
 * workspace, no state mutation here, everything reported outward.
 * ---------------------------------------------------------------- */

describe('connectWorkspaceEvents', () => {
  it('opens exactly one stream for two subscribers on the same workspace', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = connectWorkspaceEvents('ws-1', { onEvent: first });
    const b = connectWorkspaceEvents('ws-1', { onEvent: second });
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/workspaces/ws-1/events');

    streams[0].push(frame(envelope()));
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    // The socket belongs to the workspace, not to a caller: one leaving does
    // not take the other's stream down.
    a.close();
    await settle();
    expect(streams[0].aborted()).toBe(false);
    streams[0].push(frame(envelope({ seq: 8 })));
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    b.close();
    await settle();
    expect(streams[0].aborted()).toBe(true);
  });

  it('aborts the previous workspace stream when a different workspace connects', async () => {
    connectWorkspaceEvents('ws-1', {});
    await settle();
    connectWorkspaceEvents('ws-2', {});
    await settle();

    expect(streams[0].aborted()).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/workspaces/ws-1/events',
      '/api/workspaces/ws-2/events',
    ]);
  });

  it('delivers envelopes in order, including the connected control frame', async () => {
    const onEvent = vi.fn();
    connectWorkspaceEvents('ws-1', { onEvent });
    await settle();

    streams[0].push(
      frame({ type: 'connected', workspaceId: 'ws-1', epoch: 'epoch-a', seq: 0 }) +
        frame(envelope({ seq: 1, progress: 10 })),
    );
    streams[0].push(frame(envelope({ seq: 2, progress: 20 })));
    await settle();

    expect(onEvent.mock.calls.map(([raw]) => (raw as Record<string, unknown>).seq)).toEqual([0, 1, 2]);
    // The `connected` frame carries the epoch/seq the store adopts on a cold
    // boot — filtering it here would hide the stream's resume position.
    expect((onEvent.mock.calls[0][0] as Record<string, unknown>).type).toBe('connected');
  });

  it('reports a malformed frame and keeps the stream alive', async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    connectWorkspaceEvents('ws-1', { onEvent, onError });
    await settle();

    streams[0].push('data: {not json\n\n');
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onEvent).not.toHaveBeenCalled();

    streams[0].push(frame(envelope()));
    await settle();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(streams).toHaveLength(1);
    expect(streams[0].aborted()).toBe(false);
  });

  it('fires onResync once on an epoch flip, before the envelope reaches the store', async () => {
    const order: string[] = [];
    const onResync = vi.fn((reason: string, _info: unknown) => order.push(`resync:${reason}`));
    const onEvent = vi.fn((raw: Record<string, unknown>) => order.push(`event:${String(raw.epoch)}`));
    connectWorkspaceEvents('ws-1', { onEvent, onResync });
    await settle();

    // First epoch ever seen is adoption, not a change: the app hydrates at boot
    // anyway, and `store.applyEvent` handles the unknown-epoch case itself.
    streams[0].push(frame(envelope({ epoch: 'epoch-a', seq: 1 })));
    await settle();
    expect(onResync).not.toHaveBeenCalled();

    streams[0].push(frame(envelope({ epoch: 'epoch-b', seq: 1 })));
    streams[0].push(frame(envelope({ epoch: 'epoch-b', seq: 2 })));
    await settle();

    expect(onResync).toHaveBeenCalledTimes(1);
    expect(onResync.mock.calls[0][0]).toBe('epoch-change');
    expect(onResync.mock.calls[0][1]).toMatchObject({ epoch: 'epoch-b', previousEpoch: 'epoch-a' });
    // §6.4 is ordered: drop ordering state, re-hydrate, adopt — the consumer
    // must learn about the flip before it merges the event that carried it.
    expect(order).toEqual([
      'event:epoch-a',
      'resync:epoch-change',
      'event:epoch-b',
      'event:epoch-b',
    ]);
  });

  it('reconnects after the stream ends and reports the reconnect re-sync on re-open', async () => {
    const onResync = vi.fn();
    const phases: string[] = [];
    connectWorkspaceEvents('ws-1', { onResync, onPhase: (phase: string) => phases.push(phase) });
    await settle();
    streams[0].push(frame(envelope()));
    await settle();

    streams[0].close();
    await settle();
    // Nothing re-hydrates while the stream is down — that would race the
    // outage instead of repairing it (§6.3 re-hydrates on re-open).
    expect(onResync).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);

    await advance(1000);
    expect(calls).toHaveLength(2);
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(onResync.mock.calls[0][0]).toBe('reconnect');
    expect(phases).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });

  it('escalates the delay on consecutive failures and resets it after a frame arrives', async () => {
    queue({ kind: 'error' }, { kind: 'error' }, { kind: 'stream' }, { kind: 'stream' });
    connectWorkspaceEvents('ws-1', {}, { jitter: () => 1 });
    await settle();
    expect(calls).toHaveLength(1);

    // 1st failure → 1000ms.
    await advance(999);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);

    // 2nd consecutive failure → 2000ms, not another 1000.
    await advance(1000);
    expect(calls).toHaveLength(2);
    await advance(1000);
    expect(calls).toHaveLength(3);

    // This connection produces a frame, so the next drop starts from the base
    // delay again — a healthy-but-flapping server must not inherit the backoff
    // of an outage that already ended.
    streams[0].push(frame(envelope()));
    await settle();
    streams[0].close();
    await settle();
    await advance(1000);
    expect(calls).toHaveLength(4);
  });

  it('keeps backing off when a connection opens but never sends anything', async () => {
    connectWorkspaceEvents('ws-1', {}, { jitter: () => 1 });
    await settle();
    streams[0].close();
    await settle();
    await advance(1000);
    expect(calls).toHaveLength(2);

    // Opened, said nothing, died: HTTP 200 alone must not reset the counter or
    // a dead-on-arrival server becomes a hot loop.
    streams[1].close();
    await settle();
    await advance(1000);
    expect(calls).toHaveLength(2);
    await advance(1000);
    expect(calls).toHaveLength(3);
  });

  it('backs off a non-OK response instead of giving up', async () => {
    queue({ kind: 'status', status: 503 });
    const onError = vi.fn();
    connectWorkspaceEvents('ws-1', { onError }, { jitter: () => 1 });
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain('503');
    await advance(1000);
    expect(calls).toHaveLength(2);
  });

  it('caps the delay at the configured maximum', async () => {
    queue(...Array.from({ length: 8 }, () => ({ kind: 'error' }) as Plan));
    connectWorkspaceEvents('ws-1', {}, { jitter: () => 1, initialRetryMs: 1000, maxRetryMs: 4000 });
    await settle();

    for (const delay of [1000, 2000, 4000, 4000, 4000]) {
      const before = calls.length;
      await advance(delay - 1);
      expect(calls).toHaveLength(before);
      await advance(1);
      expect(calls).toHaveLength(before + 1);
    }
  });

  it('aborts and reconnects when the heartbeat window passes in silence', async () => {
    connectWorkspaceEvents('ws-1', {}, { heartbeatMs: 60_000, jitter: () => 1 });
    await settle();

    // A half-open connection never errors on its own: without the watchdog the
    // client sits silently stale (§6.5 item 4's wedge).
    await advance(59_999);
    expect(streams[0].aborted()).toBe(false);
    await advance(1);
    expect(streams[0].aborted()).toBe(true);

    await advance(1000);
    expect(calls).toHaveLength(2);
  });

  it('lets a bare ping comment hold the connection open', async () => {
    connectWorkspaceEvents('ws-1', {}, { heartbeatMs: 60_000 });
    await settle();

    await advance(50_000);
    streams[0].push(': ping\n\n');
    await settle();
    await advance(50_000);

    expect(streams[0].aborted()).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('close() aborts the in-flight request and never reconnects', async () => {
    const subscription = connectWorkspaceEvents('ws-1', {});
    await settle();

    subscription.close();
    subscription.close(); // idempotent
    await settle();
    expect(streams[0].aborted()).toBe(true);

    await advance(60_000);
    expect(calls).toHaveLength(1);
  });

  it('sends the auth header when a token is configured and replays Last-Event-ID', async () => {
    connectWorkspaceEvents('ws-1', {}, { token: 'secret-token', jitter: () => 1 });
    await settle();
    expect(calls[0].headers.Accept).toBe('text/event-stream');
    expect(calls[0].headers.Authorization).toBe('Bearer secret-token');
    expect(calls[0].headers['Last-Event-ID']).toBeUndefined();

    streams[0].push('id: 99\ndata: {"type":"job.progress","epoch":"epoch-a","seq":9}\n\n');
    await settle();
    streams[0].close();
    await settle();
    await advance(1000);

    expect(calls).toHaveLength(2);
    expect(calls[1].headers['Last-Event-ID']).toBe('99');
  });

  it('does not let one subscriber throwing take the stream down', async () => {
    const onError = vi.fn();
    const healthy = vi.fn();
    connectWorkspaceEvents('ws-1', {
      onEvent: () => {
        throw new Error('render blew up');
      },
      onError,
    });
    connectWorkspaceEvents('ws-1', { onEvent: healthy });
    await settle();

    streams[0].push(frame(envelope()));
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(streams[0].aborted()).toBe(false);
  });

  it('reports the closed phase and forgets the workspace so a later connect reopens', async () => {
    const phases: string[] = [];
    const subscription = connectWorkspaceEvents('ws-1', {
      onPhase: (phase: string) => phases.push(phase),
    });
    await settle();
    subscription.close();
    await settle();
    expect(phases).toEqual(['connecting', 'open', 'closed']);

    connectWorkspaceEvents('ws-1', {});
    await settle();
    expect(calls).toHaveLength(2);
  });
});
