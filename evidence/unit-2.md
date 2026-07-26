# Evidence — Unit 2 (A2) S1: epoch event versioning

- Date: 2026-07-26
- Branch: `unit-2-a2-epoch-events`
- SPEC: §6.4 (boot-scoped `epoch`, `seq` monotonic per workspace within the
  epoch, envelopes **and** snapshots carry both, no SQLite schema change)

## Changes

- `server/src/lib/workspace-events.ts` — `eventEpoch` (a `randomUUID()` minted
  once at module load, never persisted); per-workspace `seq` lanes
  (`nextWorkspaceSeq` / `currentWorkspaceSeq`, events with no workspace share
  the empty-key lane); `WorkspaceEvent` gains required `epoch` + `seq`, both
  server-minted (added to the `Omit<>` so no caller can supply them). The legacy
  process-global `version` field is untouched — the pre-flip client still reads
  it, and `workers/jobs.ts` still shares one `version` across the job and
  workspace buses.
- `server/src/routes/workspaces.ts` — `versionedSnapshot()` wraps
  `hydrateWorkspace()` with `{ epoch, seq }`, applied to all five snapshot
  responses (`POST /recover`, `GET /:id`, `PATCH /:id`, `POST /:id/clear`,
  `DELETE /:id/files/:fileId`); the SSE `connected` frame carries the same pair.
- No SQLite schema change (epoch is boot-scoped), so §6.6's additive+reversible
  migration rule never comes into play.

## New test (written FIRST — PLAN A2 characterization requirement, AUDIT PR-5)

`server/tests/workspace-epoch-restart.test.ts` — forks the real
`server/src/index.ts` twice against one DB/DATA_DIR on port 8843 and drives it
over HTTP + SSE: emit → restart (graceful IPC shutdown) → emit. Three cases:
snapshot/envelope field presence + per-workspace monotonicity; independent seq
lanes across two workspaces; restart mints a new epoch and restarts seq.

### Test-first proof — the test run BEFORE the implementation existed

```
✖ snapshots and envelopes carry {epoch, seq}; seq is monotonic per workspace
  AssertionError: snapshot carries a boot-scoped epoch UUID
    actual: undefined
    expected: /^[0-9a-f]{8}-...-[0-9a-f]{12}$/i
✖ gives each workspace its own seq lane
  AssertionError: lane A advanced, seq=undefined
✖ mints a new epoch and restarts seq across a restart (emit → restart → emit)
  AssertionError: events were emitted before the restart, seq=undefined
EXIT=1
```

## Gate 1 — unit completion commands (PLAN: `npm run typecheck` · `npm test`)

### `npm run typecheck`
```
> tsc -p server/tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT=0
```

### The new test, after the implementation
```
▶ S1 epoch event versioning (SPEC §6.4)
  ✔ snapshots and envelopes carry {epoch, seq}; seq is monotonic per workspace (2135.0709ms)
  ✔ gives each workspace its own seq lane (362.9824ms)
  ✔ mints a new epoch and restarts seq across a restart (emit → restart → emit) (6418.1791ms)
✔ S1 epoch event versioning (SPEC §6.4) (11690.474ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
EXIT=0
```

### `npm test` (full server suite, `--test-concurrency=1`)
```
✔ S1 epoch event versioning (SPEC §6.4) (10375.5388ms)
▶ workspace-events bus
  ✔ emits versioned events to workspace subscribers (4.0999ms)
  ✔ does not deliver to other workspace ids (0.2726ms)
▶ workspace SSE HTTP integration
  ✔ streams connected + file.created after multipart upload with required fields (1650.9213ms)
  ✔ streams job.created / job.updated with required fields for short text job (254.5974ms)
ℹ tests 712
ℹ suites 227
ℹ pass 711
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 329615.9226
EXIT=0
```
The pre-existing `workspace-events.test.ts` and `workspace-sse-http.test.ts`
stay green untouched — confirmation the `{epoch, seq}` addition is additive.

## Gate 2 — deterministic visual checks

```
> node scripts/visual/run-checks.mjs
PENDING token-purity (§4.6) — no target files yet under src\styles (built by units C1+)
PENDING motion-purity (§5.2/§5.3) — no CSS yet under src\styles (built by units C1+/F0)
PENDING contrast (WCAG AA on §4.1 tokens) — src/styles/tokens.css not built yet (unit C1)
EXIT=0
```
All three PENDING targets belong to later units (C1, F0). A2 was not supposed
to build any of them.

## Gate 3 — capture + diff

```
> node scripts/visual/capture.mjs
[visual:capture] booting API (http://127.0.0.1:16787) + client (http://127.0.0.1:16173, VITE_UI=next)
[visual:capture] captured=1 missing=268 → visual\captures
EXIT=0

> node scripts/visual/diff.mjs
[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s) accounted for.
EXIT=0
```
No baseline was accepted: A2 introduces no surface, and the one capture
(`smoke--home`) is the pre-flip old client, not a surface this unit built. All
268 missing targets report `html[data-shell="next"] absent (new shell not
built/enabled)` — pending units D1+.

Substantive signal for this unit: `report.json` records
`consoleErrors: {}` and `cls: {}` — the existing client boots and renders
clean against the changed snapshot payload, i.e. the additive `{epoch, seq}`
fields break nothing pre-flip.

## Gate 4 — visual judge

**No applicable input.** The judge is given "the capture file paths relevant to
this unit" plus verbatim SPEC criteria for those surfaces. A2 is a server-only
unit: it renders nothing, introduced no capture, and the single existing
capture (`smoke--home`) is the old client, which SPEC §4 does not describe —
every §4 surface is still `missing` pending D1+. There is therefore no artifact
and no criterion for the judge to assess, and none was fabricated. The gate's
input set is empty; the first UI unit (C1) is where it first has something to
judge.
