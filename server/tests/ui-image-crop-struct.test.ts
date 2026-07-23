import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Image crop interactive structural (RQ3)', () => {
  it('ImageView uses CropSelector and does not hardcode left/top 0', () => {
    const image = read('src/views/ImageView.jsx');
    assert.match(image, /CropSelector/);
    assert.match(image, /buildCropJobOptions/);
    assert.doesNotMatch(image, /options\.left\s*=\s*0/);
    assert.doesNotMatch(image, /options\.top\s*=\s*0/);
  });

  it('CropSelector exposes interactive handles', () => {
    const crop = read('src/components/image/CropSelector.jsx');
    assert.match(crop, /image-crop-selector/);
    assert.match(crop, /crop-handle/);
    assert.match(crop, /clientToNatural/);
  });
});
