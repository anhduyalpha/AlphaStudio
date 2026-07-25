# Checkpoint handoff format

Use this template for **every** future stabilization checkpoint on  
`stabilize/alphastudio-stable-baseline` (and any stacked stabilize/* branches).

Copy to `docs/stabilize/handoffs/CPNN-short-slug.md` (create `handoffs/` when first used).

---

## Handoff: CP__ — \<short title\>

**Date:** YYYY-MM-DD  
**Author / agent:**  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Base SHA before work:**  
**HEAD after commit:**  
**Remote HEAD after push:**  
**Local HEAD == remote HEAD:** YES / NO (paste proof commands)

### Goal of this checkpoint

One paragraph. Product feature work is out of scope unless the master plan explicitly opens a fix checkpoint.

### Scope touched

- Paths:
- Out of scope:

### Gates (all required)

| Gate | Command(s) | Result | Evidence path |
|------|------------|--------|---------------|
| Focused tests | e.g. `npm test -- <files>` / `npm run test:pdf` | PASS/FAIL | |
| Typecheck | `npm run typecheck` | PASS/FAIL | |
| Build | `npm run build` | PASS/FAIL | |
| Relevant smoke | e.g. `npm run doctor` / targeted API smoke | PASS/FAIL | |
| Diff validation | `git diff --stat` vs intended paths; no accidental product churn | PASS/FAIL | |
| State update | `docs/stabilize/STATE.md` updated | PASS/FAIL | |
| Handoff update | this file completed | PASS/FAIL | |
| One coherent commit | single logical commit message | PASS/FAIL | SHA: |
| Normal push | `git push -u origin <branch>` (no `--force`) | PASS/FAIL | |
| HEAD equality | `git rev-parse HEAD` == `git rev-parse @{u}` | PASS/FAIL | |

### Diff summary

```text
# paste git diff --stat and key file list
```

### Tests run (focused)

```text
# paste command + summary counts / failures
```

### Risks introduced or deferred

- 

### Follow-ups / next exact action

1. 

### Explicit non-claims

- Repository is **not** declared fully stable by completing this checkpoint unless Definition of Done in MASTER_PLAN.md is entirely met and recorded with evidence.

---

## Rules

1. **No force-push** to `main` or shared stabilize history that others may have pulled.  
2. **Do not modify `main`** in a checkpoint unless the master plan has a dedicated, reviewed promotion step.  
3. **Do not delete** unreviewed local work (`ux-ui-redesign`, stashes, other local branches).  
4. **One coherent commit** per checkpoint (process or fix), not a dump of unrelated changes.  
5. If any gate fails, do not push a “green” claim; document FAIL and stop or open a fix checkpoint.  
6. Prefer evidence under repo `docs/stabilize/` for durable claims; scratch dirs are ephemeral.  
