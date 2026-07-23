import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaJobOptions,
  showsFormatControl,
  showsQualityControl,
} from '../../src/lib/mediaJobOptions.js';

describe('mediaJobOptions honesty', () => {
  it('trim omits format by default (stream-copy)', () => {
    const opts = buildMediaJobOptions({
      operation: 'trim',
      family: 'audio',
      format: 'mp3',
      quality: 'high',
      start: 1,
      duration: 2,
      reencodeOnTrim: false,
    });
    assert.equal(opts.operation, 'trim');
    assert.equal(opts.start, '1');
    assert.equal(opts.duration, '2');
    assert.equal(opts.format, undefined);
    assert.equal(opts.forceReencode, undefined);
    assert.equal(showsFormatControl('trim', { reencodeOnTrim: false }), false);
  });

  it('trim with re-encode includes format and force flags', () => {
    const opts = buildMediaJobOptions({
      operation: 'trim',
      format: 'wav',
      quality: 'balanced',
      start: 0,
      duration: 5,
      reencodeOnTrim: true,
    });
    assert.equal(opts.format, 'wav');
    assert.equal(opts.forceReencode, true);
    assert.equal(opts.reencode, true);
    assert.equal(showsFormatControl('trim', { reencodeOnTrim: true }), true);
    assert.equal(showsQualityControl('trim', { reencodeOnTrim: true }), true);
  });

  it('normalize includes targetLoudness and format', () => {
    const opts = buildMediaJobOptions({
      operation: 'normalize',
      format: 'mp3',
      quality: 'high',
      targetLoudness: '-14',
    });
    assert.equal(opts.targetLoudness, '-14');
    assert.equal(opts.format, 'mp3');
    assert.equal(opts.quality, 'high');
  });

  it('inspect has no format', () => {
    const opts = buildMediaJobOptions({ operation: 'inspect', format: 'mp4' });
    assert.deepEqual(opts, { operation: 'inspect' });
    assert.equal(showsFormatControl('inspect'), false);
  });
});
