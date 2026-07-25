/**
 * format-json must emit application/json + .json so validateJobOutput accepts it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test-format-json');
const PORT = 8831;

process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'fmt.db');
process.env.LOG_LEVEL = 'error';
process.env.MAX_CONCURRENT_JOBS = '1';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');
const { processText } = await import('../src/processors/text.js');
const { validateJobOutput } = await import('../src/workers/jobs.js');

let app: Awaited<ReturnType<typeof buildApp>>;
const base = `http://127.0.0.1:${PORT}`;

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  app = await buildApp();
  await app.listen({ port: PORT, host: '127.0.0.1' });
});

after(async () => {
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 60));
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('format-json output MIME/extension', () => {
  it('processor writes application/json formatted.json', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-json-'));
    try {
      const result = await processText({
        jobId: 'fmt1',
        type: 'text',
        inputPaths: [],
        inputNames: [],
        outputDir: outDir,
        workDir: outDir,
        options: { operation: 'format-json', input: '{"b":1,"a":2}' },
        onProgress: () => {},
        isCancelled: () => false,
      });
      assert.equal(result.outputMime, 'application/json');
      assert.equal(result.outputName, 'formatted.json');
      assert.ok(fs.existsSync(result.outputPath));
      assert.doesNotThrow(() => validateJobOutput(result, result.outputPath));
      const parsed = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));
      assert.equal(parsed.b, 1);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('API job completes and download is JSON', async () => {
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'text',
        options: { operation: 'format-json', input: '{"ok":true}' },
      }),
    });
    assert.ok(res.status === 200 || res.status === 201, `create status ${res.status}`);
    const job = (await res.json()) as { id: string };
    let status = '';
    let downloadUrl: string | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const g = await fetch(`${base}/api/jobs/${job.id}`);
      const body = (await g.json()) as {
        status: string;
        downloadUrl?: string | null;
        outputMime?: string;
        error?: string;
      };
      status = body.status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        downloadUrl = body.downloadUrl || null;
        if (status === 'completed') {
          assert.equal(body.outputMime, 'application/json');
        }
        if (status === 'failed') {
          assert.fail(`job failed: ${body.error}`);
        }
        break;
      }
    }
    assert.equal(status, 'completed');
    assert.ok(downloadUrl);
    const dl = await fetch(`${base}${downloadUrl}`);
    assert.equal(dl.status, 200);
    const text = await dl.text();
    assert.equal(JSON.parse(text).ok, true);
  });
});
