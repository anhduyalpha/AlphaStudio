#!/usr/bin/env node
/**
 * npm run backup — snapshot DATA_DIR (+ optional .env) for local/home-server recovery.
 *
 * Does NOT stop the server for you. Prefer stopping the app first so SQLite is idle.
 * Docker volume backup: use docs/stabilize/backup-rollback.md (docker run + tar).
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './lib/platform.mjs';

const help = process.argv.includes('--help') || process.argv.includes('-h');
const includeEnv = process.argv.includes('--include-env');
const destArgIdx = process.argv.indexOf('--dest');
const destArg = destArgIdx >= 0 ? process.argv[destArgIdx + 1] : null;

if (help) {
  console.log(`Usage: npm run backup -- [--dest <dir>] [--include-env]

  Copies the active data directory (DATA_DIR or ./data) into:
    backups/alphastudio-backup-<UTC-timestamp>/

  Options:
    --dest <dir>     Override backup parent directory (absolute or under project root)
    --include-env    Also copy root .env if present (contains secrets — store offline)

  Exit codes: 0 ok, 1 failure
`);
  process.exit(0);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const dataDir = path.resolve(projectRoot, process.env.DATA_DIR || './data');
const dbPath = path.resolve(projectRoot, process.env.DB_PATH || path.join(dataDir, 'alphastudio.db'));
const parent = destArg
  ? path.isAbsolute(destArg)
    ? destArg
    : path.resolve(projectRoot, destArg)
  : path.join(projectRoot, 'backups');
const outDir = path.join(parent, `alphastudio-backup-${stamp()}`);

console.log('AlphaStudio backup');
console.log(`root: ${projectRoot}`);
console.log(`data: ${dataDir}`);
console.log(`db:   ${dbPath}`);
console.log(`out:  ${outDir}`);

if (!fs.existsSync(dataDir) && !fs.existsSync(dbPath)) {
  console.error(`DATA_DIR and DB_PATH missing: ${dataDir} / ${dbPath}`);
  console.error('Nothing to back up. Start the app once or set DATA_DIR/DB_PATH.');
  process.exit(1);
}

try {
  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(dataDir)) {
    copyRecursive(dataDir, path.join(outDir, 'data'));
  } else {
    fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
  }

  // If SQLite lives outside DATA_DIR (misconfigured host), still capture it.
  const dbInsideData =
    dbPath === dataDir ||
    dbPath.startsWith(dataDir.endsWith(path.sep) ? dataDir : dataDir + path.sep);
  if (fs.existsSync(dbPath) && !dbInsideData) {
    fs.copyFileSync(dbPath, path.join(outDir, 'alphastudio.db'));
    console.log('included: DB_PATH outside DATA_DIR');
  }

  const meta = {
    createdAt: new Date().toISOString(),
    projectRoot,
    dataDir,
    dbPath,
    includeEnv,
    note: 'Restore: stop server, replace DATA_DIR contents from data/, optional .env, then npm run db:repair && npm start. Docker: DB_PATH must be /data/alphastudio.db on the volume.',
  };
  fs.writeFileSync(path.join(outDir, 'backup-meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  if (includeEnv) {
    const envPath = path.join(projectRoot, '.env');
    if (fs.existsSync(envPath)) {
      fs.copyFileSync(envPath, path.join(outDir, '.env'));
      console.log('included: .env');
    } else {
      console.log('no .env present (skipped)');
    }
  }

  console.log('[backup] ok');
  console.log(outDir);
  process.exit(0);
} catch (err) {
  console.error('[backup] failed:', err?.message || err);
  process.exit(1);
}
