# Evidence — Unit 5 (B2) `src/protocol/store.ts`

- Date: 2026-07-26
- Branch: `unit-5-b2-protocol-store`
- SPEC: §3.2 (store row), §6.1 (state table + sanctioned keys), §6.2 (mutation
  rules), §6.3 (merge semantics), §6.5 items 2/3/5, §2.2 (composed progress —
  §6.3 extends the monotonic rule to it)
- Detailed plan (flagged unit): `docs/plans/UNIT-B2.md`

## Changes

- `src/protocol/store.ts` (new) — the single client state owner. One version
  gate (`acceptsWrite`) and two row merges (`mergeJob` / `mergeFile`) sit under
  **all four** write paths: `hydrate`, `applyEvent`, `applyPoll`, and the
  optimistic overlay. Also owns the persisted workspace id, the per-hub+mode
  job-resume pointers, upload-session mirror, and the §2.2 composed value.
- `src/next/hooks/useStore.js` (new) — `useSyncExternalStore` binding, subscribe
  only, cached per (snapshot, selector) so a snapshot change that does not
  affect a selector cannot re-render its component. Under `src/next/` per
  PLAN's transitional namespace rule (the final `src/hooks/useStore.js` path
  collides with the live old client until F1).
- `docs/plans/UNIT-B2.md` (new) — required for a flagged unit; records the
  design decisions a reviewer should challenge (layered overlay, per-row gate
  seeded by snapshot seq, non-blind wholesale hydrate, terminal-immutability
  scope, recovery policy change).

Behavior deliberately changed rather than ported: `hooks/useWorkspace.js`
auto-created a replacement workspace whenever recovery failed, silently
orphaning the user's workspace (hazard F3-H3). SPEC §6.5 item 5 forbids that —
the store now keeps the persisted id, surfaces a persistent error, retries with
backoff, and creates a workspace only through the explicit `createWorkspace()`
action.

## Test-first proof (PLAN B2: "the merge-semantics suite is written **before** the merge implementation")

Both suites were written first and run against a non-existent module:

```
 FAIL  src/tests/protocol-store-merge.test.ts [ src/tests/protocol-store-merge.test.ts ]
Error: Cannot find module '/src/protocol/store.js' imported from C:/Users/Duy/Code/Project/AlphaStudio/src/tests/protocol-store-merge.test.ts
 ❯ src/tests/protocol-store-merge.test.ts:42:5

 FAIL  src/tests/protocol-store-state.test.ts [ src/tests/protocol-store-state.test.ts ]
Error: Cannot find module '/src/protocol/store.js' imported from C:/Users/Duy/Code/Project/AlphaStudio/src/tests/protocol-store-state.test.ts
 ❯ src/tests/protocol-store-state.test.ts:49:5

 Test Files  2 failed (2)
      Tests  no tests
```

The first implementation run then failed one case — recorded because it is the
bug the suite existed to catch, not a formality:

```
 FAIL  src/tests/protocol-store-merge.test.ts > poll and SSE cannot regress each other (SPEC §6.3)
       > discards a poll payload older than the row (row-level updatedAt fallback)
AssertionError: expected 'queued' to be 'running' // Object.is equality
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 51 passed (52)
```

Cause: `applyEvent` stamped rows with the **envelope's** `updatedAt` (minted at
emit time) instead of the row DTO's. A stale poll then tied on the timestamp and
was accepted as an idempotent refresh, regressing `running` → `queued`. Fixed by
building the write token from the row's own `updatedAt` when a DTO is attached
(envelope time is the fallback) — §6.3's gate is per row.

## Gate 1 — unit completion commands (PLAN: `npm run test:client` · `npm run typecheck`)

### `npm run test:client`
```
> alphastudio@3.6.0 test:client
> vitest run

 RUN  v4.1.10 C:/Users/Duy/Code/Project/AlphaStudio

 Test Files  5 passed (5)
      Tests  91 passed (91)
   Duration  442ms
EXIT=0
```

The §7.2 unit list for this module, all in the 52 new cases:
epoch change (adopt + wholesale re-hydrate, no stacked resync, rows that
overtook an in-flight response survive, rows the snapshot dropped are removed) ·
seq regression (lower seq discarded even carrying higher progress; pre-snapshot
events discarded; discarded writes do not notify subscribers) · poll/SSE
non-regression both directions · monotonic progress (value clamped, rest of the
write still applied, retry restarts at 0, upload progress monotonic) · terminal
immutability (late progress dropped, second terminal status refused, enrichment
still merges) · optimistic overlay (local row, re-applied after re-hydrate,
collapses to one row, requested-flag without status patching, refused on a
terminal job, resolved by response / terminal state / timeout).

### `npm run typecheck` (server + client TS projects)
```
> alphastudio@3.6.0 typecheck
> tsc -p server/tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT=0
```

## Gate 2 — deterministic visual checks

```
> node scripts/visual/run-checks.mjs

PASS    token-purity (§4.6) [1 file(s)]
PENDING motion-purity (§5.2/§5.3) — no CSS yet under src\styles (built by units C1+/F0)
PENDING contrast (WCAG AA on §4.1 tokens) — src/styles/tokens.css not built yet (unit C1)
EXIT=0
```

Note: token-purity moved from PENDING (unit 1) to PASS because creating
`src/next/` puts the check into its transitional mode, where it scans the new-UI
JSX scope (`src/next`, `src/workbench`) — `useStore.js` is the one file. The two
PENDING targets are `src/styles/` CSS, built by C1/F0; B2 builds neither.

## Gate 3 — screenshot capture + diff

```
[visual:capture] booting API (http://127.0.0.1:16787) + client (http://127.0.0.1:16173, VITE_UI=next)
[visual:capture] captured=1 missing=268 → visual\captures
[visual:capture] missing targets are pending build units (see report.json), not failures
EXIT=0

[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s) accounted for.
EXIT=0
```

No baseline accepted: B2 introduces no UI surface. The single capture is
`smoke--home.png` (the old client's home), which this unit neither builds nor
changes; the 268 missing targets belong to later units.

## Gate 4 — visual judge

Not applicable: zero captures belong to this unit. B2 is a protocol module plus
a headless `useSyncExternalStore` binding — it renders nothing, so there is no
artifact to judge and no SPEC §4 criterion that references one. Nothing was
given to the judge; nothing that exists was skipped.
