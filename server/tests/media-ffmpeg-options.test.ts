/**
 * S-04: ffmpeg time / loudness option allowlists (shipped parsers).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFfmpegTime, parseTargetLoudness } from '../src/processors/media.js';

describe('parseFfmpegTime', () => {
  it('accepts non-negative seconds and HH:MM:SS forms', () => {
    assert.equal(parseFfmpegTime(0), '0');
    assert.equal(parseFfmpegTime('12.5'), '12.5');
    assert.equal(parseFfmpegTime('00:01:02.5'), '00:01:02.5');
    assert.equal(parseFfmpegTime('01:02'), '01:02');
    assert.equal(parseFfmpegTime(90), '90');
  });

  it('rejects injection and malformed values', () => {
    assert.throws(() => parseFfmpegTime(';rm -rf /'), /Invalid/);
    assert.throws(() => parseFfmpegTime('0;loudnorm'), /Invalid/);
    assert.throws(() => parseFfmpegTime('file:///etc/passwd'), /Invalid/);
    assert.throws(() => parseFfmpegTime('1,2'), /Invalid/);
    assert.throws(() => parseFfmpegTime(-1), /Invalid/);
    assert.throws(() => parseFfmpegTime('abc'), /Invalid/);
    assert.throws(() => parseFfmpegTime('99:99:99'), /Invalid/);
  });
});

describe('parseTargetLoudness', () => {
  it('defaults and accepts closed LUFS range', () => {
    assert.equal(parseTargetLoudness(undefined), -16);
    assert.equal(parseTargetLoudness(-16), -16);
    assert.equal(parseTargetLoudness('-23'), -23);
    assert.equal(parseTargetLoudness(-70), -70);
    assert.equal(parseTargetLoudness(-5), -5);
  });

  it('rejects out-of-range and non-numeric', () => {
    assert.throws(() => parseTargetLoudness(-71), /targetLoudness/);
    assert.throws(() => parseTargetLoudness(-4), /targetLoudness/);
    assert.throws(() => parseTargetLoudness('nope'), /targetLoudness/);
    assert.throws(() => parseTargetLoudness(Number.NaN), /targetLoudness/);
  });
});
