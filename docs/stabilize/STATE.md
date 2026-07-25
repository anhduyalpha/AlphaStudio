# Stabilization state

**Program:** AlphaStudio stable baseline (integrated with verified UX)  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Status:** INTEGRATED — UX ancestor proven; ready for **stacked** user-approved PRs  
**Last updated:** 2026-07-25  
**Base create SHA:** `ed460ee` (main at program start)

## Declaration

This branch **already contains** the verified `ux-ui-redesign` tip as an ancestor.  
It is **not** a divergent “stabilize-only” baseline that still needs UX merged later.

**Threat model:** single-user local / home-server loopback. **Not** VPS/multi-user/public-internet ready.  
**Do not** merge to `main` or create a stable tag without explicit user approval.

## Exact SHAs (content lineage)

| Role | SHA |
|------|-----|
| `origin/main` (unchanged) | `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` |
| Verified UX ancestor (`origin/ux-ui-redesign`) | `a73f065233fa3d2321274cdd887229aacfe3e4d2` |
| Merge commit (UX → stabilize) | `492bf7f37b1b2c6039dffbd1671c03d55eea25aa` |
| Post-merge product fix (Settings motion + OCR capability gate) | `c32629f59de529a690535edc815dfde2ddba7bec` |
| Docs topology rewrite (this report family) | `08d487164d7b6d9b626e36a341cd59858fb3c5d5` |
| Branch tip | **must equal** `origin/stabilize/alphastudio-stable-baseline` after every push (`git rev-parse HEAD` / `@{u}`) |

Prove ancestry and tip equality after fetch:

```text
git fetch origin
git merge-base --is-ancestor a73f065233fa3d2321274cdd887229aacfe3e4d2 origin/stabilize/alphastudio-stable-baseline
git rev-parse HEAD origin/stabilize/alphastudio-stable-baseline
```

## Topology (authoritative)

| Item | Value |
|------|--------|
| `main` | frozen at `ed460ee` until approved merges |
| `ux-ui-redesign` | verified at `a73f065`; **ancestor** of stabilize |
| `stabilize/alphastudio-stable-baseline` | **descendant** of verified UX (integrated product + stabilize spine) |
| Relationship | stabilize ⊃ UX tip — not the reverse |

## Exact next action (stacked PR order only)

**User-approved merges only — this order is mandatory:**

```text
PR 1: ux-ui-redesign                         -> main
PR 2: stabilize/alphastudio-stable-baseline  -> updated main
```

Do **not** merge stabilize into `ux-ui-redesign` first. UX is already an ancestor of stabilize; reverse stacking reintroduces conflicts and breaks the verified topology.

After each approved merge: fetch, rerun required checks, verify local/remote HEAD equality.  
**Do not** create a stable tag without explicit approval.

## Checkpoint log (historical closeout + integration)

| ID | Summary | Note |
|----|---------|------|
| CP0–CP04 | Process, hygiene, security, CI parity | Ancestors of integrated tip |
| CP06 | A11y, backup/rollback, Docker DB_PATH, archiver@8 | Pre-integration closeout (`ecd69f8` / pins) |
| INTEGRATE | Merge verified UX `a73f065` into stabilize | Merge `492bf7f` |
| POST-FIX | Settings motion honesty; OCR capability-only gate | `c32629f` |
| DOCS | Integrated topology + stacked PR order as authoritative | `08d4871` family |

## Test surface (integrated product)

| Gate | Status |
|------|--------|
| typecheck / build | green |
| npm test | **706 pass / 3 skip / 0 fail** (×2 multi-run on post-merge tip) |
| test:maint / hygiene | green |
| Host production smoke | `/api/health` + web + restart + DB/marker persist |
| Docker | compose config valid; `DB_PATH=/data/alphastudio.db` retained |
| CI workflow | `.github/workflows/ci.yml` present (`CI / core-ubuntu`) |

Matrix: `docs/stabilize/TEST_MATRIX.md`  
Final report: `docs/stabilize/FINAL_STABILITY_REPORT.md`  
Security boundary: `docs/stabilize/SECURITY_BOUNDARY.md`  
Backup/rollback: `docs/stabilize/backup-rollback.md`

## Residuals (P3/P4 only — non-blocking)

- Tool download SHA integrity (CP5 residual)
- GitHub branch protection (ops — enable when ready; require `CI / core-ubuntu`)
- Runtime axe/keyboard e2e; SSE live status chip; measured contrast
- Windows GitHub Actions core job (optional)
- Full Linux host suite when a usable WSL/user distro is available
- VPS multi-user TLS/rate-limit (deploy epic; formal boundary recorded)
