import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function read(...parts: string[]) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

describe('converter C0 matrix freeze', () => {
  it('ships FORMAT_ENGINE_MATRIX with honesty rules and engines', () => {
    const matrix = read('docs/converter/FORMAT_ENGINE_MATRIX.md');
    assert.match(matrix, /FORMAT_ENGINE_MATRIX|Format ↔ Engine Matrix/);
    assert.match(matrix, /alphastudio|ffmpeg|pandoc|libreoffice|calibre/);
    assert.match(matrix, /unsupported/i);
    assert.match(matrix, /capability/i);
    assert.match(matrix, /No tool install\/download during conversion jobs/);
    assert.match(matrix, /never PDF input|never LO PDF/i);
  });

  it('ships converter completion state with phases C0–C8', () => {
    const state = JSON.parse(read('.converter-complete-state.json'));
    assert.equal(state.branch, 'ux-ui-redesign');
    assert.equal(state.base, 'main');
    assert.ok(state.phases.C0);
    assert.ok(state.phases.C8);
    assert.match(String(state.matrixDoc), /FORMAT_ENGINE_MATRIX/);
  });

  it('ships converter fixtures inventory and samples', () => {
    const readme = read('fixtures/converter/README.md');
    assert.match(readme, /sample\.png/);
    assert.match(readme, /sample\.json/);
    for (const name of [
      'sample.txt',
      'sample.md',
      'sample.html',
      'sample.csv',
      'sample.tsv',
      'sample.json',
      'sample.png',
      'sample.jpg',
    ]) {
      const p = path.join(root, 'fixtures', 'converter', name);
      assert.ok(fs.existsSync(p), `missing fixture ${name}`);
      assert.ok(fs.statSync(p).size > 0, `empty fixture ${name}`);
    }
  });
});
