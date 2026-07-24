# Converter completion handoff (C0–C8)

## Branch
`ux-ui-redesign` (do not merge main from this workstream without review)

## Delivered

### C0 — Matrix freeze
- `docs/converter/FORMAT_ENGINE_MATRIX.md`
- `.converter-complete-state.json`
- `fixtures/converter/*` inventory + samples

### C1 — Board actions
- Multi-select members (`toggleFileSelection`, select group / clear)
- **Convert selected**, **Convert group**, **Convert all**
- Shared `queueConvertJob` → real `api.createJob`
- Real/honest progress via `aggregateJobProgress` + ProgressWave

### C2 — Engine-aware UI
- `settingsSchemaForEngine` hides quality/metadata when unsupported
- Engine summary (profile, cost, fallbacks)
- Unavailable panel + lossy/experimental labels in format dropdown
- Responsive sticky runbar / member select styles

### C3 — Dispatch
- `ENGINE_DISPATCH` map in `processors/converter.ts` for pandoc/calibre/libreoffice/python

### C4 — Honesty
- `lossy` / `experimental` on `listOutputsFor` OutputOption

### C5–C6 — Runtime / deploy
- `npm run runtime:verify` / `runtime:repair`
- `deploy/Dockerfile.full-runtime`
- `docs/DEPLOY_DOCKER_VPS.md`
- BUILD_AND_RUN notes for runtime:verify

### C7–C8 — Evidence
- Tests: `converter-c0-matrix-struct`, `converter-groups-c1`, `converter-lossy-flags`, `converter-no-install-during-job`, updated pro-struct
- No mid-job install gate on processor/worker paths

## Design skills
- taste + redesign-existing-projects applied (file-first board, no card-grid, honest progress)
- ux-ui-pro-max not installed; Corrective-2 board rules followed

## Verify locally
```text
node --import tsx --test server/tests/converter-c0-matrix-struct.test.ts server/tests/converter-groups-c1.test.ts server/tests/converter-no-install-during-job.test.ts server/tests/converter-lossy-flags.test.ts server/tests/ui-converter-pro-struct.test.ts
npm run typecheck
npm run build
npm run runtime:verify
```
