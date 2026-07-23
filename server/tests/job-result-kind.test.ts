import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyJobResult,
  classifyJsonPayload,
  getJobMediaClass,
} from '../../src/lib/jobResultKind.js';

describe('jobResultKind classifiers', () => {
  it('detects image jobs by mime and extension', () => {
    assert.equal(getJobMediaClass({ outputMime: 'image/png', outputName: 'x.bin' }), 'image');
    assert.equal(getJobMediaClass({ outputMime: 'application/octet-stream', outputName: 'out.webp' }), 'image');
    assert.equal(classifyJobResult({ status: 'completed', downloadUrl: '/d', outputMime: 'image/jpeg' }), 'image');
  });

  it('classifies security and archive JSON payloads', () => {
    assert.equal(
      classifyJsonPayload({ algorithms: { sha256: 'abc' }, filename: 'a' }),
      'hash',
    );
    assert.equal(
      classifyJsonPayload({ algorithm: 'sha256', expected: 'aa', actual: 'bb', match: false }),
      'checksum-compare',
    );
    assert.equal(
      classifyJsonPayload({ password: 'x', length: 16, symbols: true }),
      'password',
    );
    assert.equal(
      classifyJsonPayload({ extension: '.png', detectedMime: 'image/png', magicHex: '89', match: true }),
      'signature',
    );
    assert.equal(
      classifyJsonPayload({ entries: [{ name: 'a/b.txt' }], count: 1, format: 'zip' }),
      'archive-listing',
    );
    assert.equal(
      classifyJsonPayload({ format: { format_name: 'mp3' }, streams: [{ codec_type: 'audio' }] }),
      'media-inspect',
    );
  });

  it('does not classify incomplete jobs as typed media', () => {
    assert.equal(classifyJobResult({ status: 'running', outputMime: 'image/png' }), 'download');
    assert.equal(classifyJobResult(null), 'download');
  });
});
