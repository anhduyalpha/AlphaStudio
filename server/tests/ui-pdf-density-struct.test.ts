import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('PDF contextual control density (RQ8)', () => {
  it('gates form fields by opMeta flags not always-on controls', () => {
    const src = read('src/views/PdfView.jsx');
    assert.match(src, /opMeta\.needsAngle/);
    assert.match(src, /opMeta\.needsFormat/);
    assert.match(src, /opMeta\.needsDpi/);
    assert.match(src, /opMeta\.needsQuality/);
    assert.match(src, /opMeta\.needsSplitMode/);
    assert.match(src, /opMeta\.needsPageMode/);
    assert.match(src, /showPagesField/);
    // Angle control is not unconditional
    assert.doesNotMatch(src, /\{true \? \(\s*<SelectField label="Rotate angle"/);
  });
});
