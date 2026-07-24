/**
 * Capability honesty regressions (CP03 skeptic follow-up):
 * - searchable OCR dual ids share one truth
 * - text.ocr never claims available without a text processor op
 * - converter create gate returns UNAVAILABLE for unavailable matrix pairs
 * - createJob / POST /api/jobs returns 503 when gate rejects
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test-cap-honesty');
const PORT = 8833;

process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'cap.db');
process.env.LOG_LEVEL = 'error';
process.env.MAX_CONCURRENT_JOBS = '1';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities, isToolAvailable } = await import('../src/capabilities.js');
const { gateConverterCreate, createJob, setTestListOutputsFor } = await import(
  '../src/workers/jobs.js'
);
const { config } = await import('../src/config.js');
const { AppError } = await import('../src/lib/errors.js');

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

function seedUpload(id: string, originalName: string, bytes: Buffer, mime: string): string {
  const uploadsDir = config.uploadsDir;
  fs.mkdirSync(uploadsDir, { recursive: true });
  const stored = path.join(uploadsDir, `${id}${path.extname(originalName)}`);
  fs.writeFileSync(stored, bytes);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO uploads (id, original_name, stored_name, path, mime, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, originalName, path.basename(stored), stored, mime, bytes.length, now);
  return id;
}

describe('searchable OCR dual ids', () => {
  it('pdf.ocr.searchable matches pdf.ocr-searchable availability', () => {
    const caps = detectCapabilities(true);
    const ui = caps.tools.find((t) => t.id === 'pdf.ocr.searchable');
    const pyop = caps.tools.find((t) => t.id === 'pdf.ocr-searchable');
    assert.ok(ui, 'pdf.ocr.searchable published');
    assert.ok(pyop, 'pdf.ocr-searchable published for pyop');
    assert.equal(ui.available, pyop.available, 'dual ids must share truth');
    if (!ui.available) {
      assert.ok(ui.reason && ui.reason.length > 0);
    }
  });
});

describe('text.ocr honesty', () => {
  it('never reports available (no processText ocr op)', () => {
    const caps = detectCapabilities(true);
    const tool = caps.tools.find((t) => t.id === 'text.ocr');
    assert.ok(tool);
    assert.equal(tool.available, false);
    assert.match(String(tool.reason || ''), /not implemented|text job|PDF OCR/i);
    const gate = isToolAvailable('text.ocr');
    assert.equal(gate.available, false);
  });
});

describe('gateConverterCreate F-B03', () => {
  it('throws UNAVAILABLE when listOutputs marks format unavailable', () => {
    assert.throws(
      () =>
        gateConverterCreate(
          'report.docx',
          { format: 'pdf' },
          () => [
            {
              format: 'pdf',
              label: 'PDF',
              available: false,
              reason: 'LibreOffice (soffice) not found. Run npm run setup:tools.',
            },
          ],
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError || (err as { code?: string }).code === 'UNAVAILABLE');
        const e = err as { code?: string; statusCode?: number; message?: string };
        assert.equal(e.code, 'UNAVAILABLE');
        assert.equal(e.statusCode, 503);
        assert.match(String(e.message), /LibreOffice|not found|unavailable/i);
        return true;
      },
    );
  });

  it('does not throw when matrix marks format available', () => {
    assert.doesNotThrow(() =>
      gateConverterCreate(
        'photo.png',
        { format: 'webp' },
        () => [{ format: 'webp', label: 'WebP', available: true }],
      ),
    );
  });
});

describe('createJob + HTTP 503 for unavailable converter pair', () => {
  it('createJob throws UNAVAILABLE when matrix reports format unavailable (shipped path)', () => {
    seedUpload(
      'hon-docx',
      'report.docx',
      Buffer.from('PK\x03\x04fake-docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    setTestListOutputsFor(() => [
      {
        format: 'pdf',
        label: 'PDF',
        available: false,
        reason: 'LibreOffice (soffice) not found. Run npm run setup:tools.',
      },
    ]);
    try {
      assert.throws(
        () =>
          createJob({
            type: 'converter',
            uploadIds: ['hon-docx'],
            options: { format: 'pdf', operation: 'batch' },
          }),
        (err: unknown) => {
          const e = err as { code?: string; statusCode?: number };
          return e.code === 'UNAVAILABLE' || e.statusCode === 503;
        },
      );
    } finally {
      setTestListOutputsFor(null);
    }
  });

  it('POST /api/jobs returns 503 when create gate rejects unavailable pair', async () => {
    seedUpload(
      'hon-http-docx',
      'letter.docx',
      Buffer.from('PK\x03\x04fake'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    setTestListOutputsFor(() => [
      {
        format: 'pdf',
        label: 'PDF',
        available: false,
        reason: 'LibreOffice (soffice) not found. Run npm run setup:tools.',
      },
    ]);
    try {
      const res = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'converter',
          uploadIds: ['hon-http-docx'],
          options: { format: 'pdf', operation: 'batch' },
        }),
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      assert.equal(body.error?.code, 'UNAVAILABLE');
      assert.match(String(body.error?.message || ''), /LibreOffice|not found/i);
    } finally {
      setTestListOutputsFor(null);
    }
  });
});
