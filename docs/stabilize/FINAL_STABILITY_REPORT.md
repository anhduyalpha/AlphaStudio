# Final stability report — AlphaStudio local stable baseline

**Date:** 2026-07-25  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Terminal status:** `READY FOR USER-APPROVED MERGE`  
**Threat model:** single-user local / home-server loopback (not VPS multi-tenant)

---

## Exact SHAs (at report authoring; re-verify after push)

| Ref | SHA |
|-----|-----|
| Pre-closeout tip (CP04 pin) | `9b9bf43ef5a7dc6876cb4c79d298da7854e27005` |
| CP04 content | `cb01099a1a1c2a9b3f6beda466c7ed14159174d8` |
| origin/main (unchanged) | `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` |
| origin/ux-ui-redesign (preserved) | `d03497f77083a42e6461db34fb24724f8e76854d` |
| Closeout content tip | `ecd69f8d48fea0d80f0463d7128cf8cd7d0619b4` |
| Closeout tip (docs pin) | `c0ade1763a999cd6978db5a9805ac345ad794c2d` |

**Topology:** stabilize is **+19 commits from main before this closeout commit**; redesign remains **+37** unmerged. Do **not** auto-merge.

---

## Environment matrix

| Environment | Result | Evidence |
|-------------|--------|----------|
| Windows host Node ≥20 | typecheck / build / `npm test` 613/613 | `{SCRATCH}/gates/*-final.txt` |
| Linux GitHub Actions `CI / core-ubuntu` | green on `9b9bf43` (pre-closeout tip) | run `30118714453` |
| Clean-clone (post-push re-proof recommended) | prior CP01 + this branch hygiene tests green | hygiene + maint |
| Docker compose (project `alphastudio-rc`) | build/up/health/restart; `DB_PATH=/data/alphastudio.db` | `{SCRATCH}/rc-docker/*` |
| Host RC (port 8797, isolated DATA_DIR) | cold start, text hash job completed, backup, restore mutation absent, job persisted, second restart healthy | `{SCRATCH}/rc-final/*` |

---

## Commands and results (closeout)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS |
| Unit/integration | `npm test` | **613 pass / 0 fail / 0 skip** |
| Maint | `npm run test:maint` | **36 pass** (includes backup.mjs) |
| Hygiene | `npm run test:hygiene` | **7 pass** |
| Audit | `npm audit` | **0 vulnerabilities** (archiver@8) |
| Remote CI (closeout tip) | Actions run 30142010326 | success on `c0ade17` |
| Remote CI (CP04 pin) | Actions run 30118714453 | success on `9b9bf43` |
| Host RC | cold/start/convert/backup/restore/restart | PASS — `RESTORE_OK`, `persisted_job_status=completed` |
| Docker RC | compose build/up/restart + volume tar | PASS — health healthy; volume backup 5687 bytes |

---

## Checkpoint integrity

| CP | Content / pin | On branch |
|----|---------------|-----------|
| CP00 | `5ec253f` | ancestor YES |
| CP01 | `0c39f58` / pin `e399363` | YES |
| CP01b | `24d108e` | YES |
| CP02 | `deb2f2b` | YES |
| CP03 | `f67e012` | YES |
| CP04 | `cb01099` / pin `9b9bf43` | YES |
| CP6 + ops closeout | this commit family | current tip |

Handoffs under `docs/stabilize/handoffs/CP*.md`. Working tree was clean at preflight; local HEAD equalled remote for tip `9b9bf43` before closeout edits.

---

## Independent final reviews (current HEAD work)

| Domain | Blocking? | Notes |
|--------|-----------|-------|
| (a) Git / architecture | No | Linear history; main frozen; redesign preserved |
| (b) Tests / evidence | Fixed | Removed vacuous `\|\| true` asserts; full suite re-captured 613/0 |
| (c) Security / deps | No | Local P0–P2 security register empty; formal boundaries retained |
| (d) Deploy / migration / data | Fixed | Docker `DB_PATH` on volume |
| (e) UX / a11y workflows | P1s fixed | Shell F1–F4 + nav P2s addressed |
| (f) Backup / restore / rollback | Fixed + rehearsed | `npm run backup` + runbook + host restore drill |

Review notes: `{SCRATCH}/reviews/01-*.md` … `06-*.md`.

---

## Closeout repairs (this tip)

1. **CP6 a11y P1s:** command palette focus trap/restore; topbar `aria-label`; drawer Escape/trap/`aria-expanded`; Settings motion wired to `useMotionPreference`; skip link; route title; main focus; tabs keyboard; progressbar bounds; QR tabpanels.  
2. **Backup/restore:** `scripts/maint/backup.mjs`, `npm run backup`, `docs/stabilize/backup-rollback.md`, unit test.  
3. **Docker data safety:** `DB_PATH=/data/alphastudio.db` in Dockerfile + compose.  
4. **Deps:** `archiver@8` + `ZipArchive` API; `npm audit` 0.  
5. **False-green:** removed always-true asserts in converter/hardening tests.

---

## Open P0 / P1 / P2

**Empty** for the **local single-user stabilize baseline** after this closeout.

Accepted formal boundaries (not defects under threat model): unauthenticated loopback API; no app rate limits; Docker LAN defaults require operator token (FC-S-14).

---

## Remaining P3 / P4

| ID | Sev | Item |
|----|-----|------|
| S-12 | P3/P4 | Optional tool download SHA integrity (CP5 residual) |
| S-13/S-15 | P3 | SPA CSP / download realpath defense-in-depth |
| A11y | P3 | Runtime axe/keyboard e2e; SSE live chip; measured contrast ratios |
| Ops | P3 | GitHub branch protection not enabled (ops) |
| Ops | P3 | Action major-tag pinning (not commit SHAs) |
| Ops | P4 | Optional Windows Actions core job |
| Platforms | P4 | Full Linux host matrix (no WSL user distro) |
| Density | P3 | Settings density CSS consumer deferred (documented) |

---

## Migration

- SQLite migrations **1–7**, forward-only, transactional, `npm run db:repair` non-destructive.  
- No down-migrations; rolling code back may leave additive columns (acceptable).

## Deployment

| Mode | Guidance |
|------|----------|
| Host | `npm ci && npm run build && npm start` with `HOST=127.0.0.1` |
| Docker | `docker compose up -d --build`; set `API_AUTH_TOKEN` before LAN publish; **DB on volume** via `DB_PATH=/data/alphastudio.db` |
| Not claimed | Public VPS, multi-user TLS, edge rate limits |

## Backup / restore / rollback

See `docs/stabilize/backup-rollback.md`.

| Drill | Result |
|-------|--------|
| Host backup + restore | `RESTORE_OK`; job still `completed` after restore restart |
| Docker volume tar | `alphastudio-rc_alphastudio-data` → tgz size 5687 |
| Code rollback | git tip / rebuild; no stable tag created |

---

## Merge prep (do not execute without approval)

```text
# Step 1 — stabilize into redesign base (expect conflicts; redesign +37 vs stabilize tip)
git fetch origin
git checkout ux-ui-redesign
git merge --no-ff origin/stabilize/alphastudio-stable-baseline
# resolve conflicts; npm run typecheck && npm run build && npm test
# git push origin ux-ui-redesign

# Step 2 — redesign into main (only after step 1 verified)
git checkout main
git merge --no-ff origin/ux-ui-redesign
# gates again; git push origin main
```

**Conflict risk:** high (37 redesign commits vs stabilize product+docs). Prefer PR review UI.  
**Do not** create stable tags or force-push.  
**After each approved merge:** fetch, re-run gates, prove local HEAD == remote HEAD.

---

## Known limitations

- Core Docker image may lack full portable toolset (capabilities honest / 503 when unavailable).  
- Structural UI a11y tests freeze source contracts; not axe runtime certification.  
- Branch protection still operator action.  
- Redesign branch not merged; product UI on stabilize is mainline shell + CP6 fixes.

---

## Status

```text
READY FOR USER-APPROVED MERGE
```
