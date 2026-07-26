---
name: next-unit
description: Execute exactly ONE work unit from PLAN.md end to end (select, scope, branch, implement, verify, review, PR, record), then stop. Driven headlessly by run-plan.cmd; all state lives in PROGRESS.md and git, never in session memory.
disable-model-invocation: true
---

# /next-unit — one unit, end to end, then stop

You are running headlessly (`claude -p`). Nobody can answer questions. Every
decision you cannot make alone is a BLOCKED outcome, not a question. You do
exactly one unit per invocation.

## Sentinel contract (run-plan.cmd parses your FINAL message)

Your final message MUST end with exactly one sentinel on its own last line:

- `DONE <n>` — unit n finished, PR open, PROGRESS.md updated and pushed.
- `ALL-DONE` — no todo units remain.
- `BLOCKED <n>: <one-line reason>` — unit n cannot proceed (also for a
  STALLED selection, using the lowest waiting unit's number).
- `SPLIT <n>` — unit n is too large; a proposed breakdown precedes the sentinel.

Never write any other sentinel word at the start of a line in your final
message. One sentinel, last line, nothing after it.

## Protocol

### 0. Preflight
- `git status --porcelain` must be clean and HEAD on `main`. A dirty tree or
  detached/branch HEAD means a previous run died mid-flight: if the dirt is
  only PROGRESS.md/.claude/allowed-paths.txt, commit it as
  `progress: recover bookkeeping`; anything else → do not guess, print
  `BLOCKED <n>: dirty working tree from interrupted run — run /plan-status` (use
  the in-progress unit's number, or 0 if none) and stop.
- `git pull --ff-only origin main` (tolerate offline failure; continue).

### 1. Select
Run `node .claude/harness/select-unit.mjs`.
- `ALL-DONE` → print `ALL-DONE` and stop.
- `STALLED …` → print `BLOCKED <lowest-waiting-n>: <the stalled reason>` and stop.
- `NEXT <n> <unit> <name>` → that is your unit. Also re-read its PROGRESS.md row
  yourself and sanity-check status is `todo` and deps are `done`; trust the file
  over the script if they disagree (then fix the script in a later, separate task — not now).

If the selected row's status is `in-progress` (script/file mismatch), stop with
`BLOCKED <n>: PROGRESS.md inconsistent — run /plan-status`.

### 2. Mark in-progress
Set the unit's row: status `in-progress`, branch `unit-<n>-<slug>` where
`<slug>` = unit id lowercased + short kebab name (e.g. `unit-1-a1-client-test-harness`).
Commit **that change alone** on `main`: `progress: start unit <n> (<id>)`.
(Bookkeeping-only commits to PROGRESS.md / allowed-paths.txt are the one
sanctioned direct-to-main exception; unit work itself never lands on main.)

### 3. Scope
Read the unit's **Files:** list in its PLAN.md section. Overwrite
`.claude/allowed-paths.txt` with:
- each declared file/dir from PLAN.md (one per line, repo-relative, `/` separators);
- the unit's test locations per PLAN's standing allowance ("every unit may also
  touch its own test files"): the client-test dirs A1 established for client
  units, `server/tests/` for server units, `e2e/` for F2/F1 — as narrowly as sensible;
- `docs/plans/UNIT-<id>.md` if the unit is flagged for its own detailed plan
  (units 5, 6, 15, 17, 28);
- `PROGRESS.md` (always-allowed anyway; listed for the human reader).
Commit that change alone on `main`: `progress: scope unit <n>`.
The scope-guard hook enforces this list on every Write/Edit; it also blocks
modifying ANY existing test file, everywhere, unconditionally.

### 4. Branch
`git checkout -b unit-<n>-<slug>` from main.

### 5. Implement
- Read the unit's full PLAN.md section AND every SPEC.md section it cites.
  PLAN cites, SPEC decides — on any wording difference SPEC.md wins.
- If the unit is flagged for its own detailed plan (B2/B3, E1, E3, F1): first
  write `docs/plans/UNIT-<id>.md` (goal, ordered steps, risk list, test plan),
  then follow it.
- Touch nothing outside the declared paths. Never modify or delete a test
  file — write NEW test files where a unit's acceptance requires tests.
- Where PLAN says "characterization/test first", write the failing test before
  the production change.

### 6. Verify
Run the unit's **Completion** commands from PLAN.md exactly (e.g.
`npm run test:client`, `npm test`, `npm run typecheck`, `npm run build`).
Iterate until they pass. **Paste real command output (the tail with the
pass/fail summary) into your worklog and the PR body — never assert success
without pasted evidence.** If a manual check is listed (visual matrix, parity
walkthrough), note it in the PR body as "MANUAL FOLLOW-UP" — do not claim it done.

Attempt budget: after ~5 distinct fix attempts on the same failing
verification, stop and take the BLOCKED path below.

### 7. Spec review
Launch the `spec-reviewer` subagent (defined in `.claude/agents/spec-reviewer.md`)
with: the unit number/id, its PLAN.md section text, the SPEC.md sections it
cites, and the diff range `main...HEAD`. Fix findings that affect correctness
or stated requirements; explicitly ignore style-only findings. Re-run step 6
verification after any fix.

### 8. Publish
Commit the work (conventional message, e.g. `feat(unit-<n>): <summary>`, ending
with the Claude Code co-author trailer). Then:
- `git push -u origin unit-<n>-<slug>`
- `gh pr create --base main --title "unit <n> (<id>): <name>" --body <…>` —
  body: what/why, acceptance citations into SPEC.md, pasted verification
  evidence, any MANUAL FOLLOW-UP items, the standard PR footer.
Never push to `main` (bookkeeping commits from steps 2/3/9 excepted).

### 9. Record — only after push AND PR creation succeeded
`git checkout main`, update the unit's row: status `done`, commit = branch head
sha, PR link appended to notes. Commit `progress: unit <n> done (<id>)` and
`git push origin main`.
If the push in step 8 failed: leave status `in-progress`, report why, and stop
with `BLOCKED <n>: push failed — <reason>`. Half-done must read as in-progress
on disk so a resume retries it. Never mark done on a failed push.

### 10. Stop
Print a short summary and the sentinel `DONE <n>`. Do NOT start another unit.

## Failure handling

**BLOCKED** — verification unpassable within the attempt budget, SPEC.md wrong
or self-contradictory, a required existing test is wrong, or the unit needs a
decision only the user can make:
1. `git checkout main` (leave the branch with whatever work exists, pushed if possible).
2. Set the row status `blocked`, put the one-line reason in notes.
3. Commit `progress: unit <n> blocked` and push main.
4. Print `BLOCKED <n>: <reason>`. Stop. Never work around a blocked spec, never
   weaken or edit a test to get green.

**SPLIT** — mid-implementation the unit proves larger than one unit should be:
1. Do not push a giant diff. `git checkout main`.
2. Set the row status back to `todo`, note `needs split — see latest log`.
3. Commit `progress: unit <n> needs split` and push main.
4. Print the proposed breakdown (sub-units, files, deps), then `SPLIT <n>`. Stop.

## Standing repo rules (do not relearn these the hard way)
- npm workspaces, root lockfile only — **never `npm install` inside `server/`**.
- Server suite is deliberately serial (`--test-concurrency=1`); don't parallelize.
- `fixtures/pdf/` is sha256-pinned — regenerate via `npm run fixtures:pdf`, never hand-edit.
- E2E imports `{ test, expect }` from `e2e/support/browser-audit.js`, ports 15173/18787.
- Security boundary is intentional: no auth walls, no rate limiters, don't weaken tested guards.
