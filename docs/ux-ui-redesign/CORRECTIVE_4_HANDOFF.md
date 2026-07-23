# Corrective Phase 4 Handoff — Image + Media

## Structural change
- `ImageView.jsx`: purpose-built canvas with `CompareSlider`, operation `SegmentedControl`, contextual rail, source/result previews.
- `MediaView.jsx`: player + `TimelineRange` + metadata-driven duration; capability-honest ffmpeg banner.

## Tests
- `server/tests/ui-image-media-struct.test.ts`
- Extended assertions in `ui-workspaces-redesign-struct.test.ts`

## Residual
After-screenshot matrix deferred to C9.
