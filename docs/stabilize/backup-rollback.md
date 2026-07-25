# Backup, restore, and rollback — local / home-server baseline

**Audience:** operator of a single-user AlphaStudio instance (loopback or trusted home LAN).  
**Not covered:** multi-tenant VPS, HA, automated offsite replication.

## What to protect

| Asset | Default path | Notes |
|-------|--------------|--------|
| SQLite DB + job files | `DATA_DIR` (default `./data`) | Contains `alphastudio.db`, `uploads/`, `outputs/`, `temp/` |
| Operator secrets | `.env` (repo root) | `API_AUTH_TOKEN`, bind flags, tool paths |
| App version | git SHA / package version `3.6.0` | Restore code with `git checkout` / image tag |
| Portable tools | `.runtime/` | Reinstallable via `npm run tools:install` / bootstrap — optional to back up |

## Host backup (recommended)

1. **Stop** the server (so SQLite is idle).
2. Run:
   ```bash
   npm run backup
   # optional secrets:
   npm run backup -- --include-env
   ```
3. Confirm a new folder under `backups/alphastudio-backup-<UTC>/` with `data/` and `backup-meta.json`.
4. Copy that folder offline if the host is disposable.

## Host restore

1. Stop the server.
2. Move aside the current data dir (do not delete until verified):
   ```bash
   mv data data.broken-$(date +%Y%m%d)
   ```
3. Copy `data/` from the backup into place (or set `DATA_DIR` to the backup data path).
4. Optionally restore `.env` from the backup.
5. `npm run db:repair` then `npm start` (or `npm run start` after build).
6. Hit `/api/health` and open a known job/output if present.

## Docker volume backup

Compose volume name is typically `<project>_alphastudio-data` (confirm with `docker volume ls`).  
Image defaults set **both** `DATA_DIR=/data` and `DB_PATH=/data/alphastudio.db` so SQLite lives on the volume.

**Important:** Host `npm run backup` with default `./data` does **not** snapshot a compose named volume. Use the volume procedure below for Docker deployments.

```bash
# stop stack
docker compose down

# discover volume name if needed: docker volume ls
# archive volume to host path (PowerShell: ${PWD}/backups)
docker run --rm -v alphastudio_alphastudio-data:/data -v "${PWD}/backups:/backup" alpine \
  tar czf /backup/alphastudio-docker-data.tgz -C /data .

# start again
docker compose up -d --build
```

Restore:

```bash
docker compose down
docker run --rm -v alphastudio_alphastudio-data:/data -v "${PWD}/backups:/backup" alpine \
  sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /backup/alphastudio-docker-data.tgz -C /data"
docker compose up -d
```

Secrets in compose `environment:` are not on the volume — keep `API_AUTH_TOKEN` outside the tar and re-apply on restore.

## Application rollback (code)

1. Prefer git rollback of the **deployment branch tip** or a known good SHA (do not force-push shared history).
2. Rebuild: `npm ci && npm run build` (host) or `docker compose up -d --build`.
3. Run `npm run db:repair` if schema migrations may have advanced (forward-compatible repairs are preferred; never claim down-migrations).
4. Smoke: `/api/health`, one primary conversion, check logs.

## Git merge rollback (stabilize program)

| Step | Action |
|------|--------|
| Abort unmerged PR | Close PR; leave `stabilize/*` and `ux-ui-redesign` intact |
| After mistaken merge to `ux-ui-redesign` | Revert merge commit on that branch (normal push) |
| After mistaken merge to `main` | Revert merge on `main`; do **not** force-push `main` |
| Tags | Do not create `stable/*` tags without explicit operator approval |

## Destructive ops warnings

| Command | Risk |
|---------|------|
| `npm run clear -- --all` | Can wipe `data/` and `.runtime/` |
| `npm run reset` | Cleans, reinstalls, re-inits DB — not a backup |
| Compose volume delete | Permanent data loss without prior tar |

## Minimum rollback rehearsal checklist

1. Backup data (+ optional `.env`).
2. Cold start healthy.
3. Mutate state (e.g. create a job or settings write).
4. Restore backup over data.
5. Restart; confirm pre-mutation state (or absence of mutation).
6. Record commands + timestamps in the stability report.
