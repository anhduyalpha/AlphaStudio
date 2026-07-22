import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(root, 'fixtures', 'pdf');
const manifest = JSON.parse(await readFile(path.join(fixtureDir, 'manifest.json'), 'utf8'));
const requiredKinds = new Set([
  'text',
  'unicode-filename',
  'multi-dot-filename',
  'organizer',
  'large',
  'scanned-image-only',
  'corrupt',
  'encrypted',
]);

assert.equal(manifest.schemaVersion, 1);
for (const fixture of manifest.fixtures) {
  const bytes = await readFile(path.join(fixtureDir, fixture.name));
  assert.equal(bytes.length, fixture.size, `${fixture.name}: size`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256, `${fixture.name}: checksum`);
  requiredKinds.delete(fixture.kind);

  if (fixture.kind === 'corrupt') continue;
  if (fixture.kind === 'encrypted') {
    assert.match(bytes.subarray(0, 8).toString('latin1'), /^%PDF-/);
    await assert.rejects(
      () => PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }),
      /encrypted/i,
    );
    const ignored = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    assert.equal(ignored.getPageCount(), fixture.pages, `${fixture.name}: encrypted page tree`);
    continue;
  }
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  assert.equal(doc.getPageCount(), fixture.pages, `${fixture.name}: page count`);
}

assert.deepEqual([...requiredKinds], [], `missing fixture kinds: ${[...requiredKinds].join(', ')}`);
assert.ok(manifest.fixtures.some((fixture) => fixture.kind === 'encrypted'), 'encrypted fixture is required');

const corrupt = await readFile(path.join(fixtureDir, 'corrupt-truncated.pdf'));
let corruptIsUnusable = false;
try {
  const corruptDoc = await PDFDocument.load(corrupt, { updateMetadata: false });
  corruptIsUnusable = corruptDoc.getPageCount() === 0;
} catch {
  corruptIsUnusable = true;
}
assert.equal(corruptIsUnusable, true, 'corrupt fixture must reject or expose zero usable pages');
console.log(`Verified ${manifest.fixtures.length} PDF fixture records`);
