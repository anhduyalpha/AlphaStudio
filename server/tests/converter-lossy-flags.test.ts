import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listOutputsFor } from '../src/convert/matrix.js';

describe('converter output honesty flags', () => {
  it('marks PDF→TXT as lossy when listed', () => {
    const outs = listOutputsFor({ family: 'pdf', format: 'pdf', ext: 'pdf', mime: 'application/pdf' });
    const txt = outs.find((o) => o.format === 'txt');
    assert.ok(txt, 'pdf→txt should appear in matrix');
    assert.equal(txt.lossy, true);
  });

  it('marks HEIC routes experimental when listed', () => {
    const outs = listOutputsFor({ family: 'image', format: 'heic', ext: 'heic', mime: 'image/heic' });
    const png = outs.find((o) => o.format === 'png');
    if (png) {
      assert.equal(png.experimental, true);
    }
  });

  it('does not mark png→webp as lossy by default', () => {
    const outs = listOutputsFor({ family: 'image', format: 'png', ext: 'png', mime: 'image/png' });
    const webp = outs.find((o) => o.format === 'webp');
    assert.ok(webp);
    assert.notEqual(webp.lossy, true);
  });
});
