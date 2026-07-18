/**
 * Non-destructive SQLite schema repair for AlphaStudio.
 * Ensures migrations + detect_cache / job_result_cache exist without wiping data.
 *
 * Usage: node scripts/maint/db-repair.mjs
 * Env: DB_PATH (optional, default data/alphastudio.db under repo root)
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);

async function main() {
  const dbPath = path.resolve(
    projectRoot,
    process.env.DB_PATH || './data/alphastudio.db',
  );
  console.log(`[db:repair] path: ${dbPath}`);

  // Prefer compiled dist, fall back to tsx-loaded source via dynamic import of dist
  const candidates = [
    path.join(projectRoot, 'server/dist/db/index.js'),
    path.join(projectRoot, 'server/src/db/index.ts'),
  ];

  let repairDb;
  for (const c of candidates) {
    try {
      if (c.endsWith('.ts')) {
        // When running via node without tsx, skip ts
        continue;
      }
      const mod = await import(pathToFileURL(c).href);
      if (typeof mod.repairDb === 'function') {
        repairDb = mod.repairDb;
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (!repairDb) {
    // Load via better-sqlite3 + migrations directly (no server build required)
    const Database = require('better-sqlite3');
    const fs = await import('node:fs');
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
    console.log(`[db:repair] ok (standalone heal)`);
    console.log(`[db:repair] tables: ${tables.join(', ')}`);
    console.log(`[db:repair] versions: ${versions.join(', ') || '(none)'}`);
    if (!tables.includes('detect_cache')) {
      console.error('[db:repair] FAIL: detect_cache still missing');
      process.exit(1);
    }
    return;
  }

  // Use process-wide open if server modules available
  const { closeDb, initDb } = await import(
    pathToFileURL(path.join(projectRoot, 'server/dist/db/index.js')).href
  ).catch(() => ({ closeDb: null, initDb: null }));

  try {
    if (initDb) initDb(dbPath);
    const result = repairDb(dbPath);
    console.log(`[db:repair] ok`);
    console.log(`[db:repair] tables: ${result.tables.join(', ')}`);
    console.log(`[db:repair] versions: ${result.versions.join(', ')}`);
    if (!result.tables.includes('detect_cache')) {
      console.error('[db:repair] FAIL: detect_cache still missing');
      process.exit(1);
    }
  } finally {
    closeDb?.();
  }
}

main().catch((err) => {
  console.error('[db:repair] error:', err);
  process.exit(1);
});
