# Unit 6 (B3) — `src/protocol/events.ts`

- **Date:** 2026-07-27
- **Branch:** `unit-6-b3-protocol-events`
- **Outcome:** pending merge (this file is completed at step 9)

## Delivered

| File | What |
|---|---|
| `src/protocol/events.ts` | The single workspace event-stream owner: byte-level SSE parser, heartbeat watchdog, reconnect with jittered exponential backoff, epoch detection, and a refcounted one-connection-per-workspace registry. |
| `src/tests/protocol-events.test.ts` | 26 tests — the SPEC §7.2 "parser/reconnect suite incl. a simulated epoch flip", written before the implementation. |
| `src/tests/protocol-events-handshake.test.ts` | Regression test proving a fetch stalled before response headers is watchdog-aborted and reconnected. |
| `src/tests/protocol-events-review.test.ts` | Regression tests for per-subscription refcounts and malformed-frame backoff. |
| `docs/plans/UNIT-B3.md` | The detailed plan PLAN.md requires for this unit (flagged, pairs with B2). |

Nothing imports the module yet, as PLAN requires (`store.ts` is its only sanctioned
importer per SPEC §3.2; that wiring lands with the D-track shell).

## Design decisions worth naming

- **Callbacks out, never an import of `store.ts`.** §3.2 makes `store.ts` this
  module's only permitted importer, so importing back would be the cycle §3.2
  forbids. `onEvent` / `onResync` / `onPhase` / `onError` are injected.
- **Fetch-stream always, never `EventSource`.** §3.2 specifies the fetch-stream
  parser. The legacy client branched on whether a token existed and therefore
  shipped two parsers with different bugs; one path is the point, and fetch is
  also the only one that can carry `Authorization`.
- **One `active` connection, refcounted subscribers.** A second subscriber for
  the same workspace attaches to the live socket; the socket dies with the last
  subscriber. A different workspace closes the previous connection first. This
  is what makes "exactly one live connection per workspace" structural rather
  than a rule callers must remember (the F3-H1 leak class).
- **Backoff resets on the first parsed frame, not on HTTP 200.** A server that
  accepts a connection and immediately drops it would otherwise reset the
  counter forever and hot-loop.
- **The watchdog is armed by any traffic, comments included.** The server's 25 s
  `: ping` is exactly the evidence a half-open socket cannot produce; without
  it a sleeping laptop's dead connection never errors and the mirror silently
  rots (§6.5 item 4).
- **First epoch is adoption, not a change.** Reporting it would re-hydrate every
  cold start twice; `store.applyEvent` already treats an unknown epoch like a
  changed one. A genuine flip reports `onResync('epoch-change')` *before* the
  envelope reaches the consumer, because §6.4's client rule is ordered.

## Gate 1 — `npm run test:client` + `npm run typecheck` — PASS

```
 Test Files  12 passed (12)
      Tests  252 passed (252)
TESTCLIENT=0

> tsc -p server/tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
TYPECHECK=0
```

### One test-file correction, and how it was made

The suite as first written failed `typecheck` (not vitest) on a single line:

```
src/tests/protocol-events.test.ts(346,35): error TS2493:
Tuple type '[reason: string]' of length '1' has no element at index '1'.
```

The spy was declared `vi.fn((reason: string) => …)` while line 346 asserts on its
**second** argument. `.claude/hooks/scope-guard.mjs` rule 3 blocks every edit to
an existing test file, with no exemption for one the current unit just authored,
so the fix was **explicitly authorised by the user** and applied as a
delete-and-recreate through a verified copy rather than a hand-retyped file:

```
-    const onResync = vi.fn((reason: string) => order.push(`resync:${reason}`));
+    const onResync = vi.fn((reason: string, _info: unknown) => order.push(`resync:${reason}`));
```

`diff -u` against the pre-change copy confirms that is the only differing line.
The change **adds** type coverage — the assertion on `calls[0][1]` is precisely
what forces the second parameter to exist — and weakens no assertion.

### Non-vacuity of the suite

The suite passed on its first run against the implementation, so five targeted
mutations were applied to `events.ts` and the file restored afterwards:

```
events.ts sha256 before: 772e1a01043c5d3cf89cfb0edbb76ef96607857b527a302ad9485a48c692b57e

=== CR at a chunk end is held back instead of terminating the line
suite failed: true
  Tests  1 failed | 25 passed (26)
  caught by: reads \r\n and lone \r line endings

=== backoff counter resets on HTTP 200 instead of on a received frame
suite failed: true
  Tests  1 failed | 25 passed (26)
  caught by: keeps backing off when a connection opens but never sends anything

=== epoch-change reported AFTER the envelope is delivered
suite failed: true
  Tests  1 failed | 25 passed (26)
  caught by: fires onResync once on an epoch flip, before the envelope reaches the store

=== watchdog not re-armed by incoming traffic
suite failed: true
  Tests  1 failed | 25 passed (26)
  caught by: lets a bare ping comment hold the connection open

=== every subscriber opens its own connection (no registry)
suite failed: true
  Tests  2 failed | 24 passed (26)
  caught by: opens exactly one stream for two subscribers on the same workspace
  caught by: does not let one subscriber throwing take the stream down

events.ts sha256 after restore: 772e1a01043c5d3cf89cfb0edbb76ef96607857b527a302ad9485a48c692b57e
byte-for-byte identical: true
```

Each mutation is caught by exactly the test that claims that behavior — the
suite is sensitive per-rule, not blunt.

## Gate 2 — `npm run visual:checks` — PASS

```
PASS    token-purity (§4.6) [2 file(s)]
PASS    motion-purity (§5.2/§5.3) [1 file(s)]
PASS    contrast (WCAG AA on §4.1 tokens)
CHECKS=0
```

No PENDING lines; nothing in this unit is a check target.

## Gate 3 — capture + diff — PASS

```
[visual:capture] captured=1 missing=268 → visual\captures
CAPTURE=0
[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s) accounted for.
DIFF=0
```

No baseline accepted: B3 renders nothing (the module is imported by nothing), so
it introduces no capture target. The single capture is the old client's home,
which this unit neither builds nor changes; the 268 missing targets belong to
later units.

## Gate 4 — visual judge — not applicable

B3 produces no UI: it is a TypeScript protocol module with no render site, so
zero captures belong to it and there is no artifact to judge. Nothing was given
to the judge and no verdict was fabricated — consistent with units 1–5, whose
non-rendering deliverables were recorded the same way.

## Step 7 — spec review

The first independent review returned `FIX-THEN-SHIP` with three findings:

1. **High:** the watchdog started only after `fetch()` returned headers, so a
   stalled HTTP handshake could wedge forever.
2. **Medium:** `Set<WorkspaceEventHandlers>` collapsed two subscriptions that
   shared the same stable handlers object, breaking refcount semantics.
3. **Medium:** a malformed JSON frame reset the reconnect attempt counter,
   preventing exponential backoff.

All three were fixed and pinned by new regression tests. The full gate suite
was rerun after the fixes:

```
Test Files  12 passed (12)
Tests       252 passed (252)
typecheck=0 visual_checks=0 capture=0 diff=0
```

The reviewer then re-read the complete diff and reported verbatim:

```
No correctness or requirement gaps found.

Verdict: SHIP
```
