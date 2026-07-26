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
| 5 | B2 | protocol/store.ts | blocked | unit-5-b2-protocol-store | — | 1,2 | spec-reviewer (step 7) stopped by user before reporting — gates 1-3 green on ac65603, branch pushed, nothing merged; evidence/unit-5.md; resume needs the spec review re-run or an explicit decision to skip it |
| 6 | B3 | protocol/events.ts | todo | — | — | 2,5 | flagged: own detailed plan first (pairs with B2) |
| 7 | B4 | protocol/uploads.ts | todo | — | — | 5 | |
| 8 | C1 | Tokens and base styles | blocked | unit-8-c1-tokens-base | — | — | gate 1 green on 7a078e6, branch pushed, nothing merged; evidence/unit-8.md. Gate 2 fails for two causes outside this unit: (1) `run-checks.mjs` phase heuristic treats "src/styles exists, src/next absent" as post-F1 and enforces new-client rules on old-client JSX (8 violations) — C1 creates src/styles, C2 is the first to create src/next; (2) SPEC §4.1 `--text-3` is below CONTRAST_TEXT 4.5:1 on 6 of 8 surface pairings. Neither fixable by a unit (checks + config.mjs are frozen; SPEC table is normative) — see evidence for the two decisions and proposed values |
| 9 | C2 | Primitives I: controls and status | todo | — | — | 1,8 | state matrix auto-verified via gallery captures once D2 lands; until then judge verdicts run on this unit's own renders |
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
