---
name: next-unit
description: Execute exactly ONE work unit from PLAN.md end to end (select, scope, branch, implement, verify with deterministic + visual gates, merge into rebuild), then stop. The shared unit engine — invoked directly as /next-unit or looped by /build-goal and /continue-goal; all state lives in PROGRESS.md and git, never in session memory.
disable-model-invocation: true
---

# /next-unit — one unit, end to end, then stop

You execute exactly one unit per invocation. The session may be interactive,
but the unit protocol is not a conversation: every decision you cannot make
alone from SPEC.md/PLAN.md is a BLOCKED outcome that hands control back —
never a mid-unit question or stall. When /build-goal or /continue-goal drives
you in a loop, their narration rules apply on top; the protocol below is
identical either way.

**Branch model:** `main` is FROZEN (last known-good; hook-enforced). All work
integrates into the `rebuild` branch. Unit branches fork from `rebuild` and
merge back into `rebuild`. Only the final human-approved PR ever lands on main.

## Outcome contract (the caller — /build-goal's loop, /continue-goal, or the user — reads your FINAL message)

Your final message MUST end with exactly one outcome line on its own last line:

- `DONE <n>` — unit n merged into rebuild, PROGRESS.md updated and pushed.
- `ALL-DONE` — no todo units remain (only printed AFTER the rebuild→main PR
  of the "Finish" section is open).
- `BLOCKED <n>: <one-line reason>` — unit n cannot proceed (also for a
  STALLED selection, using the lowest waiting unit's number).
- `SPLIT <n>` — unit n is too large; a proposed breakdown precedes the sentinel.

Never write any other outcome word at the start of a line in your final
message. One outcome line, last line, nothing after it.

## Protocol

### 0. Preflight
- `git fetch origin` (tolerate offline). If branch `rebuild` does not exist:
  `git checkout -b rebuild main` and `git push -u origin rebuild` (create it
  BEFORE any other git work; never commit while on main — the hook denies it).
- `git checkout rebuild`; `git status --porcelain` must be clean. If the dirt
  is only PROGRESS.md / .claude/allowed-paths.txt / evidence/, commit it as
  `progress: recover bookkeeping`; anything else → print
  `BLOCKED <n>: dirty working tree from interrupted run — run /plan-status`
  (use the in-progress unit's number, or 0 if none) and stop.
- `git pull --ff-only origin rebuild` (tolerate offline failure; continue).

### 1. Select
Run `node .claude/harness/select-unit.mjs`.
- `ALL-DONE` → go to the **Finish** section below.
- `STALLED …` → print `BLOCKED <lowest-waiting-n>: <the stalled reason>` and stop.
- `NEXT <n> <unit> <name>` → that is your unit. Re-read its PROGRESS.md row and
  sanity-check status `todo` and deps `done`; the file wins over the script.
  If they disagree → `BLOCKED <n>: PROGRESS.md inconsistent — run /plan-status`.

### 2. Mark in-progress
Set the unit's row: status `in-progress`, branch `unit-<n>-<slug>` (`<slug>` =
unit id lowercased + short kebab name). Commit **that change alone** on
`rebuild`: `progress: start unit <n> (<id>)`.

### 3. Scope
Read the unit's **Files:** list in its PLAN.md section. Overwrite
`.claude/allowed-paths.txt` with:
- each declared file/dir from PLAN.md (repo-relative, `/` separators);
- the unit's test locations per PLAN's standing allowance (client-test dirs
  from A1, `server/tests/` for server units, `e2e/` for F2/F1 — narrowly);
- `docs/plans/UNIT-<id>.md` if the unit is flagged for its own detailed plan
  (units 5, 6, 15, 17, 28);
- `PROGRESS.md` and `evidence/` (always-allowed anyway; listed for the reader).
NEVER list `visual/baselines/`, `scripts/visual/config.mjs`, or `main` — the
hooks deny them regardless. Commit on `rebuild`: `progress: scope unit <n>`.

### 4. Branch
`git checkout -b unit-<n>-<slug>` from rebuild.

### 5. Implement
- Read the unit's full PLAN.md section AND every SPEC.md section it cites.
  SPEC.md wins on any wording difference.
- Flagged units (B2/B3, E1, E3, F1): first write `docs/plans/UNIT-<id>.md`
  (goal, ordered steps, risk list, test plan), then follow it.
- Touch nothing outside the declared paths. Never modify or delete a test
  file — write NEW test files where acceptance requires them.
- Where PLAN says "characterization/test first", write the failing test before
  the production change.
- UI units must satisfy the capture contract in `scripts/visual/manifest.mjs`
  (`html[data-shell="next"]` on the new shell; `data-vis="component/variant/state"`
  instances inside `[data-vis-gallery]` in the Asset Gallery) — the visual
  gates below read the app through that contract.

### 6. Verify — ALL FOUR GATES, in this order, all must pass
Start `evidence/unit-<n>.md` (unit, date, branch) and append the tail of every
command's real output as you go. **Never assert success without pasted output.**

1. **Unit completion commands** from PLAN.md (e.g. `npm run test:client`,
   `npm test`, `npm run typecheck`, `npm run build`). Iterate until green.
2. **Deterministic visual checks:** `npm run visual:checks` — must exit 0.
   PENDING lines are acceptable only for targets later units build; a PENDING
   for something THIS unit was supposed to build means the unit is incomplete.
3. **Screenshot capture + diff:** `npm run visual:capture` then
   `npm run visual:diff` — must exit 0. For surfaces this unit introduced:
   review each new capture yourself against SPEC §4 first, then
   `npm run visual:accept -- <id> ...` (append-only), re-run `visual:diff` to
   green, and commit the new baselines with the unit. Baselines for surfaces
   the unit did NOT build are not yours to add.
4. **Visual judge:** launch the `visual-judge` subagent
   (`.claude/agents/visual-judge.md`). Give it ONLY: (a) the capture file
   paths relevant to this unit, (b) verbatim SPEC.md criteria for those
   surfaces (the §4.4 row, §4.2 color roles, §2.4 state requirements — the
   text, not your summary). NEVER include implementation details, diffs, the
   plan, or any reasoning about how the UI was built — it judges the
   artifact, not the intent. Append every verdict + observation verbatim to
   `evidence/unit-<n>.md`.

**Judge failure policy:** if gates 1–3 pass and only the judge fails, you get
**2 fix attempts** (fix → re-run gates 2–4 → judge again). Still failing after
2 attempts → BLOCKED, quoting the judge's observations in the reason and in
PROGRESS.md notes. `NOT-ASSESSABLE` judge failures: record the `REWORD:` lines
in evidence and PROGRESS notes — they are SPEC wording work for the human, and
they still block.

**Forbidden forever:** lowering any threshold, editing/deleting a check,
overwriting or deleting a baseline, editing `scripts/visual/config.mjs`,
weakening a test. Hooks deny these; attempting them is itself a BLOCKED-worthy
signal. Attempt budget for gate 1: ~5 distinct fixes, then BLOCKED.

### 7. Spec review
Launch the `spec-reviewer` subagent with: the unit number/id, its PLAN.md
section text, the SPEC.md sections it cites, and the diff range
`rebuild...HEAD`. Fix findings affecting correctness or stated requirements;
ignore style-only findings. Re-run step 6 gates after any fix.

### 8. Integrate into rebuild — only path to done
1. `git fetch origin && git rebase rebuild` (pick up anything that landed
   since step 4). A conflict you cannot resolve trivially and safely →
   `git rebase --abort` → `BLOCKED <n>: rebase conflict with rebuild — <files>`.
2. Re-run the FULL gate suite (step 6, all four gates) post-rebase. Red →
   fix or BLOCKED. Never merge red.
3. `git checkout rebuild && git merge --no-ff unit-<n>-<slug>` then
   `git push origin rebuild` (and `git push -u origin unit-<n>-<slug>` for the
   record). Push failure → leave status in-progress, print
   `BLOCKED <n>: push failed — <reason>`, stop. Never mark done on a failed push.

### 9. Record
On `rebuild`: update the unit's row — status `done`, commit = the merge sha,
notes += `evidence/unit-<n>.md`. Commit `progress: unit <n> done (<id>)`,
push rebuild.

### 10. Stop
Print a short summary and the outcome line `DONE <n>`. Do NOT start another
unit inside this protocol — whether to continue is the caller's decision
(/build-goal's loop rules, or the user).

## Finish (selection returned ALL-DONE)
1. Verify every row is `done` and every `evidence/unit-<n>.md` exists.
2. Open ONE PR from `rebuild` to `main` with `gh pr create --base main --head
   rebuild`: body = per-unit summary table (unit, name, merge sha, link to its
   evidence file), the overall gate status, all outstanding `REWORD:` items,
   and the standard PR footer. (Creating the PR pushes nothing to main — the
   human merges it.)
3. Print the PR URL, then the outcome line `ALL-DONE`.

## Failure handling

**BLOCKED** — gate unpassable within budget, SPEC.md wrong/self-contradictory,
a required existing test is wrong, judge still failing after 2 fix attempts,
rebase conflict, or a decision only the user can make:
1. `git checkout rebuild` (leave the unit branch with whatever exists; push it
   if possible).
2. Row status `blocked`, one-line reason (+ judge observations if relevant) in
   notes. Commit `progress: unit <n> blocked`, push rebuild.
3. Print `BLOCKED <n>: <reason>`. Stop. Never work around a blocked spec,
   never weaken a test, threshold, baseline, or check to get green.

**SPLIT** — the unit proves larger than one unit should be:
1. Do not merge a giant diff. `git checkout rebuild`.
2. Row status back to `todo`, note `needs split — see latest log`. Commit
   `progress: unit <n> needs split`, push rebuild.
3. Print the proposed breakdown (sub-units, files, deps), then `SPLIT <n>`. Stop.

## Standing repo rules (do not relearn these the hard way)
- npm workspaces, root lockfile only — **never `npm install` inside `server/`**.
- Server suite is deliberately serial (`--test-concurrency=1`); don't parallelize.
- `fixtures/pdf/` is sha256-pinned — regenerate via `npm run fixtures:pdf`, never hand-edit.
- E2E imports `{ test, expect }` from `e2e/support/browser-audit.js`, ports 15173/18787;
  the visual pipeline uses its own ports 16173/16787.
- Security boundary is intentional: no auth walls, no rate limiters, don't weaken tested guards.
