# Unit 8 (C1) — Tokens and base styles

- **Date:** 2026-07-27
- **Branch:** `unit-8-c1-tokens-base`
- **Outcome:** BLOCKED at gate 2. Gate 1 green; gate 2 (`visual:checks`) fails
  for two reasons, **neither caused by this unit's code**, and neither fixable
  within a unit's authority. Gates 3–4 not reached (gates run in order).

## Delivered

| File | What |
|---|---|
| `src/styles/tokens.css` | Complete SPEC §4.1 color table (dark + light), §4.5 non-color tokens, §5.2 timing tokens. Values transcribed literally from SPEC. |
| `src/styles/base.css` | Document reset + §4.5 type scale on bare elements. Token-pure: no color/duration/easing/radius/type literal. |
| `src/tests/styles-tokens.test.ts` | The §4.6 token-purity structural test PLAN's Completion line requires, plus literal pinning of the §4.1/§4.5/§5.2 value tables. |

Design note: each type step publishes `-size` / `-line` / `-weight` (what
declarations need, and what `font-size: var(--text…)` purity requires) plus a
`font` shorthand **composed from those parts** — the literals live in one place.

## Gate 1 — `npm run test:client` — PASS

```
 Test Files  4 passed (4)
      Tests  136 passed (136)
   Duration  966ms
TESTCLIENT_EXIT=0
```

Non-vacuity check (mutation probe: four violating declarations appended to
`base.css`, run, then reverted — `base.css` restored, verified clean):

```
 × base.css carries no design literals 14ms
AssertionError: expected [ …(4) ] to deeply equal []
+   "base.css:159 hex color literal: color: #ff0000;",
+   "base.css:160 un-tokenized border-radius: border-radius: 7px;",
+   "base.css:161 un-tokenized padding: padding: 13px;",
+   "base.css:162 literal duration: transition: color 250ms linear;",
      Tests  1 failed | 96 passed (97)
```

## Gate 2 — `npm run visual:checks` — FAIL (exit 1)

```
FAIL    token-purity (§4.6) [38 file(s)]
         ✗ src\components\pdf\PdfPageOrganizer.jsx:354 design constant in JSX style={}: style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: '0.5rem' }}
         ✗ src\components\pdf\PdfPageOrganizer.jsx:367 design constant in JSX style={}: style={{ border: isSelected ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border, #333)', borderRadius: 8, pad
         ✗ src\views\ColorView.jsx:127 design constant in JSX style={}: <div style={{ height: 120, borderRadius: 16, background: hex, border: '1px solid var(--border)' }} />
         ✗ src\views\ColorView.jsx:135 design constant in JSX style={}: style={{ height: 64, borderRadius: 12, border: '1px solid var(--border)', background: c }}
         ✗ src\views\ColorView.jsx:147 design constant in JSX style={}: <div style={{ padding: 24, borderRadius: 16, background: bg, color: fg, border: '1px solid var(--border)' }} data-testid
         ✗ src\views\ColorView.jsx:158 design constant in JSX style={}: <div style={{ height: 200, borderRadius: 16, border: '1px solid var(--border)', background: `linear-gradient(135deg, ${g
         ✗ src\views\DeveloperView.jsx:82 design constant in JSX style={}: <p className="helper-note" style={{ margin: 0, color: 'var(--danger, #f87171)' }}>{error}</p>
         ✗ src\views\ProfileView.jsx:93 design constant in JSX style={}: <section className="profile-layout" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1.4fr) minmax(240
PASS    motion-purity (§5.2/§5.3) [1 file(s)]
FAIL    contrast (WCAG AA on §4.1 tokens)
         ✗ dark: --text-3 on --bg-raised = 4.44:1 < 4.5:1 (text)
         ✗ dark: --text-3 on --surface = 4.31:1 < 4.5:1 (text)
         ✗ dark: --text-3 on --surface-2 = 4.06:1 < 4.5:1 (text)
         ✗ light: --text-3 on --bg = 4.46:1 < 4.5:1 (text)
         ✗ light: --text-3 on --bg-raised = 4.22:1 < 4.5:1 (text)
         ✗ light: --text-3 on --surface-2 = 4.35:1 < 4.5:1 (text)
CHECKS_EXIT=1
```

`motion-purity PASS [1 file(s)]` is this unit's `base.css`. The CSS side of
token-purity is likewise clean — all 8 violations are **old-client JSX**.

### Blocker 1 — the checks' phase heuristic misreads the C1 state

`scripts/visual/run-checks.mjs:26-33` picks which JSX to scan:

```js
const transitional = fs.existsSync(path.join(root, 'src/next'));
const flipped = !transitional && fs.existsSync(path.join(root, 'src/styles'));
const jsxDirs = (transitional ? ['src/next', 'src/workbench']
  : flipped ? ['src/components', 'src/views', 'src/workbench'] : []);
```

Its own comment says the old client "is exempt (F1 deletes it)" while the
rebuild is in flight. But "in flight" is detected as *`src/next` exists*, and
**C1 is the unit that creates `src/styles`, while the first unit to create
`src/next` is C2 (unit 9)**. So the moment C1 lands, the repo matches the
post-F1 `flipped` branch and the harness starts enforcing new-client rules on
old-client code that F1 is going to delete.

C1 cannot avoid this: `contrast.mjs:47` hardcodes `src/styles/tokens.css`, so
the token file has nowhere else to live. Confirmed by direct probe before any
file was written — the same 8 violations appear purely as a function of
`src/styles/` existing.

Not fixable by this unit: the fix is either an edit to a **check** (forbidden
forever — /next-unit step 6) or edits to out-of-scope old-client files that
PLAN assigns to F1.

### Blocker 2 — SPEC §4.1's own `--text-3` fails SPEC's own WCAG gate

`--text-3` as specified (`#717b90` dark, `#6b7280` light) is below
`CONTRAST_TEXT` 4.5:1 on 6 of the 8 surface pairings the check tests. The two
that pass (dark on `--bg` 4.68, light on `--surface` 4.83) suggest the values
were checked against one surface per theme rather than all four.

This is the same class of conflict `config.mjs` already records for
`--on-accent` (threshold documented down to 3.0 because "SPEC §4.1's own values
cannot meet 4.5:1") — but for `--text-3` no such allowance exists.

Not fixable by this unit: lowering the threshold is forbidden and `config.mjs`
is hook-denied; changing the values means amending a **normative SPEC table**,
which is a human decision (and C1's stated acceptance is "the complete token
tables of §4.1").

Smallest hue-preserving amendment that clears all four surfaces in both themes
(computed with the harness's own `ratio()`, on rounded 8-bit values):

| Theme | SPEC | Proposed | worst pairing before → after |
|---|---|---|---|
| dark | `#717b90` | `#798396` (5.7% toward white) | `--surface-2` 4.06 → 4.52 |
| light | `#6b7280` | `#676d7b` (4.0% toward black) | `--bg-raised` 4.22 → 4.53 |

## Gates 3–4 — not reached

Gates run in order and gate 2 is red. For the record, `visual:diff` was green at
preflight (`PASS — 0 baseline(s) verified, 1 capture(s) accounted for`) and C1
introduces no rendered surface — it adds no capture target and accepts no
baseline (the files are not imported by the pre-rebuild client).

## Decisions needed to resume

1. **Blocker 1** — either (a) a human edit to `run-checks.mjs` so `flipped` keys
   on something that actually marks the flip (e.g. the old entry `src/App.jsx`
   being gone) rather than on `src/next` being absent — the correct fix; or
   (b) authorize C1 to also create a tracked placeholder under `src/next/`, so
   the repo reads as `transitional` from C1 onward without any check changing.
2. **Blocker 2** — either amend SPEC §4.1's `--text-3` (table above), or record
   a documented threshold tension in `config.mjs` as was done for `--on-accent`.

Both are one-line changes once decided. The unit's code is complete and gate-1
green; resuming means re-running gates 2–4 on this branch.
