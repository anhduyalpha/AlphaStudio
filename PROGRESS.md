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
| 9 | C2 | Primitives I: controls and status | in-progress | unit-9-c2-primitives-controls-status | — | 1,8 | state matrix auto-verified via gallery captures once D2 lands; until then judge verdicts run on this unit's own renders |
| 10 | C3 | Primitives II: file and flow | todo | — | — | 9 | |
| 11 | C4 | Primitives III: overlay and chrome | todo | — | — | 9 | |
| 12 | D1 | Shell skeleton: entry flag, router, hub registry | todo | — | — | 5,9 | verify index.html heuristic claim before deleting |
| 13 | D2 | Shell chrome and Asset Gallery | todo | — | — | 11,12 | |
| 14 | D3 | Workbench and panel registry | todo | — | — | 4,5,9,10,12 | |
| 15 | E1 | Convert hub | todo | — | — | 7,14 | flagged: own detailed plan; e2e centerpiece |
| 16 | E2 | PDF hub config + export/operations | todo | — | — | 14 | |
| 17 | E3 | PdfOrganizerPanel | todo | — | — | 16 | flagged: own detailed plan; heaviest panel |
| 18 | E4 | Media hub + preview/crop | todo | — | — | 14 | |
| 19 | E5 | Media editor panels | todo | — | — | 18 | |
| 20 | E6 | Text & Dev hub | todo | — | — | 14 | |
| 21 | E7 | Security & Archive hub | todo | — | — | 14 | |
| 22 | E8 | Utilities hub | todo | — | — | 14 | dual local+job run shape |
| 23 | V1 | Home view + ResumeStrip placements | todo | — | — | 5,10,13 | |
| 24 | V2 | Activity view | todo | — | — | 9,13 | |
| 25 | V3 | Settings + Profile views | todo | — | — | 9,13 | deferred-decision: density ships inert (SPEC §8.2) |
| 26 | F0 | Motion system | todo | — | — | 9,10,11,13,14,15,16,17,18,19,20,21,22,23,24,25 | deferred-decision: ambient beyond ambient-1 excluded (SPEC §8.1) |
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
