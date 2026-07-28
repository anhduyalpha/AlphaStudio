---
name: build-goal
description: Interactive PLAN.md execution loop — preflight the repo, then execute eligible work units one at a time through the /next-unit protocol, narrating each, until a stop condition fires (3 units done, context compaction, BLOCKED/SPLIT, ALL-DONE, usage-limit or auth error).
disable-model-invocation: true
---

# /build-goal — preflight, then loop units interactively

The user is watching this session live. Narrate: short, plain-language updates
at each step — never a wall of raw tool output. Full command tails belong in
`evidence/unit-<n>.md`, not in the chat.

**Permission modes are the user's.** They set the mode themselves (Shift+Tab).
Never assume, request, or switch a permission mode, and never pass permission
flags to anything. A denied tool call is a user decision — surface it; if it
blocks the unit, that is a BLOCKED outcome, not something to retry verbatim.

**Shared logic.** Unit execution lives ONLY in
`.claude/skills/next-unit/SKILL.md`. Read that file once at the start and
follow its protocol verbatim for every unit. Never restate or improvise unit
steps here — a fix to the unit protocol lands only there.

## Preflight — all five checks, in order; abort on the first failure

Abort = print `PREFLIGHT FAILED — <check>: <what is wrong and how to fix it>`
and stop. Never start a unit after a failed preflight.

0. `git fetch origin` (tolerate offline), then `git checkout rebuild`
   (create it from main per /next-unit step 0 if it does not exist yet).

1. **Clean tree.** `git status --porcelain` must be empty. One exception
   (matches /next-unit step 0): dirt confined to `PROGRESS.md`,
   `.claude/allowed-paths.txt`, or `evidence/` is interrupted-run
   bookkeeping — commit it on rebuild as `progress: recover bookkeeping` and
   continue. Any other modified, staged, deleted, or untracked file aborts,
   naming each file.

2. **No unresolved SPEC open questions.** Read SPEC.md §8. Every question
   listed there must appear in PLAN.md's "Deferred decisions (SPEC §8)" table
   as explicitly non-blocking (the undecided part excluded from its unit's
   scope). A question absent from that table, or one the table does not mark
   deferred, aborts — quote the question; it needs a human decision before
   any automated execution.

3. **Every unit is verifiable.** Every PROGRESS.md row maps to a PLAN.md unit
   whose **Completion** line names at least one runnable command; UI units are
   additionally gated by the automated visual checks (`visual:checks`,
   `visual:capture` + `visual:diff`, visual-judge) per /next-unit step 6. A
   unit with neither a completion command nor a visual gate aborts, naming it.
   A row with status `manual` also aborts (PROGRESS.md declares zero).

4. **Visual pipeline is live.** The baseline store exists in git
   (`git ls-files visual/baselines` is non-empty) and `npm run visual:diff`
   exits 0 against the current captures — paste its last lines. An empty
   baseline set is legitimate only while no UI unit is `done` (the
   pre-rebuild state, per `visual/baselines/README.md`); if a done UI unit's
   evidence names accepted baseline ids that are missing from
   `visual/baselines/`, abort. A non-zero diff exit aborts with its output.

5. **PROGRESS.md is consistent with git.**
   - `node .claude/harness/select-unit.mjs` parses and prints counts.
   - Every `done` row: its recorded sha exists (`git cat-file -e <sha>`), is
     an ancestor of rebuild (`git merge-base --is-ancestor <sha> rebuild`),
     and its `evidence/unit-<n>.md` exists.
   - No row is `in-progress`. An in-progress row means an interrupted run:
     abort and direct the user to run **/continue-goal** instead — it
     reconciles; this command deliberately does not.
   Any inconsistency aborts, naming the row.

## Unit loop

Repeat until a stop condition (below) fires:

1. **Select** exactly as /next-unit step 1 does
   (`node .claude/harness/select-unit.mjs`). ALL-DONE and STALLED are handled
   by the stop conditions.

2. **Header** — before touching anything, print:

   ```
   ── Unit <n> (<id>) — <name> ──────────────────────
   Allowed paths: <the unit's Files list from PLAN.md, plus its test locations>
   Gates: <completion commands from PLAN.md> · visual:checks ·
          visual:capture+diff · visual-judge · spec-reviewer
   ```

3. **Execute** the full /next-unit protocol (steps 0–10) for this unit.
   While working, narrate transitions ("gates 1–3 green, launching the visual
   judge"), not tool output.

4. **Footer** — after the unit ends, print its outcome (`DONE <n>` /
   `BLOCKED` / `SPLIT`), what merged (merge sha, evidence file), and which
   unit is eligible next (or why none is).

## Stop conditions — stop when ANY fires

- **3 units** reached DONE in this invocation.
- **Context compaction** has fired once (a conversation summary appeared in
  this session). If it fires mid-unit: bring the unit to a safe point — never
  merge unverified work; if it cannot be finished cleanly, push its branch if
  possible and leave its row `in-progress` for /continue-goal — then stop.
- A unit ends **BLOCKED** or **SPLIT** (including a STALLED selection, which
  /next-unit reports as BLOCKED).
- **ALL-DONE** — run /next-unit's Finish section (the rebuild→main PR) first,
  then stop.
- A **usage-limit or auth error** from any model or tool call. Stop
  immediately. **Never retry into a usage limit** — no backoff loops, no
  "one more try", no waiting it out inside the session.

Hard rule, restated from /next-unit: a unit whose push failed is never marked
done — leave it `in-progress` and stop.

## Stop report — always print when stopping, whatever the reason

1. **Units completed this run** — numbers, ids, merge shas (or "none").
2. **Current state** — PROGRESS.md counts (todo / in-progress / done /
   blocked), current branch, and any in-progress or blocked row with its
   reason.
3. **Exact next step** for the user:
   - 3-unit limit or context compaction → run `/clear`, then `/continue-goal`.
   - usage-limit or auth error → switch account or wait for the reset window,
     then run `/continue-goal`.
   - BLOCKED / SPLIT → the specific decision the user must make, then
     `/continue-goal`.
   - ALL-DONE → the PR URL awaiting human review and merge.
