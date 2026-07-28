# UNIT-B3 — `src/protocol/events.ts` (detailed plan)

PLAN.md flags B3 for its own plan because it pairs with B2: `store.ts` owns the
merge, `events.ts` owns the only stream that feeds it. Between them they replace
three separate SSE implementations (`api/client.js`
`subscribeWorkspaceEvents`/`subscribeViaFetch`/`waitViaSse`, plus
`hooks/useWorkspaceEvents.js` and `hooks/useJobRunner.js` polling), which is
where the F3-H1 leak class came from. This document is the plan; SPEC.md wins on
any wording difference.

## Goal

One module that owns the workspace event stream end to end: open, parse,
heartbeat-watch, reconnect with backoff, detect epoch changes, and hand parsed
envelopes to `store.ts` — while owning **no state the app renders** and holding
**exactly one live connection per workspace**.

Cited: SPEC §3.1 (sanctioned network modules; `events.ts` is the fetch-stream SSE
reader), §3.2 (events row + forbidden dependencies), §6.3 (reconnect/epoch
re-hydrate), §6.4 (S1 epoch versioning, the client rule), §6.5 item 4 (restart
resilience), §7.2 (the parser/reconnect unit suite including a simulated epoch
flip).

Inert until F1: nothing imports it yet. `store.ts` is its only sanctioned
importer (§3.2), and that wiring lands with the shell (D-track), not here.

## Interfaces this unit reads (not changed)

- **Endpoint**: `GET /api/workspaces/:id/events`, URL built by
  `api.workspaceEventsUrl(id)` in `api/client.js` — §3.2 keeps endpoint paths
  there, so this module never concatenates one.
- **Wire format** (`server/src/routes/workspaces.ts`): `data: <json>\n\n` frames
  and `: ping\n\n` comment frames every 25 s. No `event:`, `id:` or `retry:`
  fields are emitted today; the parser implements them anyway because they are
  part of the format and silently mis-parsing them later is the expensive
  failure.
- **First frame**: `{ type: 'connected', workspaceId, version, epoch, seq,
  updatedAt }` — sent immediately on open, so it doubles as the signal that a
  connection is genuinely alive.
- **Envelope** (`WorkspaceEvent`, A2): `{ type, workspaceId, fileId, jobId,
  status, stage, progress, message, updatedAt, version, epoch, seq, file, job }`.
  Emitted types: `connected`, `file.created`, `file.updated`, `file.deleted`,
  `job.created`, `job.progress`, `job.updated`.
- **Consumer** (`store.ts`, merged): `applyEvent(raw)` for every envelope and
  `hydrate()` for a re-sync. The intended wiring, for the unit that does it:

  ```ts
  connectWorkspaceEvents(workspaceId, {
    onEvent: applyEvent,
    onResync: () => { void hydrate(); },
  });
  ```

## Design decisions (the ones a reviewer should challenge)

1. **Callbacks out, never an import of `store.ts`.** §3.2 makes `store.ts` the
   only module allowed to import this one, so importing it back would be a
   cycle (§3.2 forbids cycles outright). Handlers are injected; this module
   mutates nothing (§3.2 "MUST NOT mutate state itself").
2. **Fetch-stream always — never `EventSource`.** §3.2 names this module the
   fetch-stream parser. The legacy client branched (`EventSource` without a
   token, fetch with one) and therefore had two parsers with different bugs;
   one path is the point. Fetch also carries `Authorization`, which
   `EventSource` cannot, so the token build stops being a special case.
3. **A subscriber registry, not a connection per caller.** `connect` for a
   workspace that is already connected attaches to the live connection and
   refcounts; the socket closes when the last subscriber leaves. Connecting to a
   *different* workspace closes the previous one first — the app holds one
   workspace at a time, and the old stream would otherwise leak (F3-H1). This is
   what makes "exactly one live connection per workspace" structural rather than
   a rule callers must remember.
4. **Both re-sync triggers are reported, and they are distinguishable.**
   §6.3 requires a wholesale re-hydrate on **reconnect** *and* on **epoch
   change**. `onResync` carries which one, plus the epoch pair. Reconnect fires
   on re-open, not on disconnect: hydrating while the stream is still down would
   race the outage rather than repair it.
5. **Epoch change is reported before the envelope that carried it.** §6.4's
   client rule is ordered — drop ordering state, re-hydrate, adopt the new
   epoch — so the consumer must learn about the flip before it merges the event.
   `store.ts` also detects the flip itself (`applyEvent`), so a consumer wiring
   both paths gets one re-hydrate, not two: `requestResync()` collapses while a
   load is in flight.
6. **The `connected` control frame is forwarded like any other envelope.** It
   carries `{ epoch, seq }`, and `store.ts` uses exactly that to adopt an epoch
   on a cold boot. Filtering it here would hide the stream's resume position.
7. **Backoff resets on the first parsed message, not on HTTP 200.** A server
   that accepts a connection and immediately drops it would otherwise reset the
   attempt counter forever and hot-loop. The server's `connected` frame arrives
   on open, so a healthy connection still resets on its first read.
8. **A heartbeat watchdog, armed by any traffic including comments.** The server
   pings every 25 s; a stream that has produced nothing — data or comment — for
   60 s is treated as dead, aborted, and reconnected. Without this, a
   half-open TCP connection (laptop sleep, dropped Wi-Fi) leaves the client
   silently stale with no error to react to, which is §6.5 item 4's wedge.
9. **Non-OK responses back off like any other failure.** A 404/503 during a
   server restart is exactly the §6.5 item 4 case; giving up would wedge the
   client until reload. The delay caps at 30 s, so a permanently-gone workspace
   costs one request per 30 s while `store.ts` surfaces the real error from its
   own hydrate path.
10. **A malformed frame is dropped, not fatal.** One unparseable JSON payload
    reports through `onError` and the loop continues — killing the stream would
    turn a single bad frame into a full re-hydrate.

## Ordered steps

1. Write the test suite first (SPEC §7.2 names it: parser + reconnect + a
   simulated epoch flip). No characterization tests exist to preserve — the
   three modules this supersedes have none (AUDIT §5 PR-5/PR-6).
2. Implement the incremental SSE decoder (`createSseDecoder`): line splitting
   across chunk boundaries, `\n` / `\r\n` / lone `\r`, comment frames, multi-line
   `data`, `event` / `id` / `retry` fields, dispatch on blank line only.
3. Implement the connection: fetch with `Accept: text/event-stream` (+
   `Authorization` when `VITE_API_TOKEN` is set, + `Last-Event-ID` when the
   server has sent an id), read loop, watchdog, backoff, epoch tracking.
4. Implement the registry (`connectWorkspaceEvents` / handle `.close()` /
   `closeAllWorkspaceEvents` for teardown and test isolation).
5. Typecheck (`src/protocol/` is in `tsconfig.client.json`), then the four gates.

## Risks

- **Fake-timer + stream interleaving in tests.** Backoff and the watchdog are
  timer-driven while the read loop is microtask-driven; `advanceTimersByTimeAsync`
  is required, and a test that uses the sync variant will pass for the wrong
  reason. Every timing test asserts an observable effect (a second `fetch` call,
  an aborted signal), never an internal counter.
- **Reconnect storms.** Bounded by exponential backoff with jitter capped at
  30 s, and by the refcounted registry (N subscribers still mean one socket).
- **Double re-hydrate on an epoch flip** if a consumer wires `onResync` *and*
  relies on `store.applyEvent`'s own detection. Collapsed by `requestResync()`
  in `store.ts`; documented at the wiring site rather than solved by weakening
  either detector.
- **Node-vs-browser stream differences.** The decoder takes bytes and is tested
  with chunk boundaries split mid-line, mid-CRLF and mid-multibyte-character, so
  the browser's chunking cannot surprise it.

## Test plan (`src/tests/protocol-events.test.ts`)

Parser:
- multi-line `data:` frames join with `\n`; a frame with no `data` field
  dispatches nothing.
- `\n`, `\r\n` and lone `\r` line endings; a chunk boundary falling inside a
  `\r\n` pair and inside a multi-byte character.
- comment frames (`: ping`) yield no message.
- `event:`, `id:`, `retry:` parsed; one leading space after the colon stripped,
  further spaces kept.
- no dispatch until the blank line arrives.

Connection:
- one `fetch` for two subscribers on the same workspace; the socket survives one
  subscriber closing and dies with the last.
- connecting to a second workspace aborts the first connection.
- envelopes reach `onEvent` in order; a malformed frame reports and is skipped.
- **epoch flip**: a new epoch fires `onResync('epoch-change')` exactly once and
  strictly before the envelope reaches `onEvent`.
- stream end → reconnect after the backoff delay, `onResync('reconnect')` on the
  re-open; a second consecutive failure waits longer than the first; the counter
  resets after a frame is received.
- silence past the heartbeat window aborts and reconnects.
- `close()` stops the loop: no further `fetch`, and the in-flight request is
  aborted.
- `Authorization` sent when a token is configured; `Last-Event-ID` replayed after
  the server sends an `id:`.
