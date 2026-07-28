# PROGRESS — resumable execution state for PLAN.md

Machine-parsed by `.claude/harness/select-unit.mjs` and the `/next-unit` /
`/plan-status` skills. **This file is the only progress state** — no session
memory is assumed. Keep the table format intact: pipe-separated rows, first
cell numeric, deps as comma-separated unit numbers (ranges like `1-27` allowed),
`—` for empty.

Statuses: `todo` · `in-progress` · `done` · `blocked` · `manual`
(`manual` = never picked automatically. **Zero rows use it**: PLAN.md marks no
unit MANUAL CHECK, and as of the visual-verification harness every formerly
"manual visuals" acceptance is automated — deterministic checks
(`npm run visual:checks`), screenshot capture+diff (`visual:capture`/`visual:diff`),
and the visual-judge subagent. Nothing waits on human review during the run.)

| # | unit | name | status | branch | commit | deps | notes |
|---|------|------|--------|--------|--------|------|-------|
| 1 | A1 | Client test harness (Vitest) | done | unit-1-a1-client-test-harness | a73a815 | — | evidence/unit-1.md |
| 2 | A2 | S1: epoch event versioning | done | unit-2-a2-epoch-events | 86d9384 | — | characterization test first (AUDIT PR-5); evidence/unit-2.md |
| 3 | A3 | S2: capabilities-published contracts | done | unit-3-a3-capabilities-contracts | f26df70 | — | drift test first (AUDIT PR-4); evidence/unit-3.md; published lists carry `uploadable` (upload allowlist is narrower than the format table) — B1/E* must filter on that, not `extensions` |
| 4 | B1 | protocol/contracts.ts | done | unit-4-b1-protocol-contracts | affaa6c | 1,3 | evidence/unit-4.md; selectors return `ContractLookup` — "unrestricted" and "unknown" never collapse; hubs build file filters from `acceptAttributeFor*`, never from `extensions` |
| 5 | B2 | protocol/store.ts | done | unit-5-b2-protocol-store | ddde5ec | 1,2 | evidence/unit-5.md; two spec-review rounds found 9 correctness defects, all fixed and mutation-verified (re-introducing each fails a named test). Constraints for later units in docs/plans/UNIT-B2.md: retry MUST create a new job row (terminal immutability discards a same-row `/retry`), a queued retry composes to 30 not 0 (F2 §7.3 step 7), file ownership follows the newest attempt. Remote unit branch is pre-rebase (force-push denied by hook); the merge holds the full work |
| 6 | B3 | protocol/events.ts | done | unit-6-b3-protocol-events | ee212d9 | 2,5 | flagged: own detailed plan first (pairs with B2); evidence/unit-6.md |
| 7 | B4 | protocol/uploads.ts | done | unit-7-b4-protocol-uploads | e65bc0f | 5 | evidence/unit-7.md |
| 8 | C1 | Tokens and base styles | done | unit-8-c1-tokens-base | 188e7c0 | — | evidence/unit-8.md. **Normative SPEC change — needs human sign-off:** §4.1 `--text-3` amended to #798396 dark / #676d7b light because the original values failed SPEC's own WCAG gate on 6 of 8 surface pairings; values user-approved, but the edit was made by this unit (the user's commit only deleted the stale token test). Margin is ~0.02 — the two themes bound `--text-3` from opposite directions; re-check if any of the four surfaces changes. **D1 CONSTRAINT:** `src/styles/tokens.css` and the still-live `src/styles.css` define `--text-display/-title/-section/-body/-meta`, `--surface` and `--focus-ring` with different grammars at equal `:root` specificity — importing both in one document breaks whichever loads first, and no gate sees it. D1 must keep the two import sets mutually exclusive (flag branch or second entry); tripwire in `src/tests/styles-purity.test.ts` |
| 9 | C2 | Primitives I: controls and status | done | unit-9-c2-primitives-controls-status | a5d2b8d | 1,8 | evidence/unit-9.md; own-render state matrix reviewed in both themes; visual + spec reviewers SHIP |
| 10 | C3 | Primitives II: file and flow | done | unit-10-c3-primitives-file-flow | d494660 | 9 | evidence/unit-10.md; visual + spec reviewers SHIP |
| 11 | C4 | Primitives III: overlay and chrome | done | unit-11-c4-primitives-overlay-chrome | 5c84775 | 9 | evidence/unit-11.md; visual + spec reviewers SHIP |
| 12 | D1 | Shell skeleton: entry flag, router, hub registry | done | unit-12-d1-shell-skeleton | 9bfdbc7 | 5,9 | evidence/unit-12.md; spec reviewer SHIP; verified and removed no-op index.html heuristic |
| 13 | D2 | Shell chrome and Asset Gallery | done | unit-13-d2-shell-chrome-gallery | 175f9c4 | 11,12 | |
| 14 | D3 | Workbench and panel registry | done | unit-14-d3-workbench-registry | 6f1aaab | 4,5,9,10,12 | |
| 15 | E1 | Convert hub | done | unit-15-e1-convert-hub | b29776c | 7,14 | docs/plans/UNIT-E1.md; evidence/unit-15.md; config-driven batch board, safe recovery, current-attempt scoping, parity results; spec + visual SHIP |
| 16 | E2 | PDF hub config + export/operations | done | unit-16-e2-pdf-hub | b059714 | 14 | evidence/unit-16.md; live merge/from-images/export verified; capability/runtime parity fixed; 146 PDF + 428 client tests green |
| 17 | E3 | PdfOrganizerPanel | done | unit-17-e3-pdf-organizer | 9479231 | 16 | evidence/unit-17.md; bounded PDF.js organizer + live reorder/rotate/duplicate verified; 146 PDF + 436 client tests green |
| 18 | E4 | Media hub + preview/crop | done | unit-18-e4-media-hub | 8b8b493 | 14 | evidence/unit-18.md; live image optimize/crop + audio upload/preview/convert verified; 447 client tests green |
| 19 | E5 | Media editor panels | done | unit-19-e5-media-editors | ca6d729 | 18 | evidence/unit-19.md; decoded waveform + linked trim timeline + capability preload verified; 451 client tests green |
| 20 | E6 | Text & Dev hub | done | unit-20-e6-text-dev-hub | 5401c22 | 14 | config-driven text/editor/OCR/dev workflows |
| 21 | E7 | Security & Archive hub | done | unit-21-e7-security-archive-hub | fc01f6e | 14 | capability-driven security and archive workflows |
| 22 | E8 | Utilities hub | done | unit-22-e8-utilities-hub | 683e498 | 14 | dual local+job run shape |
| 23 | V1 | Home view + ResumeStrip placements | done | unit-23-v1-home-resume-strip | 88dd18d | 5,10,13 | |
| 24 | V2 | Activity view | done | unit-24-v2-activity-view | 119cd35 | 9,13 | |
| 25 | V3 | Settings + Profile views | done | unit-25-v3-settings-profile | 8a0a73c | 9,13 | evidence/unit-25.md; theme/motion mirrors + server-only inert density verified; live Profile preview/save/restore verified; 495 client tests green |
| 26 | F0 | Motion system | done | unit-26-f0-motion-system | fe526e2 | 9,10,11,13,14,15,16,17,18,19,20,21,22,23,24,25 | evidence/unit-26.md; all three modes computed-style verified; ambient-1 full-only; reduced zero keyframes + static indicators; 506 client tests green |
| 27 | F2 | E2E acceptance gate | todo | — | — | 2,5,6,12,13,15,26 | runs locally only (CI has no e2e/external tools); must be green on flag build before F1 |
| 28 | F1 | Flip, deletion, S3 | todo | — | — | 1-27 | flagged: own detailed plan; single point of no return |

Column semantics:
- **branch** — `unit-<n>-<slug>` once started; `—` before.
- **commit** — the merge sha into `rebuild`, recorded only at `done`, with the
  unit's `evidence/unit-<n>.md` linked in notes.
- **deps** — unit numbers that must be `done` before this unit is eligible.
- A unit is only `done` when its branch is merged into `rebuild` and pushed,
  all four verification gates green (unit commands, `visual:checks`,
  `visual:diff`, visual-judge). A failed push leaves it `in-progress` so a
  resume retries it. `main` is frozen until the final rebuild→main PR.
