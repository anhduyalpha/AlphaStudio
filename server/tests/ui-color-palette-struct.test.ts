import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Color palette structural (RQ4)', () => {
  it('ColorView uses real extraction and export actions', () => {
    const src = read('src/views/ColorView.jsx');
    assert.match(src, /extractPaletteFromFile/);
    assert.match(src, /color-export-actions/);
    assert.match(src, /paletteToCssVars|Copy CSS/);
    assert.match(src, /paletteToJson|palette\.json/);
    assert.match(src, /paletteToSvg/);
    assert.match(src, /contrastGrade|AA body/);
    assert.doesNotMatch(src, /notify\(`\$\{mode\} updated`\)/);
  });

  it('colorPalette lib exposes extract and export helpers', () => {
    const lib = read('src/lib/colorPalette.js');
    assert.match(lib, /export function extractPaletteFromImageData/);
    assert.match(lib, /export async function extractPaletteFromFile/);
    assert.match(lib, /export function paletteToSvg/);
  });
});
