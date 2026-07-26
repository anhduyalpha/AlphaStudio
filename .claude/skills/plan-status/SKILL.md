---
name: plan-status
description: Read-only recovery report over PROGRESS.md and git — what's done, what's in-progress (and whether it actually landed or needs restarting), what's blocked and why, and what /next-unit would pick next. Optionally pass an alternate PROGRESS.md path as the argument.
disable-model-invocation: true
disallowed-tools: Write, Edit, NotebookEdit
argument-hint: [path-to-PROGRESS.md]
---

# /plan-status — report, never mutate

Strictly read-only: no file writes, no git mutations (no checkout/commit/push),
no PROGRESS.md edits. If passed an argument, treat it as the PROGRESS.md path
(used for simulations); default `./PROGRESS.md`.

## Procedure

1. Parse the table: `node .claude/harness/select-unit.mjs --file <path>` gives
   the counts, the next pick (or ALL-DONE/STALLED), and the JSON detail. Also
   read the file yourself for branch/commit/notes columns.

2. **Done units** — for each `done` row, verify the claim: recorded sha exists
   (`git cat-file -e <sha>`), branch pushed (`git ls-remote --heads origin <branch>`),
   PR link present in notes. Report any done row that fails verification as
   SUSPECT.

3. **In-progress units** — for each, determine whether work actually landed or
   the unit needs restarting:
   - `git branch --list <branch>` / `git ls-remote --heads origin <branch>` —
     does the branch exist locally/remotely?
   - `git log main..<branch> --oneline` — any commits beyond main?
   - `gh pr list --head <branch> --state all` — PR opened?
   Classify:
   - **landed, bookkeeping missed**: PR exists / branch pushed with commits →
     only step 9 (mark done) remains; say exactly that.
   - **partial**: local branch with commits, not pushed → resumable; /next-unit
     will refuse (row inconsistent), so recommend the human either push+PR
     manually or reset the row to `todo` after salvaging/deleting the branch.
   - **needs restart**: no branch or empty branch → the run died before real
     work; safe to set the row back to `todo` (recommend it; do not do it).

4. **Blocked units** — list each with its notes reason and which units it
   transitively stalls (walk the deps graph from the JSON).

5. **Next** — report what /next-unit would pick (from step 1), or why nothing
   is eligible.

6. Summarize: counts (todo / in-progress / done / blocked / manual), next pick,
   required human actions (unblock decisions, restart confirmations, splits).
