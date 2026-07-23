import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contrastGrade,
  contrastRatio,
  extractPaletteFromImageData,
  hexToRgb,
  paletteFromHex,
  paletteToCssVars,
  paletteToJson,
  paletteToSvg,
  rgbToHex,
} from '../../src/lib/colorPalette.js';

describe('colorPalette helpers', () => {
  it('round-trips hex/rgb and grades contrast', () => {
    assert.deepEqual(hexToRgb('#ff0000'), { r: 255, g: 0, b: 0 });
    assert.equal(rgbToHex(255, 0, 0), '#ff0000');
    const ratio = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    assert.ok(ratio > 20);
    const g = contrastGrade(ratio);
    assert.equal(g.aaBody, true);
    assert.equal(g.aaaBody, true);
  });

  it('extracts dominant color from solid ImageData', () => {
    // 2x2 pure blue pixels
    const data = new Uint8ClampedArray([
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]);
    const colors = extractPaletteFromImageData({ data, width: 2, height: 2 }, { maxColors: 3, sampleStep: 1 });
    assert.ok(colors.length >= 1);
    assert.match(colors[0], /^#[0-9a-f]{6}$/i);
    // quantized blue should be near blue
    const rgb = hexToRgb(colors[0]);
    assert.ok(rgb && rgb.b > rgb.r && rgb.b > rgb.g);
  });

  it('exports css/json/svg payloads', () => {
    const colors = paletteFromHex('#9b7cff', 3);
    assert.equal(colors.length, 3);
    const css = paletteToCssVars(colors);
    assert.match(css, /--swatch-1:/);
    const json = JSON.parse(paletteToJson(colors, { source: 'test' }));
    assert.deepEqual(json.colors, colors);
    assert.match(paletteToSvg(colors), /<svg/);
  });
});
