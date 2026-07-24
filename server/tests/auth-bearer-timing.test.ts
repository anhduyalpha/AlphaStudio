/**
 * S-06: bearer token compare is length-safe and accepts only exact match.
 * Drives shipped buildApp auth hook when API_AUTH_TOKEN is set.
 * Env must be set before config module load (per-file process).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, 'data-test-auth-bearer');
const PORT = 8833;
const TOKEN = 'stabilize-test-token-32chars-xx';

// Config reads API_AUTH_TOKEN at first import — set before dynamic product imports.
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = path.join(dataDir, 'auth.db');
process.env.LOG_LEVEL = 'error';
process.env.API_AUTH_TOKEN = TOKEN;

const { bearerTokensEqual } = await import('../src/lib/bearer.js');
const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');

describe('bearerTokensEqual unit', () => {
  it('matches equal secrets and rejects mismatches / length drift', () => {
    assert.equal(bearerTokensEqual(TOKEN, TOKEN), true);
    assert.equal(bearerTokensEqual('wrong', TOKEN), false);
    assert.equal(bearerTokensEqual(TOKEN.slice(0, -1), TOKEN), false);
    assert.equal(bearerTokensEqual(`${TOKEN}x`, TOKEN), false);
    assert.equal(bearerTokensEqual('', TOKEN), false);
  });
});

describe('API bearer hook', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const base = `http://127.0.0.1:${PORT}`;

  before(async () => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    ensureDataDirs();
    initDb();
    app = await buildApp();
    await app.listen({ port: PORT, host: '127.0.0.1' });
  });

  after(async () => {
    try {
      await app?.close();
    } catch {
      /* ignore */
    }
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

  it('health stays open; protected routes require valid bearer', async () => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);

    const noAuth = await fetch(`${base}/api/version`);
    assert.equal(noAuth.status, 401);

    const bad = await fetch(`${base}/api/version`, {
      headers: { Authorization: 'Bearer not-the-token' },
    });
    assert.equal(bad.status, 401);

    const ok = await fetch(`${base}/api/version`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(ok.status, 200);
  });
});
