/**
 * Goal verification E2E (in-repo): multi-file finalize, SSE ready events,
 * detect_cache heal, PDF→PDF reject. Run as part of npm test.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testRoot = path.join(root, `data-test-goal-e2e-${process.pid}`);
const dbPath = path.join(testRoot, 'e2e.db');

process.env.DATA_DIR = testRoot;
process.env.DB_PATH = dbPath;

const { initDb, closeDb, getDb, repairDb, setDetectCache } = await import('../src/db/index.js');
const { ensureDataDirs } = await import('../src/lib/paths.js');
const {
  createWorkspace,
  acceptUploadedFile,
  finalizeFileAsync,
  hydrateWorkspace,
} = await import('../src/services/workspace.js');
const { onWorkspaceEvent } = await import('../src/lib/workspace-events.js');
const { assertPairAllowed } = await import('../src/convert/matrix.js');
const { isSameFormatPair } = await import('../src/convert/office.js');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function runOnce(label: string) {
  const events: { type: string; status?: string | null; fileId?: string | null; version: number; updatedAt: string }[] =
    [];
  const ws = createWorkspace('converter');
  const unsub = onWorkspaceEvent(ws.id, (ev) => {
    events.push({
      type: ev.type,
      status: ev.status,
      fileId: ev.fileId,
      version: ev.version,
      updatedAt: ev.updatedAt,
    });
  });

  const names = [`a-${label}.txt`, `b-${label}.txt`, `c-${label}.png`];
  const ids: string[] = [];
  for (const n of names) {
    const stored = `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(n)}`;
    const p = path.join(testRoot, 'uploads', stored);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (n.endsWith('.png')) fs.writeFileSync(p, PNG_1X1);
    else fs.writeFileSync(p, `e2e ${n}\n`);
    const pub = await acceptUploadedFile({
      workspaceId: ws.id,
      originalName: n,
      storedName: stored,
      path: p,
      size: fs.statSync(p).size,
    });
    ids.push(pub.id);
    await finalizeFileAsync(pub.id);
  }

  for (const id of ids) {
    const row = getDb()
      .prepare('SELECT status, checksum FROM files WHERE id=?')
      .get(id) as { status: string; checksum: string | null };
    assert.equal(row.status, 'ready', `${label} ${id}`);
    assert.ok(row.checksum && row.checksum.length === 64);
  }

  const readyEvents = events.filter((e) => e.type === 'file.updated' && e.status === 'ready');
  assert.ok(readyEvents.length >= ids.length, `${label} ready events=${readyEvents.length}`);
  for (const ev of readyEvents) {
    assert.ok(ev.fileId);
    assert.ok(ev.version >= 1);
    assert.ok(ev.updatedAt);
  }

  const snap = hydrateWorkspace(ws.id);
  assert.ok(snap.files.filter((f) => f.status === 'ready').length >= ids.length);

  // Force missing table → repair
  getDb().exec('DROP TABLE IF EXISTS detect_cache');
  const repaired = repairDb(dbPath);
  assert.ok(repaired.tables.includes('detect_cache'));

  // Best-effort cache after heal
  setDetectCache('a'.repeat(64), { family: 'text', format: 'txt' });

  unsub();
  return { ids, readyEvents: readyEvents.length, dbPath };
}

describe('goal e2e verify (run twice)', () => {
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

  it('run A: multi-file ready + SSE + repair', async () => {
    const r = await runOnce('A');
    assert.equal(r.ids.length, 3);
  });

  it('run B: multi-file ready + SSE again (consistent)', async () => {
    const r = await runOnce('B');
    assert.equal(r.ids.length, 3);
  });

  it('PDF→PDF never allowed as convert pair', () => {
    assert.equal(isSameFormatPair('pdf', 'pdf'), true);
    assert.throws(
      () =>
        assertPairAllowed(
          { family: 'pdf', format: 'pdf', ext: '.pdf', mime: 'application/pdf' },
          'pdf',
        ),
      /not supported|pdf/i,
    );
  });

  it('shared db path is process env DB_PATH', () => {
    assert.equal(path.resolve(dbPath), path.resolve(process.env.DB_PATH || ''));
  });
});
