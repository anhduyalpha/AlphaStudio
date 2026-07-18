/**
 * Single-user app: no application-level request rate limiting.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');

describe('rate-limit removed', () => {
  it('app.ts does not import or register @fastify/rate-limit', () => {
    const app = fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8');
    assert.ok(!/@fastify\/rate-limit/.test(app));
    assert.ok(!/register\(rateLimit/.test(app));
    assert.ok(!/from '@fastify\/rate-limit'/.test(app));
  });

  it('config has no rateLimitMax / RATE_LIMIT env', () => {
    const cfg = fs.readFileSync(path.join(root, 'src/config.ts'), 'utf8');
    assert.ok(!/rateLimitMax/.test(cfg));
    assert.ok(!/RATE_LIMIT_MAX/.test(cfg));
    assert.ok(!/RATE_LIMIT_WINDOW/.test(cfg));
  });

  it('server package.json does not depend on @fastify/rate-limit', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.ok(!pkg.dependencies?.['@fastify/rate-limit']);
  });

  it('.env.example has no RATE_LIMIT lines', () => {
    const envEx = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    assert.ok(!/RATE_LIMIT/.test(envEx));
  });
});

describe('rapid health requests never 429 from rate limit', () => {
  let app: any;
  let base: string;
  let closeDb: () => void;

  before(async () => {
    const data = path.join(root, '..', 'data-test-ratelimit');
    fs.rmSync(data, { recursive: true, force: true });
    process.env.PORT = '8791';
    process.env.HOST = '127.0.0.1';
    process.env.DATA_DIR = data;
    process.env.DB_PATH = path.join(data, 't.db');
    process.env.LOG_LEVEL = 'error';
    const paths = await import('../src/lib/paths.js');
    paths.ensureDataDirs();
    const db = await import('../src/db/index.js');
    db.initDb();
    closeDb = () => {
      try {
        db.closeDb();
      } catch {
        /* ignore */
      }
    };
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.listen({ port: 8791, host: '127.0.0.1' });
    base = 'http://127.0.0.1:8791';
  });

  after(async () => {
    try {
      await app?.close();
    } catch {
      /* ignore */
    }
    closeDb?.();
  });

  it('50 rapid /api/health calls all succeed (no 429)', async () => {
    const codes: number[] = [];
    await Promise.all(
      Array.from({ length: 50 }, async () => {
        const r = await fetch(`${base}/api/health`);
        codes.push(r.status);
      }),
    );
    assert.ok(codes.every((c) => c === 200), `unexpected statuses: ${[...new Set(codes)].join(',')}`);
    assert.ok(!codes.includes(429));
  });
});
