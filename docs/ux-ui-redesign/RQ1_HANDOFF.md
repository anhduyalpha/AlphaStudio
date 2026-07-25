# RQ1 Handoff — Typed job results + auth-safe preview

## Delivered
- `src/lib/jobResultKind.js` — classify image/text/json + JSON payload kinds
- `src/hooks/useJobPreviewUrl.js` — `fetchJobBlob` → object URL (revoked on change)
- `src/components/results/JobResultBody.jsx` — hash, compare, password, signature, metadata, media-inspect, archive-listing, image, text, JSON
- `JobOutputCard` embeds typed body when completed
- `ImageView` compare uses object URL (no fake `previewUrl` / `outputFileId`)

## Preserved
- Job download/delete contracts; no new backend routes required

## Tests
- `server/tests/job-result-kind.test.ts`
- `server/tests/ui-job-result-renderers-struct.test.ts`

## Next
RQ2 audio/media trim honesty + encode controls; RQ3 interactive crop builds on compare.
