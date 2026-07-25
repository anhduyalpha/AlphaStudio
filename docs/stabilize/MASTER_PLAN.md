# Master plan — AlphaStudio stabilization

**Status:** AUDIT COMPLETE — **repository is not stable**  
**Date:** 2026-07-24  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Base:** `main` @ `ed460ee763663eef3f0aae9080eeb5e15c68fe1c`  
**Coordinator:** process-only reconcile of eight independent audits  

## Explicit non-declaration

This document does **not** declare AlphaStudio stable, production-ready, VPS-ready, or release-ready.  
It records verified topology, a risk register, a dependency-aware plan, and the **exact next action**.

---

## 1. Verified topology (this pass)

| Fact | Evidence |
|------|----------|
| Remote | `origin` → `https://github.com/anhduyalpha/AlphaStudio.git` |
| `main` == `origin/main` | `ed460ee` (0 ahead / 0 behind) |
| Working tree at program start | clean; no stash; no tags |
| Merge-base `main`…`ux-ui-redesign` | `ed460ee` |
| `ux-ui-redesign` | `d03497f`, **37 commits ahead** of main — **preserve** |
| Stabilize branch | created from `main` @ `ed460ee` |
| Product code in this goal | **unchanged** (`git diff main -- server/src src python` empty) |

Details: [TOPOLOGY.md](./TOPOLOGY.md) · scratch: `git-topology.txt`, `repo-inventory.txt`.

---

## 2. Audit index

| # | Scope | Artifact | Independent? |
|---|--------|----------|--------------|
| 01 | Git history, branch safety, hygiene | [audits/01-git-hygiene.md](./audits/01-git-hygiene.md) | yes |
| 02 | Backend, workers, persistence, jobs | [audits/02-backend-workers.md](./audits/02-backend-workers.md) | yes |
| 03 | Frontend, browser, responsive, a11y | [audits/03-frontend-a11y.md](./audits/03-frontend-a11y.md) | yes |
| 04 | Tests, fixtures, flakiness, coverage | [audits/04-tests-coverage.md](./audits/04-tests-coverage.md) | yes |
| 05 | Runtime installers, Python, tools, capabilities | [audits/05-runtime-tools.md](./audits/05-runtime-tools.md) | yes |
| 06 | Windows, Linux, Docker, home server, VPS | [audits/06-platforms.md](./audits/06-platforms.md) | yes |
| 07 | Security, deps, filesystem, command execution | [audits/07-security.md](./audits/07-security.md) | yes |
| 08 | CI, Actions, PRs, releases, backup, rollback | [audits/08-ci-release.md](./audits/08-ci-release.md) | yes |

---

## 3. Cross-review notes (high-risk / P0–P1)

| ID | Topic | Sources | Cross-review conclusion | Owner checkpoint |
|----|--------|---------|-------------------------|------------------|
| XR-01 | Missing `scripts/audit/` while npm scripts + docs claim it | 04-F1 (P0), 05 RT-P1-04, 08 broken gates | **Confirmed.** `package.json` `test:audit` / `audit:backend` reference absent tree; `audit/` is fixtures-only. Treat all historical “audit green” claims as invalid. | CP1 |
| XR-02 | Download/preview path trust vs delete-path strictness | 02 F-B04 (P2), 07 S-01 (P1) | **Elevate to P1.** Same code path: streams DB `path`/`output_path` without `assertInsideRoot`. Delete path already strict — read path should match. | CP3 |
| XR-03 | Inline HTML/SVG preview on app origin | 07 S-02 (P1) | **Confirmed P1** for `SERVE_FRONTEND=1` / multi-device LAN. Loopback single-user residual risk lower but still fix before any network claim. | CP3 |
| XR-04 | No CI / no `.github/` | 04-F3, 06, 08 | **Confirmed.** No automated typecheck/build/test on PR. Blocks “stable baseline” DoD. | CP2 |
| XR-05 | Doc vs package runtime prepare contract | 05 RT-P1-01, 06 doc drift | **Confirmed.** Only `bootstrap` → `runtime:prepare`; `dev`/`build`/`start` do not install tools. README closer to truth than BUILD_AND_RUN in places. | CP1 / CP5 |
| XR-06 | Not public-VPS-ready (no TLS, no rate limit, SPA token model) | 06 P0, 07 threat model | **Accepted as design boundary**, not default-loopback RCE. Label as **deploy P0** if someone binds publicly without edge controls. Do not market VPS until intentional hardening epic. | Later / deploy epic |
| XR-07 | Job `retryable` / password vault restart | 02 F-B01, F-B02 (P1) | **Confirmed** from jobs/db source review. Contract dishonest after restart for password PDF ops. | CP4 |
| XR-08 | Converter capability honesty at create | 02 F-B03 (P1) | **Confirmed** — `converter.batch` always advertised; engine failures after claim. | CP4 |
| XR-09 | `ux-ui-redesign` 37 commits + branch protection | 01 P1 | **Preserve branch.** No merge into stabilize until separate redesign promotion plan. Enable GitHub protection (ops). | Ops + CP0 |
| XR-10 | `audit/fixtures` gitignored but tests depend on them | 04-F2 (P1) | **Confirmed** clean-clone risk for detect/helpers tests. | CP1 |
| XR-11 | Tool download integrity (no SHA) | 05 RT-P1-02 | **Confirmed** supply-chain residual for FFmpeg/LO/etc. | CP5 |
| XR-12 | Frontend dialog/drawer/search a11y | 03 P1s | Static-only; no runtime axe. Treat as high for keyboard users; runtime confirm in a11y CP. | CP6 |
| XR-13 | No backup script / clear can wipe data | 08 | **Confirmed.** Recovery is manual + `db:repair`/`reset`. | CP2 |

---

## 4. Risk register (reconciled)

| Risk ID | Sev | Area | Summary | Mitigation path | Checkpoint |
|---------|-----|------|---------|-----------------|------------|
| R-01 | P0 | Process/tests | Broken `test:audit` / `audit:backend` entrypoints | Remove or restore scripts; purge false docs claims | CP1 |
| R-02 | Deploy-P0 | Platforms | Public VPS without TLS/edge/rate-limit is unsafe | Document LAN-only; refuse VPS DoD until hardened | Docs + later |
| R-03 | P1 | Security | Download/preview without path re-confine | `assertInsideRoot` on all stream routes + tests | CP3 |
| R-04 | P1 | Security | Inline HTML/SVG preview XSS surface | attachment disposition / CSP / block active types in preview | CP3 |
| R-05 | P1 | Backend | Retry + password vault incomplete after restart | Honest retry API or stop implying attempts; re-supply password | CP4 |
| R-06 | P1 | Backend | False converter availability | Gate create on real engine capabilities | CP4 |
| R-07 | P1 | Tests | Fixtures gitignored; clean clone fails | Relocate/commit fixtures; fix paths | CP1 |
| R-08 | P1 | CI | No GitHub Actions | Minimal CI: ci → typecheck → build → test | CP2 |
| R-09 | P1 | Ops | No backup/rollback automation or tags | backup script + tag policy + runbook | CP2 |
| R-10 | P1 | Git | Unprotected main; unmerged redesign work | Branch protection; never delete ux-ui-redesign | Ops |
| R-11 | P1 | Runtime | Install integrity + capability/selfcheck gaps | SHA pin tools; fix OPTIONAL_MODULES; align docs | CP5 |
| R-12 | P1 | Frontend | Command palette / mobile search / drawer a11y | Focus trap, names, Escape; wire motion setting | CP6 |
| R-13 | P2 | Tests | Struct-only UI tests; thin E2E; fixed ports | Isolate ports/tmpdir; expand smoke journeys | CP7 |
| R-14 | P2 | Backend | Dual files/uploads; GC misses result cache | Harden GC + dual-table consistency | CP4+ |
| R-15 | P2 | Platforms | No Docker; Linux ARM gaps | Optional Dockerfile later; document arch matrix | Later |

---

## 5. Branch strategy

```text
origin/main  @ ed460ee   ← do not modify in stabilize work
     │
     └── stabilize/alphastudio-stable-baseline   ← THIS program
              │
              ├── CP0 process docs (this commit family)
              ├── CP1 broken scripts + fixtures honesty
              ├── CP2 CI + backup skeleton
              ├── CP3 security path/preview
              ├── CP4 job lifecycle honesty
              ├── CP5 runtime/docs integrity
              ├── CP6 frontend a11y P1s
              └── CP7 test isolation / smoke expansion
                        │
                        └── (future) PR → main when DoD met

ux-ui-redesign @ d03497f  (+37)  ← preserve; separate promotion plan only
```

### Rules

1. All stabilize work on `stabilize/alphastudio-stable-baseline` (or stacked `stabilize/*` from it).  
2. **Never** force-push, hard-reset, or delete `ux-ui-redesign` / unreviewed local work.  
3. **Never** commit product “features” under stabilize without an opened fix checkpoint in this plan.  
4. One coherent commit per checkpoint; normal push; prove `HEAD == @{u}`.  
5. Promote to `main` only after Definition of Done + review — not automatic.

---

## 6. Small green checkpoints (dependency order)

| CP | Goal | Depends on | Primary paths | Exit criteria (focused) |
|----|------|------------|---------------|-------------------------|
| **CP0** | Process baseline (this deliverable) | — | `docs/stabilize/**` | Artifacts present; topology recorded; branch pushed |
| **CP1** | Honesty of npm scripts + fixtures | CP0 | `package.json`, fixtures, docs refs to audit | `test:audit`/`audit:backend` either work or gone; clean-clone fixtures story fixed; docs no longer claim missing gates |
| **CP2** | CI skeleton + backup/rollback notes | CP1 | `.github/workflows/*`, `docs/stabilize/backup-rollback.md` or script | PR CI runs typecheck+build+`npm test` (no full tool bootstrap); backup steps documented; no force-push |
| **CP3** | Security path + preview hardening | CP0 (can parallel CP1 after freeze) | `routes/jobs.ts`, `routes/workspaces.ts`, validation, tests | Downloads re-confine; preview not executable XSS vector; new regression tests green |
| **CP4** | Job lifecycle contract honesty | CP0 | `workers/jobs.ts`, capabilities, password vault, tests | Retry/password/create-gate behavior matches API/docs; lifecycle tests updated |
| **CP5** | Runtime contract + install integrity | CP1 | `scripts/maint/*`, setup-tools, capabilities, BUILD docs | Doc/script align; integrity or explicit risk accepted; selfcheck module gaps closed or documented |
| **CP6** | Frontend a11y P1s | CP0 | `CommandPalette`, shell/search/drawer, Settings motion | Focus trap/names/Escape; motion setting wired or relabeled; structural + manual keyboard note |
| **CP7** | Test reliability expansion | CP1–2 | server tests HTTP isolation, e2e smoke | Free ports/tmpdir; cleanup; at least one non-PDF smoke path planned/landed |

Parallelism: **CP3 ∥ CP4 ∥ CP6** after CP0; **CP2** after CP1 preferred so CI does not encode broken scripts.

Each CP must use [HANDOFF_FORMAT.md](./HANDOFF_FORMAT.md) gates.

---

## 7. Test / evidence matrix

| Gate | Command (canonical) | Proves | Required from |
|------|---------------------|--------|---------------|
| Focused unit/integration | `npm test` or narrower `node --import tsx --test --test-concurrency=1 <files>` | Server behavior | every product CP |
| PDF slice | `npm run test:pdf` | PDF job path | PDF-touching CPs |
| Maint | `npm run test:maint` | doctor/tools scripts | CP5 |
| Typecheck | `npm run typecheck` | TS surface | every CP with server TS |
| Build | `npm run build` | client+server emit | every CP with ship code or CI |
| Doctor smoke | `npm run doctor` | runtime environment snapshot | CP5; optional elsewhere |
| E2E | `npm run test:e2e` (needs browsers) | browser PDF path | CP7 / release |
| Fixture verify | `npm run fixtures:pdf:verify` | PDF fixtures integrity | when fixtures change |
| Diff validation | `git diff --stat` vs intended paths | no accidental churn | every CP |
| HEAD equality | `git rev-parse HEAD` vs `@{u}` | push integrity | every CP after push |

**Not evidence of stability alone:** `RUNTIME_VALIDATION.md`, PDF “final report” docs, prior completion flags, unrun `test:audit`.

---

## 8. Definition of Done (future — not claimed now)

Stabilize program may claim a **stable baseline for local single-user loopback** only when **all** are true with recorded handoffs:

1. CP1–CP4 closed with green gates and coherent commits on stabilize branch.  
2. CI on GitHub runs typecheck + build + `npm test` on PRs to stabilize/main.  
3. No broken package.json scripts; no docs claiming missing tools as green.  
4. Security S-01/S-02 fixed or explicitly accepted with threat-model write-up.  
5. Job retry/password/capability create-path honest.  
6. Backup + rollback runbook exists and is exercised once (restore drill).  
7. `main` promotion PR reviewed; `ux-ui-redesign` disposition decided (merge plan or archive tag) without data loss.  
8. Fresh evidence capture: typecheck, build, full `npm test`, doctor — not copied from old markdown.

**VPS / multi-user / Docker production** is a **separate** DoD (TLS, rate limits, auth defaults, container image, ARM matrix) — out of scope for “local stable baseline.”

---

## 9. Exact next action

**CP1 — Script and fixture honesty (no product features):**

1. Check out / continue on `stabilize/alphastudio-stable-baseline`.  
2. Either remove `test:audit` + `audit:backend` from `package.json` **or** restore minimal `scripts/audit/` that fails closed with a clear message — prefer **remove/replace with honest maint doctor** unless history recovery is trivial.  
3. Fix clean-clone fixture story for tests that need `audit/fixtures` (relocate under `fixtures/` or stop gitignoring samples).  
4. Grep docs for `test:audit` / `audit:backend` / false green claims; correct.  
5. Run focused tests + typecheck + build; write handoff; one commit; normal push; prove HEAD equality.

Do **not** start converter UX, redesign merge, or VPS hardening next.

---

## 10. Process references

| Artifact | Path |
|----------|------|
| State | [STATE.md](./STATE.md) |
| Handoff template | [HANDOFF_FORMAT.md](./HANDOFF_FORMAT.md) |
| Topology | [TOPOLOGY.md](./TOPOLOGY.md) |

---

*End of master plan — audit reconcile only.*
