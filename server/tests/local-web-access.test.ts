import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

/**
 * When ALPHA_SMOKE_URL is set (e.g. http://127.0.0.1:8787), hit the live server.
 * Otherwise assert production serve config + built frontend exist so `npm start` can serve UI.
 */
describe('local web access', () => {
  const base = process.env.ALPHA_SMOKE_URL || process.env.BASE_URL || '';

  function get(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 8_000 }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`timeout ${url}`));
      });
    });
  }

  it('ships SERVE_FRONTEND production path and built index.html', () => {
    const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    assert.match(envExample, /SERVE_FRONTEND=1/);
    assert.match(envExample, /PORT=8787/);
    const index = path.join(root, 'dist', 'index.html');
    assert.ok(fs.existsSync(index), 'dist/index.html missing — run npm run build');
    const html = fs.readFileSync(index, 'utf8');
    assert.match(html, /id="root"/);
    assert.match(html, /AlphaStudio/i);
    const serverEntry = path.join(root, 'server', 'dist', 'index.js');
    assert.ok(fs.existsSync(serverEntry), 'server/dist/index.js missing — run npm run build');
  });

  it('live health + frontend when ALPHA_SMOKE_URL is set', async (t) => {
    if (!base) {
      t.skip('Set ALPHA_SMOKE_URL=http://127.0.0.1:8787 with server running to exercise live HTTP');
      return;
    }
    const h1 = await get(`${base.replace(/\/$/, '')}/api/health`);
    const h2 = await get(`${base.replace(/\/$/, '')}/api/health`);
    assert.equal(h1.status, 200);
    assert.equal(h2.status, 200);
    assert.match(h1.body, /"ok"\s*:\s*true|"status"\s*:\s*"healthy"/);
    assert.match(h2.body, /"ok"\s*:\s*true|"status"\s*:\s*"healthy"/);

    const w1 = await get(`${base.replace(/\/$/, '')}/`);
    const w2 = await get(`${base.replace(/\/$/, '')}/`);
    assert.equal(w1.status, 200);
    assert.equal(w2.status, 200);
    assert.ok(w1.body.length > 100);
    assert.match(w1.body, /id="root"|AlphaStudio/i);
    assert.match(w2.body, /id="root"|AlphaStudio/i);
  });
});
