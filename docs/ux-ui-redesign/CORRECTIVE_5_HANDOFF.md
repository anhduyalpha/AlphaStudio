# Corrective Phase 5 Handoff — Audio

## Structural change
`AudioView.jsx` is no longer a ModularWorkspaceView wrapper.

## Primary objects
- File load + FileRow
- Native audio player
- WaveformStrip (Web Audio peaks + static fallback)
- TimelineRange for trim selection
- SegmentedControl modes: convert / trim / normalize / inspect

## Backend
`run('media', { family: 'audio', operation, format, quality, start, duration })` preserved.

## Tests
`ui-audio-workspace-struct.test.ts`

## Residual
Screenshot after-matrix for audio deferred to C9 (or mid-phase capture when convenient).
