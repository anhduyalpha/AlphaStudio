# AlphaStudio UX/UI Redesign — Autonomous Implementation Plan

## 1. Goal

Redesign the complete AlphaStudio product interface into a premium minimalist,
workflow-driven experience with purposeful animation and restrained liquid/water
effects.

This plan is the single orchestration entrypoint. An agent implementing this
plan must automatically read and obey every referenced prompt file in this
directory.

Repository:

```text
https://github.com/anhduyalpha/AlphaStudio
```

Git strategy:

```text
Base branch: origin/main
Working branch: ux-ui-redesign
Final PR base: main
Final PR head: ux-ui-redesign
```

Never work directly on `main`.

---

## 2. Mandatory source files

Before editing code, read completely:

```text
prompts/ux-ui-redesign/00_GLOBAL_CONTEXT.md
prompts/ux-ui-redesign/00_SKILL_GATE.md
prompts/ux-ui-redesign/QUALITY_RUBRIC.md
prompts/ux-ui-redesign/MASTER_EXECUTION_PROMPT.md
prompts/ux-ui-redesign/STATE_TEMPLATE.json
```

Also read:

- every repository-local `AGENTS.md`;
- contribution, security, architecture, and testing instructions;
- `.ux-ui-redesign-state.json` when it already exists;
- the latest handoff under `docs/ux-ui-redesign/`;
- the prompt file for the next incomplete phase.

The phase prompt files are the authoritative detailed specifications. This plan
does not replace them; it tells the agent when and how to use them.

---

## 3. Mandatory skills

Discover, read, and apply the installed skills matching:

```text
ux-ui-pro-max
taste
```

Follow `00_SKILL_GATE.md` exactly.

Do not claim that a skill was used unless its canonical skill documentation was
actually found and read.

Record skill identifiers, paths, workflows, findings, and corrections in:

```text
.ux-ui-redesign-state.json
docs/ux-ui-redesign/PHASE_<N>_HANDOFF.md
```

If either required skill cannot be found after an exact-name search and a
reasonable canonical-name search:

1. do not invent its instructions;
2. keep the repository at the latest green commit;
3. record the blocker;
4. stop before visual implementation.

---

## 4. Resume algorithm

At the beginning of every agent session:

```bash
git status --short
git branch --show-current
git fetch origin
```

Then:

### Branch does not exist

1. checkout `main`;
2. fast-forward from `origin/main`;
3. record the exact `origin/main` SHA as `baseCommit`;
4. create `ux-ui-redesign` from that SHA;
5. push with upstream tracking;
6. initialize `.ux-ui-redesign-state.json` from `STATE_TEMPLATE.json`;
7. begin Phase 0.

### Branch already exists

1. checkout `ux-ui-redesign`;
2. pull with `--ff-only`;
3. read `.ux-ui-redesign-state.json`;
4. compare local HEAD and `origin/ux-ui-redesign`;
5. identify the first phase whose status is not `completed`;
6. read that phase prompt and the latest completed-phase handoff;
7. resume from `nextAction`.

Never reset, recreate, or force-push the branch.

---

## 5. Phase execution order

| Phase | Prompt file | Required final phase commit |
|---|---|---|
| 0 | `01_PHASE_0_PREFLIGHT_BASELINE.md` | `[ux-ui-redesign:phase-0] establish baseline and skill context` |
| 1 | `02_PHASE_1_UX_AUDIT_BLUEPRINT.md` | `[ux-ui-redesign:phase-1] define UX architecture and visual blueprint` |
| 2 | `03_PHASE_2_DESIGN_FOUNDATIONS.md` | `[ux-ui-redesign:phase-2] rebuild design foundations and components` |
| 3 | `04_PHASE_3_SHELL_DASHBOARD.md` | `[ux-ui-redesign:phase-3] redesign shell navigation and dashboard` |
| 4 | `05_PHASE_4_CONVERTER_PDF.md` | `[ux-ui-redesign:phase-4] redesign converter and PDF workspaces` |
| 5 | `06_PHASE_5_IMAGE_MEDIA_AUDIO_QR.md` | `[ux-ui-redesign:phase-5] redesign image media audio and QR workspaces` |
| 6 | `07_PHASE_6_SPECIALIZED_WORKSPACES.md` | `[ux-ui-redesign:phase-6] redesign specialized utility workspaces` |
| 7 | `08_PHASE_7_STATES_RESPONSIVE_ACCESSIBILITY.md` | `[ux-ui-redesign:phase-7] unify lifecycle responsive and accessible UX` |
| 8 | `09_PHASE_8_LIQUID_MOTION_POLISH.md` | `[ux-ui-redesign:phase-8] add liquid motion and interaction polish` |
| 9 | `10_PHASE_9_FINAL_QA_PR.md` | `[ux-ui-redesign:phase-9] complete final QA and PR handoff` |

Execute phases strictly in order.

A phase is not complete until its detailed phase prompt, tests, state update,
handoff, commit, and push requirements are all satisfied.

---

## 6. Per-phase implementation algorithm

For the current phase:

1. Read its complete prompt.
2. Read previous-phase state, decisions, screenshots, and handoff.
3. Run the relevant `ux-ui-pro-max` and `taste` workflows.
4. Inspect current implementation and backend contracts.
5. Break the phase into the smallest safe substeps.
6. Implement one substep.
7. Run focused tests and a build.
8. Fix failures before starting the next substep.
9. Create an additional checkpoint commit when the phase is large.
10. Ensure every pushed checkpoint is runnable.
11. Complete all phase deliverables.
12. Run the phase's full required validation.
13. Update `.ux-ui-redesign-state.json`.
14. Write `docs/ux-ui-redesign/PHASE_<N>_HANDOFF.md`.
15. Review `git diff` and `git diff --check`.
16. Commit with the required final phase message.
17. Push to `origin/ux-ui-redesign`.
18. Confirm local HEAD equals remote HEAD.
19. Mark the phase `completed`.
20. Record the exact next phase and `nextAction`.

Do not begin the next phase before the current phase is green, committed, and
pushed.

---

## 7. Green-checkpoint protocol

The project must never be left remotely broken because an agent ran out of
credits, context, or execution time.

After every major route or component group:

```bash
npm run typecheck
npm run build
```

Also run focused tests relevant to that change.

For large phases, create additional commits such as:

```text
[ux-ui-redesign:phase-4-checkpoint] complete converter workspace
[ux-ui-redesign:phase-5-checkpoint] complete image and media workspaces
```

A checkpoint commit is allowed only when:

- the application builds;
- modified routes render;
- focused tests pass;
- no known import or runtime startup error remains;
- state records the exact remaining work.

Push every green checkpoint.

Never commit knowingly broken code merely to save progress.

---

## 8. Credit/context exhaustion protocol

When the remaining context or credits appear insufficient for the next major
substep:

1. stop starting new work;
2. finish the smallest currently active substep;
3. run focused tests and `npm run build`;
4. fix all failures;
5. update state and handoff;
6. commit and push the green checkpoint;
7. record the exact next file, function, route, test, and action;
8. stop safely.

The next agent must resume from that checkpoint using the Resume algorithm.

---

## 9. Product redesign acceptance rules

The work fails when it only changes:

- colors;
- CSS variables;
- typography;
- spacing;
- radius;
- borders;
- blur;
- shadows;
- gradients;
- glass;
- animation;
- class names.

The redesign must materially improve:

- information architecture;
- route composition;
- content hierarchy;
- navigation;
- primary actions;
- input/settings/preview/results relationships;
- lifecycle states;
- responsive composition;
- component APIs where existing APIs are unsuitable.

Every production route and every shared user-facing component must be audited.

Use color selectively. Do not turn the complete product into a black-and-white
reskin.

---

## 10. Liquid/water effect rules

Liquid effects must support interaction rather than decorate everything.

Approved examples:

- press and hover ripples;
- drag-and-drop water response;
- fluid panel transitions;
- wave-like progress;
- scoped refraction in elevated glass surfaces;
- image comparison transitions;
- timeline selection response;
- completion micro-interactions.

Required fallbacks:

- `prefers-reduced-motion`;
- coarse pointer;
- low-power device;
- unsupported filter/canvas/WebGL capability.

Never:

- distort body text;
- animate the whole page continuously;
- cause layout shift;
- block input;
- hide focus;
- replace real progress with decorative motion;
- make the app depend on water effects to remain usable.

---

## 11. Validation baseline

Use the exact commands available in the repository. The expected full set
includes:

```bash
npm run typecheck
npm test
npm run test:pdf
npm run test:maint
npm run test:e2e
npm run build
git diff --check
git status --short
```

Also run all tests added for:

- accessibility;
- keyboard navigation;
- responsive behavior;
- visual regression;
- reduced motion;
- lifecycle states;
- hydration and reconnect behavior.

Run a development smoke test confirming:

- frontend loads;
- backend health responds;
- Dashboard renders;
- route navigation works;
- no unresolved import exists.

---

## 12. State and handoff requirements

`.ux-ui-redesign-state.json` is the machine-readable source of truth.

After every meaningful checkpoint update:

```text
currentPhase
currentStep
phaseStatus
completedSteps
pendingSteps
lastGreenCommit
lastPushedCommit
workingTreeClean
tests
knownIssues
blockers
nextAction
updatedAt
```

Every phase handoff must record:

```text
Phase:
Branch:
Base commit:
Start commit:
Final/checkpoint commit:
Remote HEAD:
Skills read:
Skill workflows executed:
Routes/components changed:
Structural changes:
Backend contracts preserved:
Tests:
Build:
Screenshots:
Known limitations:
Exact nextAction:
```

---

## 13. Final delivery

After Phase 9:

1. verify every phase is completed;
2. run the full validation suite;
3. verify a clean working tree;
4. verify local HEAD equals `origin/ux-ui-redesign`;
5. compare `baseCommit...HEAD`;
6. write final reports and screenshot index;
7. prepare a Pull Request:

```text
base: main
head: ux-ui-redesign
```

8. do not merge automatically;
9. report exact commits, tests, screenshots, skill evidence, limitations, and PR
   readiness.

---

## 14. Agent command interpretation

When the user says:

```text
Implement the UX/UI redesign plan.
```

or invokes `/goal` with this plan, interpret it as:

1. read this entire plan;
2. read all mandatory prompt files it references;
3. inspect state;
4. execute the next incomplete phase;
5. continue through later phases while resources permit;
6. commit and push after every green phase/checkpoint;
7. stop only at a green remote checkpoint;
8. never ask the user to restate instructions already stored in this prompt pack.
