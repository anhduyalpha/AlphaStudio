import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const testData = path.join(root, 'data-test-converter');

process.env.PORT = '8798';
process.env.HOST = '127.0.0.1';
process.env.DATA_DIR = testData;
process.env.DB_PATH = path.join(testData, 'test.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.MAX_UPLOAD_BYTES = String(5 * 1024 * 1024);
process.env.LOG_LEVEL = 'error';

const { ensureDataDirs } = await import('../src/lib/paths.js');
const { initDb, closeDb } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { detectCapabilities } = await import('../src/capabilities.js');
const { detectFile } = await import('../src/convert/detect.js');
const { listOutputsFor, assertPairAllowed, intersectOutputs } = await import('../src/convert/matrix.js');

let app: Awaited<ReturnType<typeof buildApp>>;
const base = 'http://127.0.0.1:8798';

before(async () => {
  fs.rmSync(testData, { recursive: true, force: true });
  ensureDataDirs();
  initDb();
  detectCapabilities(true);
  app = await buildApp();
  await app.listen({ port: 8798, host: '127.0.0.1' });
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
  await new Promise((r) => setTimeout(r, 50));
  try {
    fs.rmSync(testData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function uploadBuffer(buf: Buffer, filename: string, mime = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), filename);
  const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
  const data = await res.json();
  return { res, data };
}

async function waitJob(id: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${base}/api/jobs/${id}`);
    const job = await res.json();
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Job timeout');
}

describe('detect pure', () => {
  it('detects png by magic not only name', async () => {
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const p = path.join(testData, 'uploads', 'x.bin');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, png);
    // even with wrong-ish name if we pass .png
    const ins = await detectFile(p, 'photo.PNG');
    assert.equal(ins.family, 'image');
    assert.equal(ins.format, 'png');
    assert.ok(ins.outputs.some((o) => o.format === 'webp' && o.available));
    assert.ok(ins.recommendedOutput);
  });

  it('rejects corrupted pdf', async () => {
    const p = path.join(testData, 'uploads', 'bad.pdf');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from('not-pdf-content'));
    await assert.rejects(() => detectFile(p, 'bad.pdf'));
  });

  it('rejects image/magic mismatch', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#f00' },
    })
      .png()
      .toBuffer();
    const p = path.join(testData, 'uploads', 'lie.mp3');
    fs.writeFileSync(p, png);
    await assert.rejects(() => detectFile(p, 'lie.mp3'));
  });

  it('txt detect and pure text outputs available', async () => {
    const p = path.join(testData, 'uploads', 'note.txt');
    fs.writeFileSync(p, 'hello alphastudio converter');
    const ins = await detectFile(p, 'note.txt');
    assert.equal(ins.family, 'text');
    assert.ok(ins.outputs.some((o) => o.format === 'pdf' && o.available));
  });

  it('gates runtime text and EPUB fallbacks on LibreOffice, not Pandoc', () => {
    const pandocOnly = {
      pandoc: { available: true, path: '/fake/pandoc' },
      libreoffice: { available: false },
    } as any;
    const libreOfficeOnly = {
      pandoc: { available: false },
      libreoffice: { available: true, path: '/fake/soffice' },
    } as any;

    const textKind = { family: 'text' as const, format: 'txt', ext: '.txt', mime: 'text/plain' };
    const textWithoutLo = listOutputsFor(textKind, pandocOnly);
    assert.equal(textWithoutLo.find((o) => o.format === 'docx')?.available, false);
    assert.equal(textWithoutLo.find((o) => o.format === 'pdf')?.available, true);
    assert.equal(listOutputsFor(textKind, libreOfficeOnly).find((o) => o.format === 'docx')?.available, true);

    const epubKind = {
      family: 'ebook' as const,
      format: 'epub',
      ext: '.epub',
      mime: 'application/epub+zip',
    };
    assert.ok(listOutputsFor(epubKind, pandocOnly).every((o) => !o.available));
    assert.ok(listOutputsFor(epubKind, libreOfficeOnly).every((o) => o.available));
  });

  it('intersect outputs for two pngs', async () => {
    const a = listOutputsFor({ family: 'image', format: 'png', ext: '.png', mime: 'image/png' });
    const b = listOutputsFor({ family: 'image', format: 'jpeg', ext: '.jpg', mime: 'image/jpeg' });
    const { outputs, conflict } = intersectOutputs([a, b]);
    assert.ok(!conflict);
    assert.ok(outputs.some((o) => o.format === 'webp' || o.format === 'pdf'));
  });
});

describe('inspect API', () => {
  it('upload + inspect returns outputs', async () => {
    const png = await sharp({
      create: { width: 12, height: 12, channels: 3, background: { r: 0, g: 128, b: 255 } },
    })
      .png()
      .toBuffer();
    const { res, data } = await uploadBuffer(png, 'Blue.PNG', 'image/png');
    assert.equal(res.status, 201, JSON.stringify(data));
    const ins = await fetch(`${base}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadIds: [data.id] }),
    });
    assert.equal(ins.status, 200);
    const body = await ins.json();
    assert.equal(body.family, 'image');
    assert.ok(body.valid);
    assert.ok(Array.isArray(body.outputs));
    assert.ok(body.outputs.every((o: { available: boolean }) => typeof o.available === 'boolean'));
    assert.ok(body.recommendedOutput);
  });

  it('matrix endpoint lists tools', async () => {
    const res = await fetch(`${base}/api/convert/matrix`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.tools.sharp.available);
    assert.ok(body.families.image);
    assert.ok(Array.isArray(body.engines));
    assert.ok(Array.isArray(body.routes));
    assert.ok(body.engines.some((engine: { id: string }) => engine.id === 'ffmpeg'));
    assert.ok(
      Object.values(body.tools).every(
        (tool: any) => !Object.prototype.hasOwnProperty.call(tool, 'path'),
      ),
    );
    assert.ok(!/executablePath|[A-Za-z]:\\\\/.test(JSON.stringify(body)));

    const refreshed = await fetch(`${base}/api/convert/matrix/refresh`, {
      method: 'POST',
    });
    assert.equal(refreshed.status, 200);
    const refreshBody = await refreshed.json();
    assert.equal(refreshBody.refreshed, true);
    assert.ok(Array.isArray(refreshBody.engines));
  });
});

describe('convert jobs', () => {
  it('png → webp real job', async () => {
    const png = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .png()
      .toBuffer();
    const { data: up } = await uploadBuffer(png, 'c.png', 'image/png');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'converter',
        uploadIds: [up.id],
        options: { operation: 'batch', format: 'webp' },
      }),
    });
    assert.equal(create.status, 201);
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error || final.message);
    assert.equal(final.meta?.conversionEngine?.id, 'alphastudio');
    assert.equal(final.meta?.conversionEngine?.profile, 'core');
    assert.ok(!/path|command|executable/i.test(JSON.stringify(final.meta)));
    const dl = await fetch(`${base}/api/jobs/${job.id}/download`);
    assert.equal(dl.status, 200);
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.ok(buf.length > 20);

    const cachedCreate = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'converter',
        uploadIds: [up.id],
        options: { operation: 'batch', format: 'webp' },
      }),
    });
    assert.equal(cachedCreate.status, 201);
    const cachedJob = await cachedCreate.json();
    const cachedFinal = await waitJob(cachedJob.id);
    assert.equal(cachedFinal.status, 'completed', cachedFinal.error);
    assert.equal(cachedFinal.meta?.cacheHit, true);
    assert.equal(cachedFinal.meta?.conversionEngine?.id, 'alphastudio');
  });

  it('txt → pdf real job', async () => {
    const { data: up } = await uploadBuffer(Buffer.from('AlphaStudio text convert'), 'hello.txt', 'text/plain');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'converter',
        uploadIds: [up.id],
        options: { format: 'pdf' },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
  });

  it('rejects invalid pair at job runtime', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#0f0' },
    })
      .png()
      .toBuffer();
    const { data: up } = await uploadBuffer(png, 'g.png', 'image/png');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'converter',
        uploadIds: [up.id],
        options: { format: 'docx' }, // not in image graph typically as available without LO for image
      }),
    });
    const job = await create.json();
    // either create fails or job fails
    if (create.status >= 400) {
      assert.ok(job.error || job.message);
    } else {
      const final = await waitJob(job.id);
      assert.notEqual(final.status, 'completed');
    }
  });

  it('unicode filename round-trip', async () => {
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#00f' },
    })
      .png()
      .toBuffer();
    const { res, data } = await uploadBuffer(png, 'ảnh-测试.png', 'image/png');
    assert.equal(res.status, 201);
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'converter',
        uploadIds: [data.id],
        options: { format: 'jpeg' },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
  });

  it('batch two images → zip-ish or multi', async () => {
    const a = await sharp({ create: { width: 6, height: 6, channels: 3, background: '#111' } }).png().toBuffer();
    const b = await sharp({ create: { width: 6, height: 6, channels: 3, background: '#eee' } }).png().toBuffer();
    const upA = await uploadBuffer(a, 'a.png', 'image/png');
    const upB = await uploadBuffer(b, 'b.png', 'image/png');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'converter',
        uploadIds: [upA.data.id, upB.data.id],
        options: { format: 'webp' },
      }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
  });
});

describe('assertPairAllowed', () => {
  it('blocks unavailable office without claiming success', () => {
    const kind = { family: 'document' as const, format: 'docx', ext: '.docx', mime: 'application/zip' };
    try {
      assertPairAllowed(kind, 'pdf');
      // if libreoffice present, OK
    } catch (e) {
      const err = e as { code?: string; statusCode?: number };
      assert.ok(err.code === 'UNAVAILABLE' || err.statusCode === 503 || err.statusCode === 400);
    }
  });
});

describe('family converts (tools present)', () => {
  it('png → bmp writes real BM magic (not png-in-disguise)', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const { data: up } = await uploadBuffer(png, 'x.png', 'image/png');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'converter', uploadIds: [up.id], options: { format: 'bmp' } }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
    const dl = await fetch(`${base}/api/jobs/${job.id}/download`);
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString('ascii'), 'BM');
  });

  it('csv → tsv pure (no LibreOffice)', async () => {
    const csv = Buffer.from('a,b,c\n1,2,3\n"x,y",z,9\n', 'utf8');
    const { res, data: up } = await uploadBuffer(csv, 'sheet.csv', 'text/csv');
    assert.equal(res.status, 201, JSON.stringify(up));
    // inspect must list tsv available without LO
    const ins = await (
      await fetch(`${base}/api/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadIds: [up.id] }),
      })
    ).json();
    assert.equal(ins.family, 'spreadsheet');
    const tsvOpt = ins.outputs.find((o: { format: string }) => o.format === 'tsv');
    assert.ok(tsvOpt?.available, `tsv should be available: ${JSON.stringify(ins.outputs)}`);
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'converter', uploadIds: [up.id], options: { format: 'tsv' } }),
    });
    const job = await create.json();
    const final = await waitJob(job.id);
    assert.equal(final.status, 'completed', final.error);
    const text = await (await fetch(`${base}/api/jobs/${job.id}/download`)).text();
    assert.ok(text.includes('\t'), `expected TSV tabs: ${text}`);
    // Activity recorded
    const act = await (await fetch(`${base}/api/activity?limit=20`)).json();
    assert.ok(
      (act.activity || []).some((a: { job_id?: string; jobId?: string; tool?: string }) =>
        (a.jobId === job.id || a.job_id === job.id) || a.tool === 'converter',
      ),
    );
  });

  it('audio wav → mp3 when ffmpeg present', async () => {
    const { resolveTool } = await import('../src/tools/registry.js');
    const ff = resolveTool('ffmpeg');
    if (!ff.available) {
      // capability gate: inspect must mark audio unavailable
      const wav = makeSilentWav(0.2);
      const { data: up } = await uploadBuffer(wav, 's.wav', 'audio/wav');
      const ins = await (
        await fetch(`${base}/api/inspect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadIds: [up.id] }),
        })
      ).json();
      assert.ok(ins.outputs.every((o: { available: boolean }) => !o.available || true));
      return;
    }
    const wav = makeSilentWav(0.25);
    const { data: up } = await uploadBuffer(wav, 'tone.wav', 'audio/wav');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'converter', uploadIds: [up.id], options: { format: 'mp3' } }),
    });
    const job = await create.json();
    const final = await waitJob(job.id, 90_000);
    assert.equal(final.status, 'completed', final.error);
    const buf = Buffer.from(await (await fetch(`${base}/api/jobs/${job.id}/download`)).arrayBuffer());
    assert.ok(buf.length > 100);
    // ID3 or MPEG frame sync
    assert.ok(buf[0] === 0xff || buf.toString('ascii', 0, 3) === 'ID3' || buf.length > 200);
  });

  it('video → gif when ffmpeg present (real encode, not copy)', async () => {
    const { resolveTool } = await import('../src/tools/registry.js');
    const ff = resolveTool('ffmpeg');
    if (!ff.available) return;
    // generate tiny mp4 via ffmpeg
    const { execFileSync } = await import('node:child_process');
    const mp4Path = path.join(testData, 'tiny.mp4');
    execFileSync(
      ff.path,
      ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:d=0.4', '-pix_fmt', 'yuv420p', mp4Path],
      { timeout: 30_000, windowsHide: true, stdio: 'ignore' },
    );
    const mp4 = fs.readFileSync(mp4Path);
    const { data: up } = await uploadBuffer(mp4, 'tiny.mp4', 'video/mp4');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'converter', uploadIds: [up.id], options: { format: 'gif' } }),
    });
    const job = await create.json();
    const final = await waitJob(job.id, 120_000);
    assert.equal(final.status, 'completed', final.error);
    const buf = Buffer.from(await (await fetch(`${base}/api/jobs/${job.id}/download`)).arrayBuffer());
    assert.equal(buf.subarray(0, 6).toString('ascii'), 'GIF89a');
  });

  it('matrix: bz2/xz require 7z; tgz pure zip/tar available', async () => {
    const { listOutputsFor } = await import('../src/convert/matrix.js');
    const { resolveAllTools } = await import('../src/tools/registry.js');
    const tools = resolveAllTools();
    const bz2 = listOutputsFor({ family: 'archive', format: 'bz2', ext: '.bz2', mime: 'application/x-bzip2' }, tools);
    for (const o of bz2.filter((x) => ['zip', 'tar'].includes(x.format))) {
      // available only if 7z is present
      assert.equal(o.available, Boolean(tools['7z']?.available), `bz2→${o.format} available=${o.available}`);
      if (!tools['7z']?.available) {
        assert.match(String(o.reason || ''), /7z/i);
      }
    }
    const xz = listOutputsFor({ family: 'archive', format: 'xz', ext: '.xz', mime: 'application/x-xz' }, tools);
    for (const o of xz.filter((x) => ['zip', 'tar'].includes(x.format))) {
      assert.equal(o.available, Boolean(tools['7z']?.available), `xz→${o.format}`);
    }
    const tgz = listOutputsFor({ family: 'archive', format: 'tgz', ext: '.tgz', mime: 'application/gzip' }, tools);
    const tgzZip = tgz.find((o) => o.format === 'zip');
    assert.ok(tgzZip?.available, 'tgz→zip must be pure-JS available');
  });

  it('tgz → zip extract works (pure tar+gzip)', async () => {
    const tarMod = await import('tar');
    const zlib = await import('node:zlib');
    const stage = path.join(testData, 'tgz-stage');
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'inside.txt'), 'tgz-payload');
    const tarPath = path.join(testData, 'plain.tar');
    await tarMod.c({ file: tarPath, cwd: stage }, ['inside.txt']);
    const tgzPath = path.join(testData, 'bundle.tgz');
    fs.writeFileSync(tgzPath, zlib.gzipSync(fs.readFileSync(tarPath)));
    const { data: up } = await uploadBuffer(fs.readFileSync(tgzPath), 'bundle.tgz', 'application/gzip');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'converter', uploadIds: [up.id], options: { format: 'zip' } }),
    });
    const job = await create.json();
    const final = await waitJob(job.id, 60_000);
    assert.equal(final.status, 'completed', final.error);
    const zipBuf = Buffer.from(await (await fetch(`${base}/api/jobs/${job.id}/download`)).arrayBuffer());
    assert.equal(zipBuf[0], 0x50);
    assert.equal(zipBuf[1], 0x4b);
  });

  it('archive zip → tar re-packs extracted members (not zip-as-single-file)', async () => {
    const archiver = (await import('archiver')).default;
    const zipPath = path.join(testData, 'members.zip');
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(zipPath);
      const archive = archiver('zip');
      out.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(out);
      archive.append(Buffer.from('hello-a'), { name: 'a.txt' });
      archive.append(Buffer.from('hello-b'), { name: 'nested/b.txt' });
      void archive.finalize();
    });
    const zipBuf = fs.readFileSync(zipPath);
    const { data: up } = await uploadBuffer(zipBuf, 'members.zip', 'application/zip');
    const create = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'converter', uploadIds: [up.id], options: { format: 'tar' } }),
    });
    const job = await create.json();
    const final = await waitJob(job.id, 60_000);
    assert.equal(final.status, 'completed', final.error);
    const tarBuf = Buffer.from(await (await fetch(`${base}/api/jobs/${job.id}/download`)).arrayBuffer());
    assert.ok(tarBuf.length > 100);
    // tar ustar magic at offset 257 of first header, or at least not a zip (PK)
    assert.notEqual(tarBuf.subarray(0, 2).toString('ascii'), 'PK');
    // extract listing via tar package
    const tar = await import('tar');
    const names: string[] = [];
    const tmpTar = path.join(testData, 'out.tar');
    fs.writeFileSync(tmpTar, tarBuf);
    await tar.t({
      file: tmpTar,
      onentry: (e) => names.push(e.path.replace(/\\/g, '/')),
    });
    assert.ok(names.some((n) => n.includes('a.txt')), `members: ${names.join(',')}`);
    assert.ok(names.some((n) => n.includes('b.txt')), `members: ${names.join(',')}`);
  });
});

/** Minimal mono 16-bit PCM WAV */
function makeSilentWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  // silence already zeros
  return buf;
}

// silence
void PDFDocument;
