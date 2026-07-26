---
name: continue-goal
description: Recovery plus continuation after an interrupted /build-goal run — reconcile PROGRESS.md against git (restarting any in-progress unit whose work never landed), report what happened, then run the same unit loop and stop conditions as /build-goal.
disable-model-invocation: true
---

# /continue-goal — reconcile first, then continue the loop

Assume the previous run was cut off mid-unit. Nothing in PROGRESS.md is
trusted until checked against git. The user is watching — narrate what you
find and what you do about it, in plain language.

Standing rules are shared, not duplicated:
- Permission modes belong to the user (Shift+Tab) — never assume, request,
  or switch one; a denied tool call is a user decision.
- Unit execution lives ONLY in `.claude/skills/next-unit/SKILL.md`.
- The preflight, unit loop, stop conditions, and stop report live ONLY in
  `.claude/skills/build-goal/SKILL.md`.
Read both files before starting.

## 1. Reconcile disk state — before any work

`git fetch origin` (tolerate offline), `git checkout rebuild`. Read
PROGRESS.md and `git log --oneline -20 rebuild`, plus local and remote
branches (`git branch --list 'unit-*'`, `git ls-remote --heads origin
'unit-*'`; tolerate offline for the remote half).

**`done` rows** — verify each: recorded sha exists, is an ancestor of
rebuild, evidence file exists. A done row that fails verification is NOT
silently fixed: report it and stop — that state needs the user.

**`in-progress` rows** — never assume an in-progress unit is done. For each:

- **Landed, bookkeeping lost**: the unit branch is merged into rebuild (its
  merge commit is reachable from rebuild) AND `evidence/unit-<n>.md` records
  the gates green. Only step 9 of /next-unit was lost: set the row `done`
  (merge sha, evidence link in notes), commit
  `progress: unit <n> done (recovered)`, push rebuild. Say so.
- **Anything less** — a branch with unmerged commits, an empty branch, or no
  branch at all: the unit did NOT land. Announce it out loud BEFORE acting,
  listing any commits being discarded (`git log rebuild..<branch> --oneline`),
  then reset: delete the local branch (`git branch -D <branch>`) and its
  remote copy if one exists (`git push origin --delete <branch>`, tolerate
  absence), set the row back to `todo` (clear the branch and commit cells),
  commit `progress: reset unit <n> after interrupted run`, push rebuild. The
  unit restarts from scratch through the normal loop.

**`blocked` rows** — leave untouched; collect their reasons for the report.

Also commit stray bookkeeping dirt (PROGRESS.md / `.claude/allowed-paths.txt`
/ `evidence/`) as `progress: recover bookkeeping`, exactly as /build-goal
preflight does.

## 2. Report — before starting any unit

- **Done**: which units, verified against git.
- **Interrupted**: each in-progress row found and how it was handled
  (recovered as done vs reset to todo — and what, if anything, was discarded).
- **Blocked**: each blocked row, its recorded reason, and which units it
  transitively stalls (deps graph from select-unit's JSON).
- **Next**: what the loop will pick first, or why nothing is eligible.

## 3. Continue

Run /build-goal's **Preflight** (step 1 above should have cleared every
in-progress row — if preflight still fails, stop with its message), then its
**Unit loop**, honoring the same **Stop conditions** and printing the same
**Stop report**, all exactly as written in
`.claude/skills/build-goal/SKILL.md`.
