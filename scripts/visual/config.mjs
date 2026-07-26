// Visual-verification thresholds. THIS FILE IS FROZEN FOR AGENT RUNS:
// it is on the PreToolUse unconditional deny list (.claude/hooks/) — a unit
// may never edit a threshold to get green. Changing these is a human decision.
//
// Rationale per value:
// - PIXEL_CHANNEL_TOLERANCE 25/255 (~10%): ignores font-antialiasing and
//   subpixel jitter between runs on the same machine, far below any real
//   styling change (a token/color/border change moves channels much more).
// - DIFF_FAIL_RATIO 0.001 (0.1% of pixels): a 1px border or icon shift on a
//   component crop is hundreds of pixels — comfortably above this — while
//   run-to-run noise on frozen-animation captures is essentially zero.
// - DISTINCT_MIN_RATIO 0.002 (0.2%): two required §4.4 states of the same
//   component must differ by at least this much to count as "visually
//   distinct"; the smallest legal treatment (a 2px focus ring on a small
//   control crop) exceeds it, identical renders (0.0) fail it.
// - CLS_LOAD_MAX 0.05: stricter than the web-vitals "good" bound (0.1)
//   because this is a local app with local fonts and SPEC §2.4 requires
//   skeletons to reserve space; CLS_INTERACT_MAX 0.01: SPEC §5.4 says layout
//   never moves neighbors on interaction — 0.01 is measurement noise, not an
//   allowance.
// - CONTRAST_TEXT 4.5 (WCAG 2.1 AA normal text) for text tokens on surfaces.
// - CONTRAST_ON_ACCENT 3.0: --on-accent on --accent is checked at the WCAG
//   UI-component/large-text bound because SPEC §4.1's own values (#fff on
//   #9b7cff ≈ 3.1:1) cannot meet 4.5:1 — recorded as a SPEC tension, see the
//   harness report; raising this constant would fail SPEC's own token table.
// - CONTRAST_STATUS 3.0: status colors as short bold badge/label text.

export default {
  PIXEL_CHANNEL_TOLERANCE: 25,
  DIFF_FAIL_RATIO: 0.001,
  DISTINCT_MIN_RATIO: 0.002,
  CLS_LOAD_MAX: 0.05,
  CLS_INTERACT_MAX: 0.01,
  CONTRAST_TEXT: 4.5,
  CONTRAST_ON_ACCENT: 3.0,
  CONTRAST_STATUS: 3.0,
  VIEWPORT: { width: 1440, height: 900 },
  CLIENT_PORT: 16173,
  SERVER_PORT: 16787,
};
