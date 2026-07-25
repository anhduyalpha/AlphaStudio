# Final stability report — AlphaStudio integrated baseline

**Date:** 2026-07-25  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Terminal status:** `READY FOR STACKED USER-APPROVED PULL REQUESTS`  
**Threat model:** single-user local / home-server loopback (not VPS multi-tenant)

This report describes the **integrated** branch: verified UX product workflows plus stabilize security, a11y, runtime, CI, recovery, and capability honesty. Historical pre-integration stabilize-only snapshots are obsolete.

---

## Exact SHAs (authoritative)

| Ref | SHA |
|-----|-----|
| **origin/main (unchanged)** | `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` |
| **Verified UX ancestor (`origin/ux-ui-redesign`)** | `a73f065233fa3d2321274cdd887229aacfe3e4d2` |
| Merge of verified UX into stabilize | `492bf7f37b1b2c6039dffbd1671c03d55eea25aa` |
| Post-merge product content (Settings motion + OCR honesty) | `c32629f59de529a690535edc815dfde2ddba7bec` |
| Docs topology rewrite family | `08d487164d7b6d9b626e36a341cd59858fb3c5d5` |
| Pre-integration stabilize tip (historical only) | `a96ee366e66302558045fa5c0b5bfe0af31fc193` |
| Pre-integration CP06 content (historical only) | `ecd69f8d48fea0d80f0463d7128cf8cd7d0619b4` |
| **Branch tip (local must equal remote)** | `git rev-parse origin/stabilize/alphastudio-stable-baseline` after fetch |

**Ancestry proof:**

```text
git merge-base --is-ancestor a73f065233fa3d2321274cdd887229aacfe3e4d2 origin/stabilize/alphastudio-stable-baseline
# exit 0 → UX is an ancestor of stabilize
```

**Topology:** stabilize is a **descendant** of verified UX. Main is frozen until approved stacked merges. Do **not** auto-merge.

---

## Stacked Pull Request order (mandatory)

```text
PR 1: ux-ui-redesign                         -> main
PR 2: stabilize/alphastudio-stable-baseline  -> updated main
```

Do **not** reverse this order (do not merge stabilize into `ux-ui-redesign` first). UX is already stacked under stabilize.

After each approved merge: fetch, re-run gates, prove local HEAD == remote HEAD.  
**Do not** create stable tags or force-push without explicit approval.

---

## Environment matrix (integrated product at/after `c32629f`)

| Environment | Result | Evidence |
|-------------|--------|----------|
| Windows host Node ≥20 | typecheck / build / `npm test` **706 pass / 3 skip** (×2) | goal scratch `stabilize/test-run2.log`, `test-run3.log` |
| `test:maint` / `test:hygiene` | **36** / **7** pass | `stabilize/test-maint.log`, `test-hygiene.log` |
| Production smoke | `/api/health` ok twice; web 200; port free after stop; DB + marker persist | `stabilize/runtime/*` |
| Linux GitHub Actions | workflow present (`.github/workflows/ci.yml`); full suite on runner after push | CI config in tree |
| Local Linux host suite | not re-run (WSL bash unavailable on operator host) | `stabilize/docker-ci.txt` honest capture |
| Docker compose | `docker compose config` PASS; volume `DB_PATH=/data/alphastudio.db` retained | `stabilize/docker-compose-config.log` |
| Clean UX validation | independent UX tip `a73f065` green before merge | `ux-ui/*` |

---

## Commands and results (integrated product)

| Gate | Command | Result |
|------|---------|--------|
| Install | `npm ci --no-audit --no-fund` | PASS |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS |
| Unit/integration | `npm test` | **706 pass / 0 fail / 3 skip** (multi-run consistent) |
| Maint | `npm run test:maint` | PASS |
| Hygiene | `npm run test:hygiene` | PASS |
| Runtime restart | production `node server/dist/index.js` + health + second boot | PASS |
| Docker compose | `docker compose config` | PASS |

---

## Integration summary

1. **UX validated first** at `a73f065` (fixtures/samples, format-json MIME, motion CSS token, Docker bind, honest docs) and pushed to `origin/ux-ui-redesign`.  
2. **Merged UX into stabilize** (`492bf7f`) with file-by-file conflict resolution (not blind ours/theirs).  
3. **Post-merge product fixes** (`c32629f`): Settings single Motion control (no dead “Subtle animations” toggle); ModularWorkspace OCR gates via capabilities only.  
4. **Docs rewrite** (`08d4871` family): stacked PR order and integrated topology are the only authoritative narrative.  
5. **Preserved from stabilize:** path confinement, bearer timing, retry, capability honesty, hygiene, backup, Docker `DB_PATH`, CI workflow, a11y shell contracts.  
6. **Preserved from UX:** redesigned product UI/workflows, converter board, residual quality surfaces.

### Conflict files resolved (12)

`docs/BUILD_AND_RUN_WINDOWS_LINUX.md`, `package.json`, `scripts/maint/bench-startup.mjs`, `scripts/maint/tests/maint-core.test.mjs`, `server/src/processors/media.ts`, `src/App.jsx`, `src/components/CommandPalette.jsx`, `src/components/Common.jsx`, `src/components/Sidebar.jsx`, `src/components/Topbar.jsx`, `src/views/ModularWorkspaceView.jsx`, `src/views/SettingsView.jsx`.

---

## Checkpoint integrity (historical ancestors still on branch)

| CP | Role |
|----|------|
| CP00–CP04 | Process, hygiene, security, Linux CI parity |
| CP06 | Pre-integration a11y/backup/Docker/archiver closeout |
| INTEGRATE + POST-FIX | UX stack under stabilize; product at `c32629f` |
| DOCS | Integrated topology + stacked PR order |

Handoffs under `docs/stabilize/handoffs/CP*.md` remain historical process records.

---

## Open P0 / P1 / P2

**Empty** for the **local single-user integrated baseline** after this validation.

Accepted formal boundaries (not defects under threat model): unauthenticated loopback API; no app rate limits; Docker LAN defaults require operator token (see `SECURITY_BOUNDARY.md`).

---

## Remaining P3 / P4 (non-blocking)

| ID | Sev | Item |
|----|-----|------|
| S-12 | P3/P4 | Optional tool download SHA integrity |
| A11y | P3 | Runtime axe/keyboard e2e; measured contrast |
| Ops | P3 | GitHub branch protection not enabled |
| Platforms | P4 | Full Linux host suite when WSL/user distro available |
| E2E | P4 | Playwright residual suite not re-run in integration session |

---

## Migration / deployment / backup

- SQLite migrations forward-only; `npm run db:repair` non-destructive.  
- Host: `npm ci && npm run build && npm start` with `HOST=127.0.0.1`.  
- Docker: `docker compose up -d --build`; set `API_AUTH_TOKEN` before LAN publish; **DB on volume** via `DB_PATH=/data/alphastudio.db`.  
- Backup/restore runbook: `docs/stabilize/backup-rollback.md` (pre-integration mutation-absent drill remains valid for backup tooling).

---

## Known limitations

- Core Docker image may lack full portable toolset (capabilities honest / 503 when unavailable).  
- Structural UI a11y tests freeze source contracts; not axe runtime certification.  
- Branch protection still operator action.  
- Local WSL bash was unavailable for a full Linux host re-run; rely on CI workflow after push.  
- Product UI on this branch **is the integrated UX redesign** plus stabilize recovery/security — not “mainline shell only.”

---

## Status

```text
READY FOR STACKED USER-APPROVED PULL REQUESTS

PR 1: ux-ui-redesign -> main
PR 2: stabilize/alphastudio-stable-baseline -> updated main
```
