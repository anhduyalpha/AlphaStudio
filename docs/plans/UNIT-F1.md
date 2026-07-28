# Unit F1 detailed execution plan — flip, deletion, and S3

## Purpose and entry gate

F1 is the rebuild's single point of no return. Its outcome is the exact target
tree in SPEC §3.1, with the rebuilt client as the only client, the legacy
client physically absent, and all client-source structural assertions owned by
Vitest rather than the server suite.

Entry evidence is Unit 27/F2:

- merge `ac1f9a2` is on `rebuild`;
- the production flag build passed all twelve SPEC §7.3 steps;
- browser/network audit was clean;
- `npm run typecheck`, 507 client tests, build, visual checks, capture, and
  visual diff passed.

F1 does not begin source mutation until this plan is committed with the unit
start checkpoint.

## Current-state inventory

- `src/next/` contains 38 rebuilt files:
  - `App.jsx`;
  - 25 primitive/component files;
  - 7 workbench hooks;
  - Home, Activity, Settings, Profile, and AssetGallery views.
- The final top-level `src/components/` and `src/views/` paths still contain
  only the legacy implementation and must not be merged piecemeal.
- `server/tests/` contains exactly 25 `ui-*-struct.test.ts` files.
- Five additional `ui-*.test.ts` files read client source and therefore also
  violate target §3.2:
  - `ui-assets-design-system.test.ts`
  - `ui-contrast.test.ts`
  - `ui-converter-results-behavior.test.ts`
  - `ui-job-resume.test.ts`
  - `ui-qr-decode-error.test.ts`
- `converter-c0-matrix-struct.test.ts` reads only docs, fixtures, and the
  converter completion-state file. It remains a server-side repository
  contract because it does not read or assert on client source.
- Four old-UI E2E specs plus `pdf-tools.spec.js` drive markup that will be
  deleted. `rebuild-journey.spec.js` is the sole target E2E gate.
- `api/client.js` still owns three legacy event-stream paths and imports one
  upload-metric helper from the otherwise obsolete `lib/liveState.js`.

## Phase 1 — write the target structural contract first

Add a client structural test that initially fails against the transitional
tree and has no path exception/allowlist entries. It proves:

1. `src/next` is absent and `src/main.jsx` has no `VITE_UI` branch.
2. Every target §3.1 module exists at its final path.
3. Every item in the verbatim “Deleted at target state” list is absent.
4. Only `api/client.js`, `api/resumableUpload.js`, and `protocol/events.ts`
   contain network primitives.
5. `api/client.js` contains no EventSource, event-stream Accept header, SSE
   parser, `subscribeWorkspaceEvents`, `subscribeViaFetch`, or `waitViaSse`.
6. `protocol/events.ts` is imported only by `protocol/store.ts`.
7. Hubs remain data-only; primitives do not import protocol/API; pure lib does
   not import React, components, protocol, or API; server tests do not read
   client source.
8. The exactly-one rules hold for `useFocusTrap`, `formatBytes`, the hidden
   Dropzone browse input, the tablist keyboard owner, and ProgressBar.
9. The a11y, asset-registry, storage-key, and legacy-redirect contracts are
   enforced by the client suite.
10. Every CSS class is referenced by shipped client source or the development
    Asset Gallery, no class is defined in two style files, and both exception
    arrays are literally empty.

Where an old server assertion still expresses a target invariant, relocate its
meaning into this client test or an existing focused client test. Do not copy
assertions about deleted markup.

## Phase 2 — atomically install the final module map

Perform one mechanical relocation:

- `src/next/App.jsx` → `src/App.jsx`
- `src/next/components/*` → `src/components/*`
- `src/next/hooks/*` → `src/hooks/*`
- `src/next/views/*` → `src/views/*`

Before moving, delete the legacy occupants of `src/components/` and
`src/views/`. Preserve only the target hooks already at top level:

- `useCapabilities.js`
- `useFocusTrap.js`
- `useJobPreviewUrl.js`
- `useMotionPreference.js`

Update all imports in App, hooks, views, workbench, panels, and client tests
from transitional `next` paths to final paths. `src/main.jsx` becomes a single
unconditional rebuilt boot path: preload contracts, set the rebuilt shell
marker, and render `src/App.jsx`. Remove the feature flag and all legacy
stylesheet imports.

After relocation, assert with search that no source/test import contains
`next/` and no `src/next` directory remains.

## Phase 3 — complete the deletion list and prune transport

Delete exactly:

- all 17 legacy view/config files named in PLAN/SPEC;
- all legacy component files and component subdirectories, including the
  explicitly named AgentFanOut/IconButton/FileDropzone/FeatureButton/
  IllustrationCard/PageIntro implementations;
- `src/data/tools.js`;
- `src/lib/liveState.js`;
- `src/hooks/useWorkspace.js`, `useWorkspaceEvents.js`, `useJobRunner.js`, and
  `useAnimationActivity.js`;
- `src/styles.css`;
- every file under `src/animations/`.

Extract the still-used pure multipart progress calculation to a small leaf
module, then remove the `liveState.js` import. Convert `api.waitForJob` to
poll-only HTTP and delete the workspace/job SSE implementations from
`api/client.js`; `protocol/events.ts` remains the only event-stream owner.

Run import/reference searches immediately after deletion. Any remaining
reference to a deleted path is a failure to repair, not a reason to retain the
legacy file.

## Phase 4 — perform S3 and retire obsolete E2E

Delete:

- all 25 `server/tests/ui-*-struct.test.ts` files;
- the five audited `ui-*.test.ts` files that read client source.

Keep `converter-c0-matrix-struct.test.ts`, because it reads no client source.
Add a client-side meta-test that scans `server/tests` and fails if any server
test references `src/`.

Delete the old-UI E2E specs:

- `e2e/pdf-tools.spec.js`
- `e2e/corrective-after-screenshots.spec.js`
- `e2e/corrective-baseline-screenshots.spec.js`
- `e2e/residual-quality.spec.js`
- `e2e/residual-state-screenshots.spec.js`

The sole remaining functional browser spec is
`e2e/rebuild-journey.spec.js`.

## Phase 5 — close structural gaps, then verify

Run the client structural suite first and repair only real target-state
violations. The transitional exception arrays must remain empty.

Required gate order:

1. focused F1 structural tests and `git diff --check`;
2. `npm run typecheck`;
3. `npm test`;
4. `npm run test:client`;
5. `npm run build` with no UI flag;
6. `npm run visual:checks`;
7. `npm run visual:capture`;
8. `npm run visual:diff`;
9. `npm run test:e2e -- e2e/rebuild-journey.spec.js` against the default
   production build;
10. browser inspection of the final production server in both themes, route
    smoke, responsive overflow, and console/network audit.

Visual capture must now see `html[data-shell="next"]`; a report that contains
the old “shell marker absent” skip is a gate failure at F1.

## Commit, merge, and recovery discipline

- Start from a clean `rebuild` checkpoint and branch
  `unit-28-f1-flip-deletion-s3`.
- Commit implementation and evidence on the unit branch.
- Merge only after all gates pass; then record the merge SHA in `PROGRESS.md`
  and push `rebuild`.
- Do not touch `main`.
- If a phase fails, keep the branch and evidence; repair forward. Do not
  restore legacy files merely to make an old structural test green.
- The final production process is started only after the post-merge build and
  health checks succeed, and it remains running for user inspection.
