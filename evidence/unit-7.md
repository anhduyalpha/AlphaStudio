# Unit 7 (B4) — `protocol/uploads.ts`

- **Date:** 2026-07-27
- **Branch:** `unit-7-b4-protocol-uploads`
- **Outcome:** pending merge

## Delivered

| File | What |
|---|---|
| `src/protocol/uploads.ts` | The single multipart/resumable orchestrator: 8 MiB branch, normalized progress, pause/resume/cancel, recovery listing, optimistic-store reporting, and exact completed-session adoption. |
| `src/api/resumableUpload.js` | Exact saved-session lookup owned by the existing `alphastudio:upload:*` identity key; idempotent finalizing/completed recovery and serialized preflight actions. |
| `src/api/client.js` | Opt-in `includeCompleted` upload-session listing without changing legacy callers. |
| `server/src/routes/upload-sessions.ts` / `server/src/services/upload-session.ts` | Opt-in completed-session discovery; the default remains active-only. |
| `src/tests/protocol-uploads.test.ts` | Protocol branch/lifecycle/recovery/adoption suite. |
| `src/tests/resumable-upload-races.test.ts` | Direct production-controller regressions for identity, lost-finalize, pending init, pending lookup, pause, and cancel races. |
| `server/tests/upload-sessions-completed-list.test.ts` | Server contract proving legacy and opt-in listing behavior. |

## Test-first evidence

Before production implementation:

```
protocol-uploads.test.ts
FAIL Cannot find module '../protocol/uploads.js'

upload-sessions-completed-list.test.ts
FAIL expected completed session in includeCompleted=1 response
```

The race regressions were also observed red before each fix:

```
false metadata adoption: expected new upload, received prior completed file
pending preflight cancel: transport started after cancel
pending preflight pause: transport started without explicit resume
completed saved session: /api/upload-sessions/init was called
pending /init pause: no server /pause request
pending /init cancel: no server DELETE request
pending exact GET pause/cancel: actions returned before server mutation
```

## Acceptance-critical scope extension

PLAN listed only `src/protocol/uploads.ts`, but the existing server list filtered
out `completed` rows and `resumableUpload.js` discarded a completed saved id
before opening `/init`. Implementing adoption only in mocked client tests would
therefore still duplicate a real upload after a lost finalize response.

The extension is deliberately narrow:

- legacy `listUploadSessions(workspaceId)` remains active-only;
- only `{ includeCompleted: true }` adds completed rows;
- the exact file identity remains owned by `resumableUpload.js` and includes
  `lastModified` through its existing localStorage key;
- `protocol/uploads.ts` never reads storage or constructs HTTP paths.

## Gate 1 — completion commands

```
npm run test:client
Test Files  14 passed (14)
Tests       267 passed (267)

npm run typecheck
tsc -p server/tsconfig.json --noEmit
tsc -p tsconfig.client.json --noEmit
EXIT=0

node --import tsx --test --test-concurrency=1 \
  server/tests/upload-sessions-completed-list.test.ts
tests 1 · pass 1 · fail 0
```

An additional full `npm test` run was made because B4 extended a server
endpoint:

```
tests 734
pass 731
fail 2
skipped 1
duration 362134 ms
```

Both failures are pre-existing runtime/tool failures outside the B4 diff:

- `api.test.ts`: `pdf.to-images` was advertised available but the job failed;
- `pdf-to-images-selection.test.ts`: `RASTERIZER_UNAVAILABLE`.

The new completed-session test passed inside that full run. The rasterizer
environment failure is carried forward to the final whole-project validation;
it is not represented as a green server suite here.

## Gates 2–4

```
npm run visual:checks
PASS token-purity
PASS motion-purity
PASS contrast

npm run visual:capture
captured=1 missing=268

npm run visual:diff
PASS — 0 baseline(s) verified, 1 capture(s) accounted for
```

B4 renders no UI and introduces no capture target, so visual judge is not
applicable and no baseline was accepted.

## Spec review

The first review found three High issues:

1. metadata-only matching could adopt the wrong equal-name/equal-size file;
2. a `finalizing → completed` TOCTOU could still open `/init`;
3. pause/cancel could lose to preflight, pending `/init`, or pending exact GET.

All were fixed with production-controller regressions. The final independent
review reported verbatim:

```
No correctness or requirement gaps found.

Verdict: SHIP
```
