# Evidence — Unit 4 (B1) `src/protocol/contracts.ts`

- Date: 2026-07-26
- Branch: `unit-4-b1-protocol-contracts`
- SPEC: §3.2 contracts row — "Fetch (via `client.js`) + cache
  `/api/capabilities`; expose accept-lists, gated ops, quality aliases, engine
  availability. MUST NOT contain fallback format/op literals. If capabilities
  are unreachable, hubs render their capability-gap state — the client never
  invents a contract."

## Changes

- `src/protocol/contracts.ts` (new, TypeScript, inert until the flip) —
  fetch + cache of `/api/capabilities` through `api/client.js` only, a strict
  parser, and gap-aware selectors.

The design decision worth stating: every selector returns a
`ContractLookup<T> = {available:true, value:T} | {available:false, reason}`
rather than a bare value. That is what makes "the client never invents a
contract" enforceable — **"unrestricted" and "we do not know" are different
answers and must never collapse into the same `null`**. `acceptListFor('security')`
returns `{available:true, value:null}` (genuinely unrestricted); the same call
before load returns `{available:false, reason:'Capabilities have not been
loaded yet'}`, which is the hub's capability-gap state.

Other decisions:
- The parser rejects a payload whose `acceptLists`, `gatedOps` or `quality`
  section is missing or malformed — the state becomes `unavailable` rather than
  a half-trusted contract.
- `acceptAttributeFor()` builds the file-input filter from A3's **`uploadable`**
  extensions, not `extensions`, so the client can never offer a file that
  `POST /api/uploads` will refuse.
- `resolveQualityPreset()` resolves through the server's published aliases and
  falls back to the server's published `default`. No preset name is written in
  this module.
- Concurrent `loadContracts()` calls share one in-flight request; a failure
  resolves to `unavailable` instead of throwing, because the caller's job is to
  render the gap, not to catch.

### The one suppression, and why

`tsconfig.client.json` is `strict` with no `allowJs`, so importing the untyped
`src/api/client.js` from the TS protocol island fails:

```
src/protocol/contracts.ts(1,21): error TS7016: Could not find a declaration file
for module '../api/client.js'. '.../src/api/client.js' implicitly has an 'any' type.
```

That is inherent to SPEC §3.1's language rule (only `src/protocol/` and
`src/hubs/` are TypeScript; the rest of the client stays untyped). The fix is a
single documented `@ts-expect-error` on that import, immediately followed by a
typed re-declaration of the one method used, so nothing downstream sees `any`:

```ts
const client = untypedApi as {
  capabilities: (options?: { refresh?: boolean }) => Promise<unknown>;
};
```

The alternative — adding `allowJs` to `tsconfig.client.json` — was rejected:
that file belongs to unit A1 and is outside B1's declared Files list, and
widening scope silently is exactly what the harness forbids. Flagged here in
case a later unit (B2/B3/B4 import no JS, but the hubs might) wants the
tsconfig change made deliberately.

## New test

`src/tests/protocol-contracts.test.ts` — 22 cases, vitest, `api/client.js`
mocked via `vi.mock` so the module is proven to fetch **only** through the
client wrapper (a stray `fetch` would show up as a missing call), and so the
real client module (which touches browser globals) never loads in the node
environment. Coverage: idle → loading → ready, caching, concurrent-call
sharing, `refresh` passthrough, failure → `unavailable`, malformed payload →
`unavailable`, per-mode override, unrestricted-vs-unknown, uploadable-only
accept attributes, gated ops, alias resolution, engine availability, and one
source-level test asserting the module contains no format extension, MIME, or
quality-preset literals outside comments.

## Gate 1 — unit completion commands (PLAN: `npm run test:client` · `npm run typecheck`)

### `npm run test:client`
```
> vitest run
 RUN  v4.1.10 C:/Users/Duy/Code/Project/AlphaStudio
 Test Files  2 passed (2)
      Tests  23 passed (23)
   Duration  706ms
EXIT=0
```
(23 = this unit's 22 plus A1's harness sanity case.)

### `npm run typecheck`
```
> tsc -p server/tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT=0
```

### Not required by PLAN, run anyway
The server suite contains 25 `ui-*-struct.test.ts` files that assert on client
source, so adding a client file could redden `npm test` even though B1's
completion line does not name it:
```
node --import tsx --test --test-concurrency=1 server/tests/ui-*-struct.test.ts
ℹ tests 137  pass 137  fail 0     EXIT=0
```

## Gate 2 — deterministic visual checks
```
node scripts/visual/run-checks.mjs      EXIT=0   (same 3 PENDING for C1/F0)
```

## Gate 3 — capture + diff
```
[visual:capture] captured=1 missing=268                        CAPTURE_EXIT=0
[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s)      DIFF_EXIT=0
```
No baseline accepted — B1 renders nothing. `consoleErrors: {}`; the new module
is not imported by the shipped client yet (inert until the flip), so the
capture is unchanged by design.

### A capture flake, and how it was ruled out
Two consecutive `visual:capture` runs failed with
`page.goto: Timeout 30000ms exceeded` navigating to the client. Rather than
retry until green, the changes were stashed and capture re-run on the committed
tree — it passed, which pointed at the diff. Restoring the changes and running
again also passed, and has passed on every run since. So the cause was a slow
Vite dev-server boot under load from the preceding suites, not the unit: the
stash run's success was ordering luck, not evidence. Recording it because
"stash → passed" looked like a real bisect result for one step, and a flake that
is quietly retried away is a flake nobody fixes. `netstat` showed nothing
listening on 16173/16787 during the failures, so it was startup latency against
the 30s `page.goto` budget, not a port conflict.

## Gate 4 — visual judge

**No applicable input** — third server/protocol-only unit in a row with no
surface and no capture of its own. No verdict was fabricated.

## Step 8 — post-rebase gate re-run (before merge)

`git rebase rebuild` was a no-op. Full suite re-run on the exact tree that merged:

```
npm run typecheck                                       EXIT=0
npm run test:client   Test Files 3 passed, Tests 39     EXIT=0
npm run visual:checks                                   EXIT=0
npm run visual:capture  captured=1 missing=268          EXIT=0
npm run visual:diff     PASS                            EXIT=0
```

Merged into `rebuild` as **affaa6c**; branch pushed to origin for the record.

## Step 7 — spec review, and the six fixes it forced

`spec-reviewer` verdict: **FIX-THEN-SHIP**. It confirmed scope, layering (the
only import is `api/client.js`; no React/components/store; no cycle), the
absence of fallback literals, and endorsed the `@ts-expect-error` call as
"strictly better than `@ts-ignore` … self-cleaning: the day A1's tsconfig gains
`allowJs`, TS7016 disappears and the directive itself errors as unused". Six
findings were fixed before merge, all pinned by a new test file
`src/tests/protocol-contracts-gaps.test.ts` (16 cases) written before the fixes.

1. **High — the accept attribute over-promised.** It concatenated the
   *uploadable-only* extensions with the list's *unfiltered* `mimeTypes`. The
   server builds `mimeTypes` per family without regard to uploadability, so the
   real `ebook` list carries `application/x-mobipocket-ebook` and
   `application/zip` — and a browser file picker matches on MIME as well as
   extension. The picker would have offered every `.zip` on disk and every
   `.mobi` on Linux/macOS, both of which the next request refuses.
   **Fix:** MIME types are emitted only when `uploadable.length ===
   extensions.length` (every format in the list is uploadable, so every MIME is
   safe); on a partly-uploadable list the attribute is extensions-only.
   Note the constraint this navigated: the obvious fix — drop `mimeTypes`
   altogether — would have contradicted an already-written, write-once test
   asserting `'.png,.svg,image/png,image/svg+xml'` for a fully-uploadable list.
   The rule above satisfies both that test and the ebook case. The tighter fix
   (the server publishing an uploadable-only MIME subset) needs
   `server/src/convert/formats.ts` and belongs to a unit that may touch it.
2. **Medium — no `acceptListById`.** SPEC §3.4 has hub configs name a list via
   `acceptFrom: '<list id>'`, and nothing exposed that, so D3 would have reached
   into `getContractState().contract.acceptLists.lists[id]` — where a typo
   yields `undefined` and reads as "no filter", exactly the
   unrestricted-vs-unknown collapse this module exists to prevent.
   **Fix:** `acceptListById()` / `acceptAttributeForList()`, gap-aware.
3. **Medium — absence reported as knowledge, twice.** (a) `gatedOps` is only the
   *unavailable* slice, so an unknown capability id answered "not gated, go
   ahead"; the payload's full `tools` inventory is now parsed, and an id absent
   from it is a gap. (b) A missing `converter` section produced `{}` — "zero
   engines" rather than "we do not know"; `engines` is now `null` in that case
   and the engine selectors report the gap.
4. **Medium — refresh blacked out a good contract.** `loadContracts({refresh:
   true})` set `loading` immediately, so for the whole of a server-side tool
   re-probe (seconds, it spawns real binaries) every hub would flip to its
   capability-gap state — and a *failed* refresh replaced a valid cached
   contract with `unavailable` permanently. **Fix:** a refresh keeps serving the
   cache until the new contract lands, and keeps it on failure with
   `refreshError` recorded. Responses are generation-checked, so a slow reply
   can neither overwrite a newer one nor repopulate a cache that was reset
   underneath it.
5. **Medium — the parser hard-failed on `families`**, a field no selector reads
   and no server test pins. A later unit trimming that server-internal metadata
   would have blacked out every hub with "did not publish a usable contract"
   while both suites stayed green. **Fix:** `families` is now optional.
6. **Medium — `jobType` was not normalized** while `operation` was, so `'PDF'`
   answered "unrestricted" client-side while the server still enforced the `pdf`
   list. **Fix:** both normalized exactly as `acceptListIdForJob` does.

Also taken from the review's residual-risk note: `loadContracts` now checks
`typeof client.capabilities === 'function'` and reports a distinct reason, so
`client.js` losing that method fails loudly instead of degrading the whole app
to the capability-gap state. And `client.capabilities()` is now invoked
synchronously rather than a microtask later, so the request is in flight by the
time `loadContracts` returns.

### Two corrections to this evidence file, from the same review
- The claim that the mock "proves the module fetches **only** through the client
  wrapper" was too strong: mocking proves the happy path *goes through* it, not
  that no other path exists. The new test file now asserts the source contains
  no `fetch(`, `XMLHttpRequest`, `EventSource`, `WebSocket`, or `/api/` string,
  which is what makes "only" true.
- `resetContracts()` previously did not invalidate an in-flight request despite
  its doc comment; the generation counter now does.

### One process note
`protocol-contracts-gaps.test.ts` was removed and rewritten once, before it was
committed, because its first version reached for `await import('../api/client.js')`
to break the mocked module — which tripped the same TS7016 in `typecheck`. The
rewrite holds the mocked `api` object by reference instead, so no untyped import
is needed. Recording it because test files are otherwise write-once here.

### Gates re-run after the fixes
```
npm run typecheck                                  EXIT=0
npm run test:client   Test Files 3 passed, Tests 39 passed   EXIT=0
server/tests/ui-*-struct.test.ts   137 pass / 0 fail          EXIT=0
npm run visual:checks                              EXIT=0
npm run visual:capture  captured=1 missing=268     EXIT=0
npm run visual:diff     PASS                       EXIT=0
consoleErrors: {}
```
