# RQ2 Handoff — Audio/Media trim honesty + encode controls

## Delivered
- `src/lib/mediaJobOptions.js` — mode-honest option builder
- Audio/Media rails: trim stream-copy by default; optional re-encode; normalize LUFS; quality preset shows sample rate / channels / bitrate
- Backend trim honors `forceReencode` / `reencode` with format encode path

## Tests
- `media-job-options.test.ts`
- `ui-audio-media-options-struct.test.ts`

## Next
RQ3 interactive image crop
