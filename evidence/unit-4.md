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

## Gate 4 — visual judge

**No applicable input** — third server/protocol-only unit in a row with no
surface and no capture of its own. No verdict was fabricated.
