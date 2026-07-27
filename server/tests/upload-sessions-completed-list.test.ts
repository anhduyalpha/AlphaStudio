import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, `data-test-upload-list-${process.pid}`);

process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'upload-list.db');
process.env.LOG_LEVEL = 'error';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { createUploadSession } = await import('../src/services/upload-session.js');
const { insertFile } = await import('../src/services/workspace.js');

let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  app = await buildApp();
});

after(async () => {
  try {
    await app.close();
  } catch {
    // ignore shutdown after a failed assertion
  }
  try {
    closeDb();
  } catch {
    // ignore shutdown after a failed assertion
  }
  fs.rmSync(testData, { recursive: true, force: true });
});

describe('completed upload-session discovery', () => {
  it('keeps the legacy list active-only and includes completed rows on request', async () => {
    const active = createUploadSession({
      originalName: 'active.bin',
      size: 1024,
      mime: 'application/octet-stream',
    });
    const completed = createUploadSession({
      workspaceId: active.workspaceId,
      originalName: 'completed.bin',
      size: 2048,
      mime: 'application/octet-stream',
    });
    const storedPath = path.join(testData, 'uploads', 'completed.bin');
    fs.mkdirSync(path.dirname(storedPath), { recursive: true });
    fs.writeFileSync(storedPath, Buffer.alloc(2048));
    const file = insertFile({
      workspaceId: active.workspaceId,
      originalName: 'completed.bin',
      storedName: 'completed.bin',
      path: storedPath,
      mime: 'application/octet-stream',
      size: 2048,
      ext: '.bin',
      uploadSessionId: completed.id,
      status: 'ready',
    });
    getDb()
      .prepare(
        `UPDATE upload_sessions
         SET status = 'completed', finalized_file_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(file.id, new Date().toISOString(), completed.id);

    const legacy = await app.inject({
      method: 'GET',
      url: `/api/upload-sessions?workspaceId=${encodeURIComponent(active.workspaceId)}`,
    });
    assert.equal(legacy.statusCode, 200);
    assert.deepEqual(
      legacy.json().sessions.map((session: { id: string }) => session.id),
      [active.id],
    );

    const withCompleted = await app.inject({
      method: 'GET',
      url: `/api/upload-sessions?workspaceId=${encodeURIComponent(active.workspaceId)}&includeCompleted=1`,
    });
    assert.equal(withCompleted.statusCode, 200);
    const listedIds = withCompleted
      .json()
      .sessions.map((session: { id: string }) => session.id)
      .sort();
    assert.deepEqual(
      listedIds,
      [active.id, completed.id].sort(),
    );
    assert.equal(
      withCompleted.json().sessions.find((session: { id: string }) => session.id === completed.id)
        .fileId,
      file.id,
    );
  });
});
