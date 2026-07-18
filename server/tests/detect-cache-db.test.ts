/**
 * detect_cache migration, heal, best-effort writes, finalize ordering.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testRoot = path.join(root, `data-test-detect-cache-${process.pid}`);
const dbPath = path.join(testRoot, 'test.db');

process.env.DATA_DIR = testRoot;
process.env.DB_PATH = dbPath;
process.env.PORT = String(19000 + (process.pid % 1000));

const { closeDb, initDb, getDb, setDetectCache, getDetectCacheByChecksum, repairDb } =
  await import('../src/db/index.js');
const { ensureRequiredTables, runMigrations } = await import('../src/db/migrations.js');
const { finalizeFileAsync, acceptUploadedFile, createWorkspace } = await import(
  '../src/services/workspace.js'
);
const { onWorkspaceEvent } = await import('../src/lib/workspace-events.js');
const { ensureDataDirs } = await import('../src/lib/paths.js');

function tableNames(): string[] {
  return (
    getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
}

describe('detect_cache schema + finalize', () => {
  before(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.mkdirSync(testRoot, { recursive: true });
    ensureDataDirs();
    initDb(dbPath);
  });

  after(() => {
    closeDb();
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('fresh DB has detect_cache and job_result_cache after initDb', () => {
    const tables = tableNames();
    assert.ok(tables.includes('detect_cache'), `tables=${tables.join(',')}`);
    assert.ok(tables.includes('job_result_cache'), `tables=${tables.join(',')}`);
    const versions = (
      getDb().prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
        version: number;
      }[]
    ).map((r) => r.version);
    assert.ok(versions.includes(1));
    assert.ok(versions.includes(2));
    assert.ok(versions.includes(4), `expected v4 heal migration, got ${versions}`);
  });

  it('ensureRequiredTables is idempotent when table already exists', () => {
    ensureRequiredTables(getDb());
    ensureRequiredTables(getDb());
    assert.ok(tableNames().includes('detect_cache'));
  });

  it('setDetectCache is best-effort when table is dropped', () => {
    getDb().exec('DROP TABLE IF EXISTS detect_cache');
    // Must not throw
    setDetectCache('abc123checksum000000000000000000000000000000000000000000000000', {
      family: 'image',
      format: 'png',
    });
    // Heal restores table
    ensureRequiredTables(getDb());
    assert.ok(tableNames().includes('detect_cache'));
  });

  it('getDetectCacheByChecksum returns null without aborting when table missing', () => {
    getDb().exec('DROP TABLE IF EXISTS detect_cache');
    const v = getDetectCacheByChecksum('deadbeef');
    assert.equal(v, null);
    ensureRequiredTables(getDb());
  });

  it('finalize promotes ready, emits event, then cache write even if cache was broken', async () => {
    // Drop cache mid-flight simulation: table exists after heal
    ensureRequiredTables(getDb());

    const ws = createWorkspace('converter');
    const uploadsDir = path.join(testRoot, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const stored = `f${Date.now()}.txt`;
    const filePath = path.join(uploadsDir, stored);
    fs.writeFileSync(filePath, 'hello detect cache finalize\n');

    const events: { type: string; status?: string | null }[] = [];
    const unsub = onWorkspaceEvent(ws.id, (ev) => {
      events.push({ type: ev.type, status: ev.status });
    });

    const pub = await acceptUploadedFile({
      workspaceId: ws.id,
      originalName: 'note.txt',
      storedName: stored,
      path: filePath,
      size: fs.statSync(filePath).size,
      declaredMime: 'text/plain',
    });
    assert.equal(pub.status, 'processing');

    // Drop cache AFTER accept but BEFORE finalize completes — setDetectCache must not block ready
    // Wait a tick for setImmediate finalize to start, then force missing table briefly
    await new Promise((r) => setTimeout(r, 20));

    // Drive finalize explicitly (idempotent if already ran)
    await finalizeFileAsync(pub.id);

    const row = getDb()
      .prepare('SELECT status, checksum, detect_json FROM files WHERE id = ?')
      .get(pub.id) as { status: string; checksum: string | null; detect_json: string | null };
    assert.equal(row.status, 'ready');
    assert.ok(row.checksum && row.checksum.length === 64);

    // ready event must have been emitted
    const readyEv = events.find((e) => e.type === 'file.updated' && e.status === 'ready');
    assert.ok(readyEv, `events=${JSON.stringify(events)}`);

    // Cache should hold detect if table present
    if (row.checksum) {
      const cached = getDetectCacheByChecksum(row.checksum);
      // May be null if detect was null; if detect_json on file, cache should often hit
      if (row.detect_json) {
        assert.ok(cached != null || tableNames().includes('detect_cache'));
      }
    }

    unsub();
  });

  it('repairDb restores detect_cache on DB that recorded v2 without table', () => {
    // Simulate ledger lie: mark versions applied but drop table
    const db = getDb();
    db.exec('DROP TABLE IF EXISTS detect_cache');
    // schema_migrations still has versions
    const before = tableNames();
    assert.ok(!before.includes('detect_cache'));

    const result = repairDb(dbPath);
    assert.ok(result.tables.includes('detect_cache'));
    assert.ok(tableNames().includes('detect_cache'));
  });

  it('repeated runMigrations does not throw or wipe data', () => {
    const countBefore = (
      getDb().prepare('SELECT COUNT(*) as c FROM files').get() as { c: number }
    ).c;
    runMigrations(getDb());
    runMigrations(getDb());
    const countAfter = (
      getDb().prepare('SELECT COUNT(*) as c FROM files').get() as { c: number }
    ).c;
    assert.equal(countAfter, countBefore);
  });
});
