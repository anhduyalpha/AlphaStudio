/**
 * Cleanup / retention evidence: temp TTL purge + expired upload-session GC.
 * Drives shipped cleanupExpiredFiles and cleanupExpiredUploadSessions.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, 'data-test-cleanup-retention');

process.env.PORT = '8834';
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = path.join(dataDir, 'cleanup.db');
process.env.LOG_LEVEL = 'error';
process.env.TEMP_TTL_MS = '1000';
process.env.UPLOAD_SESSION_TTL_MS = '1000';
process.env.WORKSPACE_RETENTION_MS = String(7 * 24 * 60 * 60 * 1000);

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { config } = await import('../src/config.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { cleanupExpiredFiles } = await import('../src/workers/jobs.js');
const { cleanupExpiredUploadSessions } = await import('../src/services/upload-session.js');

before(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
});

after(() => {
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('cleanupExpiredFiles temp TTL', () => {
  it('removes aged scratch under tempDir and keeps fresh files', () => {
    const oldFile = path.join(config.tempDir, 'old-scratch.bin');
    const newFile = path.join(config.tempDir, 'new-scratch.bin');
    fs.writeFileSync(oldFile, 'old');
    fs.writeFileSync(newFile, 'new');
    const oldTime = Date.now() - 60_000;
    fs.utimesSync(oldFile, new Date(oldTime), new Date(oldTime));

    cleanupExpiredFiles();

    assert.equal(fs.existsSync(oldFile), false, 'aged temp scratch must be purged');
    assert.equal(fs.existsSync(newFile), true, 'fresh temp file must survive');
  });
});

describe('cleanupExpiredUploadSessions', () => {
  it('deletes expired DB sessions and their directories', () => {
    const wsId = 'ws-cleanup-sess';
    const nowIso = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO workspaces (id, route, status, created_at, updated_at, last_seen_at)
         VALUES (?, 'dashboard', 'active', ?, ?, ?)`,
      )
      .run(wsId, nowIso, nowIso, nowIso);

    const id = randomUUID();
    const sessionPath = path.join(config.uploadSessionsDir, id);
    fs.mkdirSync(sessionPath, { recursive: true });
    fs.writeFileSync(path.join(sessionPath, '0.chunk'), 'x');
    const past = new Date(Date.now() - 60_000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO upload_sessions (
          id, workspace_id, original_name, declared_mime, size, chunk_size, total_chunks,
          status, created_at, updated_at, expires_at
        ) VALUES (?, ?, 'x.bin', 'application/octet-stream', 1, 1, 1,
          'uploading', ?, ?, ?)`,
      )
      .run(id, wsId, past, past, past);

    const result = cleanupExpiredUploadSessions();
    assert.ok(result.sessions >= 1, 'must remove at least the expired session');
    assert.equal(fs.existsSync(sessionPath), false, 'session directory must be removed');
    const row = getDb().prepare('SELECT id FROM upload_sessions WHERE id = ?').get(id);
    assert.equal(row, undefined);
  });

  it('removes aged orphan UUID directories not in DB', () => {
    const orphanId = randomUUID();
    const orphanPath = path.join(config.uploadSessionsDir, orphanId);
    fs.mkdirSync(orphanPath, { recursive: true });
    fs.writeFileSync(path.join(orphanPath, '0.chunk'), 'orphan');
    const oldTime = Date.now() - 60_000;
    fs.utimesSync(orphanPath, new Date(oldTime), new Date(oldTime));

    const result = cleanupExpiredUploadSessions();
    assert.ok(result.orphanDirectories >= 1);
    assert.equal(fs.existsSync(orphanPath), false);
  });
});
