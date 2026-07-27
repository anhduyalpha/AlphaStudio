# Unit 8 (C1) — Tokens and base styles

- **Date:** 2026-07-27
- **Branch:** `unit-8-c1-tokens-base`
- **Outcome:** merged. All four gates green; two spec-review rounds addressed.

This unit was BLOCKED on its first attempt by two causes outside its own code.
Both are now resolved, and the resolutions are recorded below because neither is
obvious from the final diff.

## Delivered

| File | What |
|---|---|
| `src/styles/tokens.css` | Complete SPEC §4.1 color table (dark + light), §4.5 non-color tokens, §5.2 timing tokens. |
| `src/styles/base.css` | Document reset + §4.5 type scale on bare elements. Token-pure. |
| `src/tests/styles-tokens.test.ts` | The §4.6 purity test PLAN's Completion line requires, plus literal pinning of the §4.1/§4.5/§5.2 value tables **and** the WCAG bound on `--text-3`. |
| `src/tests/styles-purity.test.ts` | Companion scan closing three holes the frozen checks share (round 2, finding 3), plus the D1 tripwire for the stylesheet collision (finding 1). |
| `SPEC.md` | §4.1 `--text-3` amended + an explanatory note. **Normative change — see below.** |

Neither stylesheet is imported by anything, as PLAN requires.

Design note: each type step publishes `-size` / `-line` / `-weight` (what
declarations need, and what `font-size: var(--text…)` purity requires) plus a
`font` shorthand **composed from those parts** — no literal is duplicated.

## The two original blockers, and how they cleared

**Blocker 1 — the checks' phase heuristic.** `scripts/visual/run-checks.mjs`
picks which JSX to scan from `src/next` / `src/styles` existence. C1 creates
`src/styles`, and the first unit to create `src/next` is C2 — so on C1's first
attempt the repo matched the post-F1 `flipped` branch and the harness enforced
new-client rules on old-client JSX (8 violations in `ColorView.jsx`,
`PdfPageOrganizer.jsx`, `DeveloperView.jsx`, `ProfileView.jsx`). **Resolved by
ordering, not by a code change:** unit 5 (B2) landed `src/next/hooks/useStore.js`
first, so the heuristic reads `transitional` again. Verified after unit 5 merged:
`PASS token-purity [2 file(s)]` — the old client is no longer scanned. No edit to
any check was needed, and none was made.

**Blocker 2 — SPEC contradicted its own WCAG gate.** `--text-3` as originally
specified (`#717b90` / `#6b7280`) fell below `CONFIG.CONTRAST_TEXT` 4.5:1 on 6 of
the 8 surface pairings the `contrast` check measures, so C1 could not be both
faithful to §4.1 and green. The user approved amending §4.1 to `#798396` /
`#676d7b`. **The user reported the amendment done, but their commit `2b98336`
contained only the deletion of the stale token test — `SPEC.md` was untouched**
(verified: `git show 2b98336 --stat` = 295 deletions in one test file), so the
edit is made in this unit, limited to that one row plus a note. `SPEC.md` is not
a PLAN-declared path for C1; the exception is recorded in
`.claude/allowed-paths.txt`. **A human should confirm the amendment on the
record** — PLAN calls SPEC frozen, and the in-repo approval trail is
agent-authored.

### The amendment, proven

All 8 pairings, computed from the delivered `tokens.css` using the harness's own
`ratio()` and `CONFIG.CONTRAST_TEXT`, parsed with the same block scan
`contrast.mjs` uses:

```
threshold: CONFIG.CONTRAST_TEXT = 4.5:1 (WCAG 2.1 AA, normal text)

theme  fg        value    on              value    ratio    min   verdict
dark   --text-3  #798396  --bg            #070911    5.207   4.5  PASS
dark   --text-3  #798396  --bg-raised     #0d1020    4.946   4.5  PASS
dark   --text-3  #798396  --surface       #101422    4.803   4.5  PASS
dark   --text-3  #798396  --surface-2     #151a2c    4.523   4.5  PASS
light  --text-3  #676d7b  --bg            #f3f6fb    4.787   4.5  PASS
light  --text-3  #676d7b  --bg-raised     #eaf0fa    4.529   4.5  PASS
light  --text-3  #676d7b  --surface       #ffffff    5.185   4.5  PASS
light  --text-3  #676d7b  --surface-2     #f0f3fa    4.668   4.5  PASS

pairings: 8   pass: 8   fail: 0
worst margin above threshold: +0.023
```

The two themes bound the value from **opposite** directions — in dark, contrast
rises with lightness, so `#798396` is the darkest that clears; in light it is the
lightest. The §4.1 note now states this per theme (it originally said "lightest …
in both themes", which was backwards for dark — round 2, finding 2).

Because the margin is ~0.02, the bound is pinned in the fast suite as well as the
browser gate: 8 assertions in `styles-tokens.test.ts` fail if `--text-3` **or any
of the four surfaces** drifts.

## Gate 1 — `npm run test:client` + `npm run typecheck` — PASS

```
 Test Files  9 passed (9)
      Tests  223 passed (223)
TESTCLIENT=0

> tsc -p server/tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
TYPECHECK=0
```

### Non-vacuity of the delivered token test

The old `--text-3` values put back into `tokens.css`, suite re-run, file restored:

```
tokens.css sha256 before: ee1fae51065cf7b1d5327085af733b9c225ca77620af1b2d45ddc71ecb07126a
mutation applied: --text-3 reverted to #717b90 (dark) / #6b7280 (light)

suite failed: true
Tests  8 failed | 98 passed (106)
failing tests (8):
  × dark --text-3
  × light --text-3
  × 'dark' --text-3 on '--bg-raised'
  × 'dark' --text-3 on '--surface'
  × 'dark' --text-3 on '--surface-2'
  × 'light' --text-3 on '--bg'
  × 'light' --text-3 on '--bg-raised'
  × 'light' --text-3 on '--surface-2'

tokens.css sha256 after restore: ee1fae51065cf7b1d5327085af733b9c225ca77620af1b2d45ddc71ecb07126a
byte-for-byte identical: true
suite green after restore: true
```

Both value assertions fail, and exactly the 6 pairings that genuinely breach AA
fail — the 2 that the old values *did* clear (dark on `--bg` 4.675, light on
`--surface` 4.834) correctly stay green. The test is sensitive to the amendment
in two independent ways, not blunt.

### Non-vacuity of the companion purity scan

Violating declarations appended to `base.css`, then restored:

```
appended: font shorthand with literals · leading-dot duration · second box decl on one line
companion suite failed? true
failing tests (3):
  × base.css uses no un-tokenized font shorthand
  × base.css uses no literal duration, including leading-dot forms
  × base.css tokenizes every box declaration on a line, not just the first

base.css byte-for-byte identical: true
companion suite green after restore: true
```

Each shape isolated against the frozen matchers, to confirm the gaps are real:

```
MISSED  by frozen checks: font shorthand         ->  font: 500 13px/1.4 Inter, sans-serif;
MISSED  by frozen checks: leading-dot duration   ->  transition: opacity .3s ease;
MISSED  by frozen checks: violating 2nd box decl ->  padding: var(--space-2); margin: 3px;
```

(An earlier combined mutation appeared "caught" only because it put the violating
value in the *first* box declaration, which the frozen regex does see.)

## Gate 2 — `npm run visual:checks` — PASS

```
PASS    token-purity (§4.6) [2 file(s)]
PASS    motion-purity (§5.2/§5.3) [1 file(s)]
PASS    contrast (WCAG AA on §4.1 tokens)
CHECKS=0
```

First unit at which all three checks pass with no PENDING: `contrast` finally has
a `tokens.css` to verify, and `motion-purity` a stylesheet to scan.

## Gate 3 — capture + diff — PASS

```
[visual:capture] captured=1 missing=268 → visual\captures
CAPTURE=0
[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s) accounted for.
DIFF=0
```

No baseline accepted: C1 renders nothing (its files are imported by nothing), so
it introduces no capture target. The single capture is the old client's home,
which this unit neither builds nor changes; the 268 missing targets belong to
later units.

**Flakiness worth recording:** this gate failed four times before passing, on
`page.goto: Timeout 30000ms exceeded`. Diagnosed rather than retried blindly —
the page loads correctly in **33.9s** with zero console errors, zero failed
requests, and no external requests at all (every `@import` is local). The cause
was CPU contention from an unrelated Vite dev server (another project under
`Downloads/trip-planner`) that started at 06:29, exactly when the failures began.
Nothing in the check or the app was changed; it passed once contention eased. The
harness's first `page.goto` has only ~2s of margin against Playwright's 30s
default on this machine.

## Gate 4 — visual judge — not applicable

C1 renders nothing: both stylesheets are imported by nothing, so zero captures
belong to this unit and there is no artifact to judge. The §4.1 values it does
deliver are verified deterministically by gate 2's `contrast` check, which is the
stronger verification for colour tokens. Nothing was given to the judge and no
verdict was fabricated — consistent with units 1–5.

## Step 7 — spec review

Round 1 (before the amendment) produced the two blockers above. Round 2, on the
amended diff, confirmed the §4.1 transcription byte-exact (all 26 rows; all 24
theme-varying tokens redefined in the light block, so none cascades a dark value
onto a light surface), the §4.5/§5.2 sets complete, `base.css` §4.6-pure and
correctly scoped for a base layer, the type shorthands valid CSS with no
duplicated literal, and the amendment arithmetic and minimality correct — and
raised five findings. All five are addressed:

| # | Finding | Resolution |
|---|---|---|
| 1 (HIGH) | Nothing recorded that the new token set and the still-live `src/styles.css` must never load in the same document. Old `:root` defines `--text-display/-title/-section/-body/-meta` as **bare lengths** (19 `font-size: var(--text-*)` consumers) plus a translucent `--surface` and the retired cyan `--focus-ring`; `tokens.css` reuses those names with a different grammar at equal specificity, so import order decides and **neither order is safe**. Invisible to every gate. | Verified against `src/styles.css:6,28,68-72` and `src/main.jsx:4`. Recorded as a D1 constraint in PROGRESS notes and enforced by a tripwire in `styles-purity.test.ts`: no module may statically import both sets. The colliding names are SPEC's own, so renaming was not an option. |
| 2 | The §4.1 note stated the bound backwards for dark ("lightest … in both themes", "do not lighten it back"). | Note rewritten per theme with both worst pairings; the same correction applied to the `tokens.css` comments. |
| 3 | Three holes shared with the frozen checks: `font:` shorthands escape the `font-size`-only matcher (a hole this unit's own `font:` house style opens for later units), `.3s` escapes the duration lookbehind, and the box scan inspects only the first declaration per line. | Closed in `styles-purity.test.ts`, mutation-verified above. The frozen checks may not be edited, so the client suite is the only place to close them. |
| 4 | This evidence file still recorded the unit as BLOCKED with stale gate output and a mutation probe run against the deleted version of the test. | Rewritten — this file, with fresh runs of all four gates and both non-vacuity probes against the delivered files. |
| 5 | `--text-code-weight: 400` was presented as a §4.5 transcription, but §4.5 gives `--text-code` as size/line-height only; and the `font` shorthand resets `font-weight` **and** `font-variant-numeric`. | `tokens.css` now labels the 400 as a C1 decision, not a SPEC value, and records that anything needing an inherited weight or `tabular-nums` must use the three part tokens rather than the composite. |

Advisories recorded but not actioned: `font: 650 …` relies on CSS Fonts 4 numeric
weights inside the shorthand (verified in Chromium, the only engine the visual
harness and e2e use); the `toBeUndefined` assertion for
`--glass-blur`/`--gradient-brand` pins a DRY convention SPEC does not state; and
the "redefines every theme-varying token" test iterates a hardcoded key list, so
a brand-new dark-only colour token would not be caught.
