/**
 * Characterization + contract tests for S2 (SPEC §3.5) — capabilities-published
 * contracts. Written BEFORE the consolidation, per PLAN A3 / AUDIT PR-4.
 *
 * Two jobs:
 *  1. Drift — the private tables that still exist (`detect.ts` EXT_FAMILY, the
 *     capability-id map in `processors/index.ts`) must stay in lockstep with the
 *     one format table (`convert/formats.ts`) and the capability layer. Both are
 *     parsed from source so a future edit to either side trips the test.
 *  2. Publication + enforcement — `/api/capabilities` publishes `acceptLists`,
 *     `gatedOps` and `quality`, and the job-create gate accepts/rejects real
 *     uploads against the SAME published lists, so the contract cannot drift
 *     from create-time enforcement.
 *
 * Only bundled capabilities (image.*, pdf.*) are exercised, so the gate
 * assertions do not depend on ffmpeg/LibreOffice being installed.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const root = path.resolve(serverRoot, '..');
const testData = path.join(root, 'data-test-capabilities-contracts');

process.env.PORT = '8844';
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'caps.db');
process.env.LOG_LEVEL = 'error';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');
const { formatFamily, normalizeFormat } = await import('../src/convert/formats.js');
const { DEFAULT_QUALITY_PRESET, QUALITY_PRESETS, resolveQualityPreset } = await import(
  '../src/convert/quality.js'
);

const base = 'http://127.0.0.1:8844';
let app: Awaited<ReturnType<typeof buildApp>>;
let caps: any;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  app = await buildApp();
  await app.listen({ port: 8844, host: '127.0.0.1' });
  const res = await fetch(`${base}/api/capabilities`);
  assert.equal(res.status, 200);
  caps = await res.json();
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
  await new Promise((r) => setTimeout(r, 100));
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* locked files on Windows */
  }
});

async function upload(buf: Buffer, filename: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), filename);
  const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
  const text = await res.text();
  assert.equal(res.status, 201, `upload ${filename}: ${text}`);
  return JSON.parse(text).id as string;
}

async function createJobHttp(type: string, options: Record<string, unknown>, uploadIds: string[]) {
  const res = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, options, uploadIds }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

/** Parse detect.ts's private EXT_FAMILY table straight from source. */
function detectExtFamilyRows(): { ext: string; family: string; format: string }[] {
  const src = fs.readFileSync(path.join(serverRoot, 'src/convert/detect.ts'), 'utf8');
  const start = src.indexOf('const EXT_FAMILY');
  assert.ok(start >= 0, 'EXT_FAMILY table present in detect.ts');
  const block = src.slice(start, src.indexOf('\n};', start));
  const rows: { ext: string; family: string; format: string }[] = [];
  const re = /'(\.[a-z0-9]+)':\s*\{\s*family:\s*'([a-z]+)',\s*format:\s*'([a-z0-9]+)'\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) rows.push({ ext: m[1], family: m[2], format: m[3] });
  assert.ok(rows.length >= 50, `parsed ${rows.length} EXT_FAMILY rows (expected the full table)`);
  return rows;
}

/** Parse the `'<type>:<op>': '<capability.id>'` map from processors/index.ts. */
function capabilityIdMapRows(): { key: string; capability: string }[] {
  const src = fs.readFileSync(path.join(serverRoot, 'src/processors/index.ts'), 'utf8');
  const rows: { key: string; capability: string }[] = [];
  const re = /'([a-z]+:[a-z0-9-]+)':\s*'([a-z0-9.-]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) rows.push({ key: m[1], capability: m[2] });
  assert.ok(rows.length >= 30, `parsed ${rows.length} capability-id rows`);
  return rows;
}

describe('S2 drift — private tables stay in lockstep with the one format table', () => {
  it('every detect.ts extension maps into the published format table with the same family', () => {
    const drift: string[] = [];
    for (const row of detectExtFamilyRows()) {
      const family = formatFamily(row.ext);
      if (family === 'unknown') {
        drift.push(`${row.ext}: unknown to convert/formats.ts`);
        continue;
      }
      if (family !== row.family) {
        drift.push(`${row.ext}: detect.ts says ${row.family}, formats.ts says ${family}`);
      }
      const viaExt = normalizeFormat(row.ext);
      const viaFormat = normalizeFormat(row.format);
      if (viaExt !== viaFormat) {
        drift.push(`${row.ext}: normalizes to ${viaExt} but detect.ts labels it ${viaFormat}`);
      }
    }
    assert.deepEqual(drift, [], `format-table drift:\n  ${drift.join('\n  ')}`);
  });

  it('every capability id the create gate can require is a published tool id', () => {
    const known = new Set((caps.tools as { id: string }[]).map((t) => t.id));
    const missing = capabilityIdMapRows()
      .filter((row) => !known.has(row.capability))
      .map((row) => `${row.key} → ${row.capability}`);
    assert.deepEqual(missing, [], `capability ids absent from /api/capabilities.tools:\n  ${missing.join('\n  ')}`);
  });
});

describe('S2 publication — /api/capabilities publishes the contracts (SPEC §3.5)', () => {
  it('publishes acceptLists derived from the format table', () => {
    assert.ok(caps.acceptLists, 'acceptLists published');
    const lists = caps.acceptLists.lists as Record<string, any>;
    assert.ok(lists && Object.keys(lists).length > 0, 'named accept lists');
    for (const [id, list] of Object.entries(lists)) {
      assert.ok(Array.isArray(list.extensions) && list.extensions.length > 0, `${id}: extensions`);
      assert.ok(Array.isArray(list.mimeTypes) && list.mimeTypes.length > 0, `${id}: mimeTypes`);
      assert.equal(typeof list.label, 'string', `${id}: label`);
      for (const ext of list.extensions as string[]) {
        assert.match(ext, /^\.[a-z0-9+]+$/, `${id}: ${ext} is a dot-prefixed lowercase extension`);
        assert.notEqual(formatFamily(ext), 'unknown', `${id}: ${ext} is a known format`);
      }
      for (const mime of list.mimeTypes as string[]) {
        assert.match(mime, /^[a-z]+\/[a-z0-9.+-]+$/, `${id}: ${mime} is a MIME type`);
      }
    }
    // Every image extension the format table knows is in the image list —
    // the list is derived, not a hand-maintained subset.
    for (const ext of ['.png', '.jpg', '.webp', '.avif', '.gif', '.tiff', '.bmp', '.svg']) {
      assert.ok(lists.image.extensions.includes(ext), `image list contains ${ext}`);
    }
    assert.ok(lists.pdf.extensions.includes('.pdf'));
    assert.ok(!lists.pdf.extensions.includes('.png'), 'the pdf list is not a catch-all');
  });

  it('maps job types and modes onto the named lists', () => {
    const jobTypes = caps.acceptLists.jobTypes as Record<string, any>;
    assert.ok(jobTypes, 'jobTypes mapping published');
    assert.equal(jobTypes.image.default, 'image');
    assert.equal(jobTypes.pdf.default, 'pdf');
    assert.equal(jobTypes.pdf.operations['from-images'], 'image', 'per-mode override');
    assert.equal(jobTypes.qr.operations.generate, null, 'null = no file input restriction');
    const lists = caps.acceptLists.lists as Record<string, any>;
    for (const [type, entry] of Object.entries(jobTypes)) {
      const named = [entry.default, ...Object.values(entry.operations || {})];
      for (const listId of named) {
        if (listId == null) continue;
        assert.ok(lists[listId as string], `${type} references published list "${listId}"`);
      }
    }
  });

  it('publishes gatedOps as exactly the unavailable slice of the capability layer, with reasons', () => {
    assert.ok(Array.isArray(caps.gatedOps), 'gatedOps published');
    const unavailable = (caps.tools as { id: string; available: boolean }[])
      .filter((t) => !t.available)
      .map((t) => t.id)
      .sort();
    assert.deepEqual(
      (caps.gatedOps as { id: string }[]).map((g) => g.id).sort(),
      unavailable,
      'gatedOps === the unavailable capability ids',
    );
    for (const gated of caps.gatedOps as { id: string; reason?: string }[]) {
      assert.equal(typeof gated.reason, 'string', `${gated.id}: reason string`);
      assert.ok((gated.reason as string).length > 0, `${gated.id}: non-empty reason`);
    }
  });

  it('publishes the quality contract, and `max` resolves to exactly one preset', () => {
    assert.ok(caps.quality, 'quality published');
    assert.deepEqual(caps.quality.presets, [...QUALITY_PRESETS]);
    assert.equal(caps.quality.default, DEFAULT_QUALITY_PRESET);
    const aliases = caps.quality.aliases as Record<string, string>;
    assert.equal(aliases.max, 'high', '`max` has one server answer');
    assert.equal(aliases.max, resolveQualityPreset({ quality: 'max' }));
    for (const [alias, target] of Object.entries(aliases)) {
      assert.ok(
        (QUALITY_PRESETS as readonly string[]).includes(target),
        `${alias} → ${target} is a real preset`,
      );
      assert.equal(
        resolveQualityPreset({ quality: alias }),
        target,
        `the server resolves "${alias}" the way it publishes it`,
      );
    }
  });
});

describe('S2 enforcement — the create gate uses the same published lists', () => {
  it('accepts an upload inside the published list for the job type', async () => {
    const id = await upload(PNG_1X1, 'gate-accept.png', 'image/png');
    const created = await createJobHttp('image', { operation: 'rotate', angle: 90 }, [id]);
    assert.equal(created.status, 201, created.text);
  });

  it('accepts an upload inside the published list for a per-mode override', async () => {
    const id = await upload(PNG_1X1, 'gate-from-images.png', 'image/png');
    const created = await createJobHttp('pdf', { operation: 'from-images' }, [id]);
    assert.equal(created.status, 201, created.text);
  });

  it('rejects an upload outside the published list at create time', async () => {
    const id = await upload(PNG_1X1, 'gate-reject.png', 'image/png');
    const created = await createJobHttp('pdf', { operation: 'split' }, [id]);
    assert.equal(created.status, 415, `expected the create gate to refuse: ${created.text}`);
    assert.equal(created.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.match(
      String(created.body.error.message),
      /\.pdf/,
      'the refusal names the published list it was checked against',
    );
  });

  it('rejects a text upload for an image job', async () => {
    const id = await upload(Buffer.from('not an image'), 'gate-reject.txt', 'text/plain');
    const created = await createJobHttp('image', { operation: 'resize', width: 10 }, [id]);
    assert.equal(created.status, 415, `expected the create gate to refuse: ${created.text}`);
  });

  it('leaves unrestricted job types alone', async () => {
    const id = await upload(Buffer.from('anything at all'), 'gate-any.txt', 'text/plain');
    const created = await createJobHttp('security', { operation: 'hash', algorithm: 'sha256' }, [id]);
    assert.equal(created.status, 201, created.text);
  });
});
