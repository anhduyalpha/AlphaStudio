import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCropJobOptions,
  clampCropRect,
  defaultCropRect,
} from '../../src/lib/imageCrop.js';

describe('image crop helpers', () => {
  it('default crop is centered half size not top-left origin only', () => {
    const r = defaultCropRect({ naturalWidth: 1000, naturalHeight: 800 });
    assert.equal(r.width, 500);
    assert.equal(r.height, 400);
    assert.equal(r.left, 250);
    assert.equal(r.top, 200);
  });

  it('clamps crop inside bounds', () => {
    const r = clampCropRect({ left: 900, top: 700, width: 200, height: 200 }, {
      naturalWidth: 1000,
      naturalHeight: 800,
    });
    assert.equal(r.width, 200);
    assert.equal(r.height, 200);
    assert.equal(r.left, 800);
    assert.equal(r.top, 600);
  });

  it('buildCropJobOptions sends left/top for crop', () => {
    const opts = buildCropJobOptions({
      operation: 'crop',
      format: 'png',
      quality: 80,
      crop: { left: 10, top: 20, width: 100, height: 120 },
    });
    assert.equal(opts.left, 10);
    assert.equal(opts.top, 20);
    assert.equal(opts.width, 100);
    assert.equal(opts.height, 120);
    assert.notEqual(opts.left, 0);
  });
});
