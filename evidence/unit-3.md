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

## Step 8 — post-rebase gate re-run (before merge)

`git rebase rebuild` was a no-op (nothing landed since the branch point). Full
suite re-run anyway on the exact tree that merged:

```
npm run typecheck                                            EXIT=0
npm test        tests 733 / pass 732 / fail 0 / skipped 1    EXIT=0
npm run visual:checks                                        EXIT=0
npm run visual:capture  captured=1 missing=268               EXIT=0
npm run visual:diff     PASS — 0 baseline(s) verified        EXIT=0
```

Merged into `rebuild` as **f26df70**; branch pushed to origin for the record.

## Step 7 — spec review, and the four fixes it forced

`spec-reviewer` verdict: **FIX-THEN-SHIP**. Derivation, publication and gate
wiring were confirmed correct and well-tested; four Medium findings were fixed
before merge. All four are pinned by a new test file,
`server/tests/accept-lists-uploadable.test.ts` (10 cases), written before the
fixes.

1. **The published lists over-promised.** `POST /api/uploads` gates on its own,
   narrower allowlist (`EXT_MIME` ∪ `TEXT_EXTS` in `security/validation.ts`),
   which excludes `.mobi .azw .azw3 .fb2 .htmlz .rst .adoc .asciidoc .parquet`.
   A client building a dropzone filter from the `ebook` list would have offered
   `book.mobi` and eaten a 415 on the very next request — the exact
   queue-then-fail dishonesty §3.5 exists to remove. **Fix:** the format table
   now marks those seven definitions `uploadable: false`, and every published
   list carries both `extensions` (what the format layer knows — still the full
   set, so AUDIT PR-4's coverage assertion holds) and `uploadable` (what a
   client may actually offer). The new test pins the marking against the real
   allowlist **in both directions**, parsed from source: widen
   `security/validation.ts` and it fails until the table agrees.
   `security/validation.ts` itself was not touched — it is outside A3's
   declared Files list, so the gap is now published as data rather than
   silently patched.
2. **The gate silently narrowed two working flows.** `FilePicker` does not
   filter drops against `accept`, so today a user can drop `animation.gif` on
   Media Studio (ffmpeg makes an MP4) or `clip.mp4` on Audio Lab (`-vn` +
   libmp3lame). With `media`/`audio` mapped to audio+video only, both became
   415 — subtractive, against PLAN line 11's "intermediate units ship no
   user-visible change". **Fix:** new `mediaSource` list (audio+video+image)
   for `media` jobs, and `audio` jobs map to `media` (audio+video), since
   reading a video container and dropping the video stream is legitimate. Both
   flows are now regression-tested by name.
3. **`JOB_ACCEPT_RULES` was the one hand-maintained table with nothing pinning
   it**, and was already inconsistent: `archive:extract` was gated but
   `archive:inspect` — which equally needs a real archive — was not. **Fix:**
   `inspect` gated too, plus a test asserting every job type in
   `processorLoaders` has an accept rule, so a new job type cannot silently
   become unrestricted by omission. Residual limitation, stated plainly: no
   machine check can catch a *future* operation that needs a different list
   (e.g. another images-in PDF op) because input kind is not modelled in
   `operation-contract.ts`, which is out of scope here. `pyop` stays
   unrestricted on purpose — its operations span every family.
4. **The drift parser could under-count.** The row regex in
   `capabilities-contracts.test.ts` matches only single-line `EXT_FAMILY`
   entries and asserted `rows.length >= 50` — a floor, so a reformatted
   multi-line entry would be skipped silently. **Fix:** a new test asserts the
   row parser matches *exactly* the key list, so the drift guarantee cannot be
   quietly hollowed out. (The existing test file was not edited — test files
   are write-once here.)

Reviewer's non-findings worth keeping: `retryJob` re-queues with a raw `UPDATE`
and never re-enters `createJob`, so the gate cannot break an in-flight retry;
extension-less files are already impossible in `uploads` because
`validateStoredFileQuick` rejects them first; `POST /api/jobs` is the only
`createJob` caller, so gating inside `createJob` is the correct placement.

### Gates re-run after the fixes
```
npm run typecheck                                            EXIT=0
npm test        tests 733 / pass 732 / fail 0 / skipped 1    EXIT=0
npm run visual:checks   (same 3 PENDING for C1/F0)           EXIT=0
npm run visual:capture  captured=1 missing=268               EXIT=0
npm run visual:diff     PASS — 0 baseline(s) verified        EXIT=0
```
726 → 733 is the 7 additional cases from the new pinning test file (3 of its 10
replaced nothing; total new tests for A3 = 21).

### One process note
`accept-lists-uploadable.test.ts` was written, then removed and rewritten from
scratch a minute later to strip a stray non-ASCII character I had typed into a
test title. The file was uncommitted and had never been executed at that point.
Recording it because test files are otherwise write-once in this harness.

## Deliberately NOT done in this unit

SPEC §3.5 closes with a checkable consequence: "`git grep` over `src/` finds no
format-extension or MIME literals outside tests and `contracts.ts` type
definitions." That is a **client-side** consequence — the literals live in
`src/views/*.jsx` and `src/views/extraToolConfigs.js`, none of which is in A3's
declared Files list, and PLAN's transitional rule keeps the old client working
until F1. A3 delivers the server half (the lists now exist and are published);
the literals disappear as the hub units consume `acceptLists` and F1 deletes the
old views. Flagged here so the check is run at F1 rather than assumed.
