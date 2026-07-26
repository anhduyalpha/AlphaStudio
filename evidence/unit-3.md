# Evidence — Unit 3 (A3) S2: capabilities-published contracts

- Date: 2026-07-26
- Branch: `unit-3-a3-capabilities-contracts`
- SPEC: §3.5 (`acceptLists` from `convert/formats.ts`, `gatedOps` from the
  capability layer, `quality` alias resolution from `convert/quality.ts`; the
  job-create gate validates against the same published lists)

## Changes

- `server/src/convert/formats.ts` — `FormatDefinition` gains an optional
  `extensions` field (real dot-prefixed filename extensions, defaulting to
  `['.' + format]`) so option-value aliases like `markdown`/`commonmark`/`plain`
  never leak out as file filters; six definitions declare theirs
  (`jpeg`, `tiff`, `mpeg`, `html`, `asciidoc`, `azw3`). On top of that: eleven
  named `AcceptList`s **derived** from the definitions by family (image, audio,
  video, media, pdf, archive, text, spreadsheet, document, presentation,
  ebook), a `JOB_ACCEPT_RULES` map of job type → list with per-mode overrides,
  and `acceptListIdForJob` / `isFilenameAccepted` / `publishedAcceptLists()`.
  Adding a format to the table now puts it in its family's published list
  automatically — that is the point of collapsing onto one table.
- `server/src/convert/quality.ts` — `publishedQualityContract()` exposes
  `{ presets, default, aliases }` straight from `QUALITY_PRESETS`,
  `DEFAULT_QUALITY_PRESET` and `PRESET_ALIASES`, so `max` has exactly one
  server answer (`high`) and the client never resolves an alias itself.
- `server/src/capabilities.ts` — `gatedOperations()` returns the unavailable
  slice of the same `tools` array `isToolAvailable` reads, each entry carrying a
  guaranteed non-empty reason.
- `server/src/routes/system.ts` — `/api/capabilities` publishes `acceptLists`,
  `gatedOps` and `quality` alongside the existing payload.
- `server/src/workers/jobs.ts` — create-gate wiring only:
  `assertAcceptedInputs()` runs inside `createJob` right after the uploads
  resolve (before the PDF cardinality check, so the error names the real
  problem) and throws `415 UNSUPPORTED_MEDIA_TYPE` naming the list it checked
  against. `routes/jobs.ts` needed no change — `POST /api/jobs` forwards
  straight to `createJob`, so gating there covers every caller including
  workspace-scoped creation.

`null` in the job-type map means genuinely unrestricted, not unchecked:
`archive:create` packs arbitrary files, `security`/`text` are deliberately
format-agnostic, and `converter` is gated instead by its live engine matrix
(`gateConverterCreate`).

## New tests (written FIRST — PLAN A3 / AUDIT PR-4)

- `server/tests/capabilities-contracts.test.ts` — drift (detect.ts `EXT_FAMILY`
  and the capability-id map in `processors/index.ts` parsed from source and
  checked against the format table / published tools), publication shape, and
  create-gate accept/reject over real HTTP uploads on port 8844. Only bundled
  capabilities (`image.*`, `pdf.*`) are exercised, so the gate assertions do not
  depend on ffmpeg or LibreOffice being installed.
- `server/tests/accept-lists-coverage.test.ts` — every `detect.ts` extension
  appears in at least one published list; every published extension is a known
  format; each list only advertises its own families. This is AUDIT PR-4's
  "every detect.ts extension maps into a published list/category" in literal
  form.

### Test-first proof — run BEFORE the implementation existed

```
▶ S2 drift — private tables stay in lockstep with the one format table
  ✔ every detect.ts extension maps into the published format table with the same family
  ✔ every capability id the create gate can require is a published tool id
▶ S2 publication — /api/capabilities publishes the contracts (SPEC §3.5)
  ✖ publishes acceptLists derived from the format table
  ✖ maps job types and modes onto the named lists
  ✖ publishes gatedOps as exactly the unavailable slice of the capability layer, with reasons
  ✖ publishes the quality contract, and `max` resolves to exactly one preset
▶ S2 enforcement — the create gate uses the same published lists
  ✔ accepts an upload inside the published list for the job type
  ✔ accepts an upload inside the published list for a per-mode override
  ✖ rejects an upload outside the published list at create time
  ✖ rejects a text upload for an image job
  ✔ leaves unrestricted job types alone
ℹ tests 11  pass 5  fail 6      EXIT=1
```

Worth recording: the two **drift** assertions passed on the first run. There is
no live drift today between `detect.ts`, `processors/index.ts` and the format
table — the tests exist to make a future divergence fail loudly, which is
exactly what AUDIT PR-4 asked for. The six failures are the features that did
not exist yet.

## Gate 1 — unit completion commands (PLAN: `npm run typecheck` · `npm test`)

### `npm run typecheck`
```
> tsc -p server/tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT=0
```

### The new tests, after the implementation
```
▶ S2 accept-list coverage
  ✔ every detect.ts extension appears in at least one published accept list (2.062ms)
  ✔ every published list extension is a format the table knows (0.9156ms)
  ✔ each list only advertises extensions from its own families (0.3677ms)
▶ S2 drift — private tables stay in lockstep with the one format table
  ✔ every detect.ts extension maps into the published format table with the same family (2.1313ms)
  ✔ every capability id the create gate can require is a published tool id (0.544ms)
▶ S2 publication — /api/capabilities publishes the contracts (SPEC §3.5)
  ✔ publishes acceptLists derived from the format table (0.7419ms)
  ✔ maps job types and modes onto the named lists (0.2856ms)
  ✔ publishes gatedOps as exactly the unavailable slice of the capability layer, with reasons (5.0287ms)
  ✔ publishes the quality contract, and `max` resolves to exactly one preset (0.3122ms)
▶ S2 enforcement — the create gate uses the same published lists
  ✔ accepts an upload inside the published list for the job type (52.7217ms)
  ✔ accepts an upload inside the published list for a per-mode override (15.7154ms)
  ✔ rejects an upload outside the published list at create time (15.3957ms)
  ✔ rejects a text upload for an image job (16.6297ms)
  ✔ leaves unrestricted job types alone (30.4409ms)
ℹ tests 14  pass 14  fail 0     EXIT=0
```

### `npm test` (full server suite, `--test-concurrency=1`)
```
ℹ tests 726
ℹ pass 725
ℹ fail 0
ℹ skipped 1
EXIT=0
```
712 → 726 is exactly the 14 new cases. **No existing test broke** — notable,
because the create gate is a real behavior change (jobs that would previously
queue and then fail now get a 415 at create). Nothing in the suite was creating
a restricted-type job with an out-of-list input.

## Gate 2 — deterministic visual checks
```
> node scripts/visual/run-checks.mjs
PENDING token-purity (§4.6) — no target files yet under src\styles (built by units C1+)
PENDING motion-purity (§5.2/§5.3) — no CSS yet under src\styles (built by units C1+/F0)
PENDING contrast (WCAG AA on §4.1 tokens) — src/styles/tokens.css not built yet (unit C1)
CHECKS_EXIT=0
```

## Gate 3 — capture + diff
```
[visual:capture] captured=1 missing=268 → visual\captures      CAPTURE_EXIT=0
[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s) accounted for.   DIFF_EXIT=0
```
No baseline accepted: A3 builds no surface. `report.json` records
`consoleErrors: {}` and `cls: {}`, so the enlarged `/api/capabilities` payload
does not disturb the existing client.

## Gate 4 — visual judge

**No applicable input**, same as unit 2 and for the same reason: A3 is
server-only, introduced no capture, and the single existing capture
(`smoke--home`) is the pre-flip client, which SPEC §4 does not describe. No
verdict was fabricated.

## Deliberately NOT done in this unit

SPEC §3.5 closes with a checkable consequence: "`git grep` over `src/` finds no
format-extension or MIME literals outside tests and `contracts.ts` type
definitions." That is a **client-side** consequence — the literals live in
`src/views/*.jsx` and `src/views/extraToolConfigs.js`, none of which is in A3's
declared Files list, and PLAN's transitional rule keeps the old client working
until F1. A3 delivers the server half (the lists now exist and are published);
the literals disappear as the hub units consume `acceptLists` and F1 deletes the
old views. Flagged here so the check is run at F1 rather than assumed.
