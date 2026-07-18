import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileTypeFromBuffer } from '../src/lib/magic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('release regressions: hosted API and manual results', () => {
  it('uses same-origin API by default instead of browser localhost', () => {
    const client = read('src/api/client.js');
    assert.match(client, /VITE_API_URL\s*\|\|\s*['"]['"]/);
    assert.doesNotMatch(client, /API_BASE\s*=.*127\.0\.0\.1:8787/);
    assert.match(client, /fetchJobBlob/);
    assert.match(client, /downloadPath/);
  });

  it('never dispatches a queued job to a worker already draining for pool resize', () => {
    const source = read('server/src/workers/jobs.ts');
    assert.match(source, /!slot\.active && !slot\.intentionalStop/);
    assert.match(source, /slot\.intentionalStop = true;\s*[\s\S]*?slot\.ready = false/);
    assert.match(source, /!slot\.ready \|\| slot\.active \|\| slot\.intentionalStop/);
  });

  it('keeps job outputs in the UI until the user downloads them', () => {
    const runner = read('src/hooks/useJobRunner.js');
    assert.match(runner, /autoDownload\s*=\s*false/);

    for (const view of [
      'src/views/ModularWorkspaceView.jsx',
      'src/views/ImageView.jsx',
      'src/views/MediaView.jsx',
      'src/views/PdfView.jsx',
    ]) {
      const source = read(view);
      assert.match(source, /JobOutputCard/);
      assert.doesNotMatch(source, /autoDownload:\s*true/);
    }
  });

  it('QR uses authenticated API output helpers and stable object URL cleanup', () => {
    const qr = read('src/views/QrView.jsx');
    assert.match(qr, /api\.fetchJobBlob/);
    assert.match(qr, /api\.fetchJobJson/);
    assert.match(qr, /previewUrlRef/);
    assert.doesNotMatch(qr, /fetch\(api\.downloadUrl/);
  });

  it('Converted Files shows active rows and animates real zero-progress waits', () => {
    const converter = read('src/views/ConverterView.jsx');
    const css = read('src/styles.css');
    assert.match(converter, /status:\s*'all'/);
    assert.match(converter, /terminalRefreshPendingRef/);
    assert.doesNotMatch(converter, /setTimeout\s*\(/);
    assert.match(converter, /attachJobsToFiles/);
    assert.match(converter, /is-indeterminate/);
    assert.match(css, /@keyframes progress-indeterminate/);
  });

  it('clears the converting group by the completed job id', () => {
    const source = read('src/views/ConverterView.jsx');
    assert.match(source, /jobGroupKeysRef\.current\.set\(job\.id,\s*group\.id\)/);
    assert.match(source, /jobGroupKeysRef\.current\.get\(terminalJobId\)/);
    assert.match(source, /nextKeys\.delete\(terminalGroupId\)/);
    assert.match(source, /const hasPendingCreateRequest = submitGuard\.current\.size > 0/);
    assert.match(source, /if \(!hasActiveJob && !hasPendingCreateRequest && convertingKeys\.size > 0\)/);
  });
});

describe('bounded built-in magic detection', () => {
  it('detects common signatures without the vulnerable file-type parser', async () => {
    assert.deepEqual(
      await fileTypeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      { ext: 'png', mime: 'image/png' },
    );
    assert.deepEqual(await fileTypeFromBuffer(Buffer.from('%PDF-1.7')), {
      ext: 'pdf',
      mime: 'application/pdf',
    });
    assert.deepEqual(await fileTypeFromBuffer(Buffer.from('RIFF0000WAVEfmt ')), {
      ext: 'wav',
      mime: 'audio/wav',
    });
  });

  it('has no file-type runtime dependency', () => {
    const pkg = JSON.parse(read('server/package.json')) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies['file-type'], undefined);
  });
});
