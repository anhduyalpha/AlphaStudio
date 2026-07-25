/**
 * Full SQLite init via real server initDb (not dirs-only).
 * Usage: node --import tsx scripts/maint/init-db.mjs
 *        node scripts/maint/init-db.mjs   (when server/dist is built)
 * Env: DB_PATH, DATA_DIR (optional)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

async function loadPair(relDb, relPaths) {
  const dbPath = path.join(projectRoot, relDb);
  const pathsPath = path.join(projectRoot, relPaths);
  if (!fs.existsSync(dbPath) || !fs.existsSync(pathsPath)) return null;
  try {
    const dbMod = await import(pathToFileURL(dbPath).href);
    const pathsMod = await import(pathToFileURL(pathsPath).href);
    if (typeof dbMod.initDb !== 'function' || typeof pathsMod.ensureDataDirs !== 'function') {
      return null;
    }
    return { dbMod, pathsMod };
  } catch (err) {
    console.warn(`[init-db] load failed ${relDb}: ${err?.message || err}`);
    return null;
  }
}

async function main() {
  const dbFile = path.resolve(projectRoot, process.env.DB_PATH || './data/alphastudio.db');
  process.env.DB_PATH = dbFile;
  if (!process.env.DATA_DIR) {
    process.env.DATA_DIR = path.dirname(dbFile);
  }

  const pair =
    (await loadPair('server/dist/db/index.js', 'server/dist/lib/paths.js')) ||
    (await loadPair('server/src/db/index.ts', 'server/src/lib/paths.ts'));

  if (!pair) {
    console.error(
      '[init-db] FAIL: cannot load server initDb (need npm ci + tsx, or npm run build). Refusing dirs-only soft-fail.',
    );
    process.exit(1);
  }

  pair.pathsMod.ensureDataDirs();
  pair.dbMod.initDb(dbFile);
  pair.dbMod.closeDb?.();
  console.log(`[init-db] ok path=${dbFile}`);
}

main().catch((err) => {
  console.error('[init-db] error:', err);
  process.exit(1);
});
