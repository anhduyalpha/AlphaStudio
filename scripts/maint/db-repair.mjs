/**
 * Non-destructive SQLite schema repair for AlphaStudio.
 * Prefers full server repairDb/initDb (dist or TS under --import tsx).
 * Fallback standalone heal only if neither is loadable — logs clearly.
 *
 * Usage: npm run db:repair
 *        node --import tsx scripts/maint/db-repair.mjs
 * Env: DB_PATH (optional, default data/alphastudio.db under repo root)
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);

async function tryImportRepair(modulePath) {
  try {
    if (!fs.existsSync(modulePath)) return null;
    const mod = await import(pathToFileURL(modulePath).href);
    if (typeof mod.repairDb === 'function' && typeof mod.initDb === 'function') {
      return mod;
    }
  } catch (err) {
    console.warn(`[db:repair] load failed ${path.relative(projectRoot, modulePath)}: ${err?.message || err}`);
  }
  return null;
}

async function standaloneHeal(dbPath) {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS detect_cache (
      checksum TEXT PRIMARY KEY,
      detect_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_detect_cache_created ON detect_cache(created_at);
    CREATE TABLE IF NOT EXISTS job_result_cache (
      cache_key TEXT PRIMARY KEY,
      output_path TEXT NOT NULL,
      output_name TEXT NOT NULL,
      output_mime TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_result_cache_created ON job_result_cache(created_at);
  `);
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => r.name);
  const versions = db
    .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
    .all()
    .map((r) => r.version);
  db.close();
  console.log(`[db:repair] ok (standalone partial heal — run after build or with tsx for full migrations)`);
  console.log(`[db:repair] tables: ${tables.join(', ')}`);
  console.log(`[db:repair] versions: ${versions.join(', ') || '(none)'}`);
  if (!tables.includes('detect_cache')) {
    console.error('[db:repair] FAIL: detect_cache still missing');
    process.exit(1);
  }
}

async function main() {
  const dbPath = path.resolve(projectRoot, process.env.DB_PATH || './data/alphastudio.db');
  process.env.DB_PATH = dbPath;
  console.log(`[db:repair] path: ${dbPath}`);

  const mod =
    (await tryImportRepair(path.join(projectRoot, 'server/dist/db/index.js'))) ||
    (await tryImportRepair(path.join(projectRoot, 'server/src/db/index.ts')));

  if (!mod) {
    await standaloneHeal(dbPath);
    return;
  }

  try {
    mod.initDb(dbPath);
    const result = mod.repairDb(dbPath);
    console.log(`[db:repair] ok (full repairDb)`);
    console.log(`[db:repair] tables: ${result.tables.join(', ')}`);
    console.log(`[db:repair] versions: ${result.versions.join(', ')}`);
    if (!result.tables.includes('detect_cache')) {
      console.error('[db:repair] FAIL: detect_cache still missing');
      process.exit(1);
    }
  } finally {
    mod.closeDb?.();
  }
}

main().catch((err) => {
  console.error('[db:repair] error:', err);
  process.exit(1);
});
