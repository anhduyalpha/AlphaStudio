import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileTypeFromBuffer } from '../src/lib/magic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const readServer = (relative: string) => fs.readFileSync(path.join(serverRoot, relative), 'utf8');

describe('release regressions: worker dispatch', () => {
  it('never dispatches a queued job to a worker already draining for pool resize', () => {
    const source = readServer('src/workers/jobs.ts');
    assert.match(source, /!slot\.active && !slot\.intentionalStop/);
    assert.match(source, /slot\.intentionalStop = true;\s*[\s\S]*?slot\.ready = false/);
    assert.match(source, /!slot\.ready \|\| slot\.active \|\| slot\.intentionalStop/);
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
    const pkg = JSON.parse(readServer('package.json')) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies['file-type'], undefined);
  });
});
