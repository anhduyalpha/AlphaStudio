/**
 * protocol/events.ts — SPEC §3.2 events row.
 *
 * THE single owner of the workspace event stream: open, parse, heartbeat-watch,
 * reconnect with backoff, detect epoch changes (§6.4) — and report all of it
 * outward. It replaces three separate SSE paths (`api/client.js`
 * `subscribeWorkspaceEvents`/`subscribeViaFetch`/`waitViaSse`,
 * `hooks/useWorkspaceEvents.js`, `hooks/useJobRunner.js`), which between them
 * could hold several live streams for one workspace — the F3-H1 leak class that
 * dies with this module's one-connection-per-workspace registry.
 *
 * Two rules give this module its shape:
 *  - **It owns no rendered state** (§3.2). Envelopes and re-sync requests leave
 *    through handlers; `store.ts` decides what any of it means.
 *  - **It never imports `store.ts`.** §3.2 makes `store.ts` this module's only
 *    sanctioned importer, so importing back would be the cycle §3.2 forbids.
 *
 * Intended wiring, for the unit that connects the shell:
 *
 * ```ts
 * connectWorkspaceEvents(workspaceId, {
 *   onEvent: applyEvent,
 *   onResync: () => { void hydrate(); },
 * });
 * ```
 *
 * `store.applyEvent` detects an epoch flip on its own too; its `requestResync()`
 * collapses the two into one re-hydrate. Design rationale for the non-obvious
 * decisions lives in `docs/plans/UNIT-B3.md`.
 */

// api/client.js is untyped JavaScript by design — SPEC §3.1's language rule
// makes only src/protocol/ and src/hubs/ TypeScript. Same single-suppression
// boundary store.ts/contracts.ts use; the shape is re-declared so nothing sees
// `any`. §3.2 keeps endpoint paths in client.js, so the URL comes from there
// rather than being concatenated here.
// @ts-expect-error TS7016: untyped JS module, intentionally so.
import { api as untypedApi } from '../api/client.js';

const client = untypedApi as {
  workspaceEventsUrl: (id: string) => string;
};

/**
 * Build-time auth token (§ security boundary: set only when HOST is non-loopback).
 * `EventSource` cannot carry a header, which is half of why §3.2 specifies a
 * fetch-stream reader; here it is just another request header.
 */
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const DEFAULT_API_TOKEN = String(viteEnv.VITE_API_TOKEN ?? '').trim();

/** The server pings every 25s; silence for this long means the socket is dead. */
const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_INITIAL_RETRY_MS = 1_000;
const DEFAULT_MAX_RETRY_MS = 30_000;

/* ---------------------------------------------------------------- *
 * The incremental SSE parser.
 * ---------------------------------------------------------------- */

/** One dispatched `text/event-stream` frame. `id` is the stream's last id. */
export type SseMessage = {
  event: string;
  data: string;
  id: string | null;
  retry: number | null;
};

export type SseDecoder = {
  /** Feed one network chunk; returns every frame it completed. */
  push: (chunk: Uint8Array) => SseMessage[];
};

/**
 * Byte-level parser for `text/event-stream`.
 *
 * The server only emits `data:` frames and `: ping` comments today, but the
 * whole field set is implemented: a parser that silently mis-reads `event:`,
 * `id:` or `retry:` the day one appears is the expensive kind of shortcut. It
 * takes bytes rather than strings so a chunk boundary inside a multi-byte
 * character is the `TextDecoder`'s problem, not a corrupted payload.
 */
export function createSseDecoder(): SseDecoder {
  // Default `ignoreBOM: false` strips a leading byte-order mark, as the format
  // requires; `{ stream: true }` holds partial characters across chunks.
  const textDecoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let eventName = '';
  let retry: number | null = null;
  let lastEventId: string | null = null;
  let sawData = false;
  /**
   * A chunk that ended on a bare CR terminated its line immediately; if the
   * next chunk opens with LF it is the second half of that CRLF, not an empty
   * line. Holding the CR back instead would stall a server that really does
   * use lone CRs until its next write.
   */
  let skipLeadingLf = false;

  function dispatch(out: SseMessage[]): void {
    // A frame with no `data` field dispatches nothing (a bare `event:` or a
    // stray blank line), but it still resets the frame-scoped fields.
    if (sawData) {
      out.push({ event: eventName, data: dataLines.join('\n'), id: lastEventId, retry });
    }
    dataLines = [];
    eventName = '';
    retry = null;
    sawData = false;
  }

  function handleLine(line: string, out: SseMessage[]): void {
    if (line === '') {
      dispatch(out);
      return;
    }
    if (line.startsWith(':')) return; // comment — the heartbeat lands here
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // exactly one space
    switch (field) {
      case 'data':
        dataLines.push(value);
        sawData = true;
        break;
      case 'event':
        eventName = value;
        break;
      case 'id':
        // Taken as-is. The server emits no ids today, so `Last-Event-ID` exists
        // purely so that a future one is replayed on reconnect rather than lost.
        lastEventId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
      default:
        break; // unknown fields are ignored, not an error
    }
  }

  return {
    push(chunk: Uint8Array): SseMessage[] {
      const out: SseMessage[] = [];
      buffer += textDecoder.decode(chunk, { stream: true });
      if (skipLeadingLf) {
        skipLeadingLf = false;
        if (buffer.startsWith('\n')) buffer = buffer.slice(1);
      }

      for (;;) {
        const lf = buffer.indexOf('\n');
        const cr = buffer.indexOf('\r');
        if (lf === -1 && cr === -1) break;

        let end: number;
        let next: number;
        if (cr !== -1 && (lf === -1 || cr < lf)) {
          end = cr;
          if (cr === buffer.length - 1) {
            next = cr + 1;
            skipLeadingLf = true; // an LF may open the next chunk
          } else {
            next = buffer[cr + 1] === '\n' ? cr + 2 : cr + 1;
          }
        } else {
          end = lf;
          next = lf + 1;
        }

        const line = buffer.slice(0, end);
        buffer = buffer.slice(next);
        handleLine(line, out);
      }
      return out;
    },
  };
}

/* ---------------------------------------------------------------- *
 * Public connection shapes.
 * ---------------------------------------------------------------- */

export type ConnectionPhase = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Why the consumer should re-hydrate wholesale (SPEC §6.3). */
export type ResyncReason = 'reconnect' | 'epoch-change';

export type ResyncInfo = {
  epoch: string | null;
  previousEpoch: string | null;
  /** Consecutive failed attempts before this connection opened. */
  attempt: number;
};

export type WorkspaceEventHandlers = {
  /** One parsed envelope, including the `connected` control frame. */
  onEvent?: (envelope: Record<string, unknown>) => void;
  onResync?: (reason: ResyncReason, info: ResyncInfo) => void;
  onPhase?: (phase: ConnectionPhase) => void;
  onError?: (error: Error) => void;
};

export type ConnectionOptions = {
  /** Silence (data or comment) this long means the socket is dead. */
  heartbeatMs?: number;
  initialRetryMs?: number;
  maxRetryMs?: number;
  /** Returns 0–1; the delay keeps 50–100% of its exponential value. */
  jitter?: () => number;
  /** Overrides the build-time `VITE_API_TOKEN`. */
  token?: string | null;
};

export type EventSubscription = {
  readonly workspaceId: string;
  close: () => void;
};

type Connection = {
  workspaceId: string;
  url: string;
  subscribers: Set<WorkspaceEventHandlers>;
  heartbeatMs: number;
  initialRetryMs: number;
  maxRetryMs: number;
  jitter: () => number;
  token: string;
  controller: AbortController | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryResolve: (() => void) | null;
  /** Server-supplied `retry:` value, once one ever arrives. */
  retryHintMs: number | null;
  /** Consecutive failures since the last frame was received. */
  attempt: number;
  epoch: string | null;
  lastEventId: string | null;
  everOpened: boolean;
  closed: boolean;
};

/**
 * The one live connection. Not a map keyed by workspace: the app holds exactly
 * one workspace at a time, so a second workspace means the first is gone and
 * its stream must go with it (leaving it open is the F3-H1 leak).
 */
let active: Connection | null = null;

/* ---------------------------------------------------------------- *
 * Emitting — a handler that throws is that subscriber's problem and
 * must never take the shared stream down with it.
 * ---------------------------------------------------------------- */

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' && value ? value : 'Workspace event stream error');
}

function reportTo(subscriber: WorkspaceEventHandlers, error: Error): void {
  try {
    subscriber.onError?.(error);
  } catch {
    /* a failing error handler is where reporting stops */
  }
}

function report(conn: Connection, error: unknown): void {
  const wrapped = toError(error);
  for (const subscriber of [...conn.subscribers]) reportTo(subscriber, wrapped);
}

function emitPhase(conn: Connection, phase: ConnectionPhase, extra?: WorkspaceEventHandlers): void {
  const targets = extra ? [...conn.subscribers, extra] : [...conn.subscribers];
  for (const subscriber of targets) {
    try {
      subscriber.onPhase?.(phase);
    } catch (error) {
      reportTo(subscriber, toError(error));
    }
  }
}

function emitResync(conn: Connection, reason: ResyncReason, previousEpoch: string | null): void {
  const info: ResyncInfo = { epoch: conn.epoch, previousEpoch, attempt: conn.attempt };
  for (const subscriber of [...conn.subscribers]) {
    try {
      subscriber.onResync?.(reason, info);
    } catch (error) {
      reportTo(subscriber, toError(error));
    }
  }
}

function emitEvent(conn: Connection, envelope: Record<string, unknown>): void {
  for (const subscriber of [...conn.subscribers]) {
    try {
      subscriber.onEvent?.(envelope);
    } catch (error) {
      reportTo(subscriber, toError(error));
    }
  }
}

/* ---------------------------------------------------------------- *
 * Timers.
 * ---------------------------------------------------------------- */

function clearWatchdog(conn: Connection): void {
  if (conn.watchdog) clearTimeout(conn.watchdog);
  conn.watchdog = null;
}

/**
 * Re-armed by ANY traffic, comments included — the 25s `: ping` is exactly the
 * evidence a half-open connection cannot produce. Without this a sleeping
 * laptop's dead socket never errors and the mirror silently rots (§6.5 item 4).
 */
function armWatchdog(conn: Connection): void {
  clearWatchdog(conn);
  conn.watchdog = setTimeout(() => {
    conn.watchdog = null;
    conn.controller?.abort();
  }, conn.heartbeatMs);
}

function backoffDelay(conn: Connection): number {
  const base = conn.retryHintMs ?? conn.initialRetryMs;
  const steps = Math.max(0, conn.attempt - 1);
  const exponential = Math.min(conn.maxRetryMs, base * 2 ** steps);
  const raw = Number(conn.jitter());
  const bounded = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
  return Math.max(0, Math.round(exponential * (0.5 + 0.5 * bounded)));
}

/** Cancellable sleep: `close()` resolves it so the loop can notice and exit. */
function sleep(conn: Connection, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    conn.retryResolve = resolve;
    conn.retryTimer = setTimeout(() => {
      conn.retryTimer = null;
      conn.retryResolve = null;
      resolve();
    }, ms);
  });
}

/* ---------------------------------------------------------------- *
 * The read loop.
 * ---------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function handleMessage(conn: Connection, message: SseMessage): void {
  if (message.id) conn.lastEventId = message.id;
  if (message.retry !== null) conn.retryHintMs = message.retry;
  if (!message.data) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(message.data);
  } catch (error) {
    // One bad frame is dropped, never fatal: killing the stream would turn it
    // into a full re-hydrate.
    report(conn, new Error(`Unparseable workspace event frame: ${toError(error).message}`));
    return;
  }
  if (!isRecord(parsed)) {
    report(conn, new Error('Workspace event frame was not an object'));
    return;
  }

  // Only a valid parsed envelope proves the application stream is healthy.
  // HTTP 200 or malformed frames must not reset the failure count, otherwise a
  // server that repeatedly emits garbage and closes can hot-loop forever.
  conn.attempt = 0;
  const epoch = typeof parsed.epoch === 'string' && parsed.epoch ? parsed.epoch : null;
  if (epoch && epoch !== conn.epoch) {
    const previousEpoch = conn.epoch;
    conn.epoch = epoch;
    // The FIRST epoch is adoption, not a change: the app hydrates at boot
    // anyway, and `store.applyEvent` handles the unknown-epoch case itself
    // (§6.4). Reporting it here would re-hydrate every cold start twice.
    // §6.4 is ordered — drop ordering state, re-hydrate, adopt — so the
    // consumer hears about the flip before it merges the event that carried it.
    if (previousEpoch !== null) emitResync(conn, 'epoch-change', previousEpoch);
  }

  emitEvent(conn, parsed);
}

/** One connection attempt: open, then read until it ends or fails. */
async function readOnce(conn: Connection): Promise<void> {
  const controller = new AbortController();
  conn.controller = controller;

  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (conn.token) headers.Authorization = `Bearer ${conn.token}`;
  if (conn.lastEventId) headers['Last-Event-ID'] = conn.lastEventId;

  // Start the watchdog before fetch: a TCP/TLS request can hang before response
  // headers arrive, and that half-open handshake must reconnect just like a
  // stream that goes silent after opening.
  armWatchdog(conn);
  try {
    const response = await globalThis.fetch(conn.url, {
      headers,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      // A 404/503 mid-restart is the §6.5 item 4 case, not a reason to give up:
      // it backs off like any other failure and the delay caps out.
      throw new Error(`Workspace event stream failed with HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('Workspace event stream returned no body');

    const reconnected = conn.everOpened;
    conn.everOpened = true;
    emitPhase(conn, 'open');
    // §6.3 re-hydrates on re-open, not on drop: hydrating while the stream is
    // still down races the outage instead of repairing it.
    if (reconnected) emitResync(conn, 'reconnect', conn.epoch);

    armWatchdog(conn);
    const reader = response.body.getReader();
    const decoder = createSseDecoder();
    try {
      while (!conn.closed) {
        const { done, value } = await reader.read();
        if (done) return; // server closed — the caller reconnects
        armWatchdog(conn);
        if (!value) continue;
        for (const message of decoder.push(value)) handleMessage(conn, message);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  } finally {
    clearWatchdog(conn);
    if (conn.controller === controller) conn.controller = null;
  }
}

async function runLoop(conn: Connection): Promise<void> {
  emitPhase(conn, 'connecting');
  while (!conn.closed) {
    try {
      await readOnce(conn);
      if (conn.closed) break;
      report(conn, new Error('Workspace event stream closed by the server'));
    } catch (error) {
      if (conn.closed) break;
      report(conn, error);
    }
    if (conn.closed) break;
    conn.attempt += 1;
    emitPhase(conn, 'reconnecting');
    await sleep(conn, backoffDelay(conn));
  }
}

/* ---------------------------------------------------------------- *
 * Registry — what makes "exactly one live connection per workspace"
 * (SPEC §3.2) structural instead of a rule callers must remember.
 * ---------------------------------------------------------------- */

function closeConnection(conn: Connection, farewell?: WorkspaceEventHandlers): void {
  if (conn.closed) return;
  conn.closed = true;
  if (active === conn) active = null;
  clearWatchdog(conn);
  if (conn.retryTimer) clearTimeout(conn.retryTimer);
  conn.retryTimer = null;
  const wake = conn.retryResolve;
  conn.retryResolve = null;
  conn.controller?.abort();
  conn.controller = null;
  emitPhase(conn, 'closed', farewell);
  wake?.(); // let a sleeping loop notice `closed` and return
}

/**
 * Subscribe to a workspace's event stream.
 *
 * A second subscriber for the same workspace attaches to the live connection
 * (one socket, N listeners); the socket closes when the last one leaves. A
 * different workspace closes the previous connection first. Options belong to
 * the connection, so a later subscriber's options are ignored — the first
 * caller owns the timings for as long as the socket lives.
 */
export function connectWorkspaceEvents(
  workspaceId: string,
  handlers: WorkspaceEventHandlers = {},
  options: ConnectionOptions = {},
): EventSubscription {
  if (active && active.workspaceId !== workspaceId) closeConnection(active);

  let conn = active;
  const fresh = !conn;
  if (!conn) {
    conn = {
      workspaceId,
      url: client.workspaceEventsUrl(workspaceId),
      subscribers: new Set(),
      heartbeatMs: options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      initialRetryMs: options.initialRetryMs ?? DEFAULT_INITIAL_RETRY_MS,
      maxRetryMs: options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS,
      jitter: options.jitter ?? Math.random,
      token: String(options.token ?? DEFAULT_API_TOKEN ?? '').trim(),
      controller: null,
      watchdog: null,
      retryTimer: null,
      retryResolve: null,
      retryHintMs: null,
      attempt: 0,
      epoch: null,
      lastEventId: null,
      everOpened: false,
      closed: false,
    };
    active = conn;
  }

  const connection = conn;
  // Each connect call is one subscription even when callers intentionally
  // share the same stable handlers object. A Set of that object directly would
  // collapse two subscriptions and let the first close tear down the socket.
  const subscriber = { ...handlers };
  connection.subscribers.add(subscriber);
  // Registered before the loop starts so the first phase reaches this caller.
  if (fresh) void runLoop(connection);

  let released = false;
  return {
    workspaceId,
    close(): void {
      if (released) return;
      released = true;
      connection.subscribers.delete(subscriber);
      if (connection.subscribers.size === 0 && !connection.closed) {
        // `handlers` is passed along so the caller that closed the last
        // subscription still hears the resulting `closed` phase.
        closeConnection(connection, subscriber);
      }
    },
  };
}

/** Tear down the live connection — workspace teardown and test isolation. */
export function closeAllWorkspaceEvents(): void {
  if (active) closeConnection(active);
}
