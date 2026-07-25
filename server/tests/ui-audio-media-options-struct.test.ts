import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Audio/Media option honesty structural (RQ2)', () => {
  it('AudioView gates format on trim and exposes normalize target', () => {
    const audio = read('src/views/AudioView.jsx');
    assert.match(audio, /buildMediaJobOptions/);
    assert.match(audio, /audio-trim-copy-note/);
    assert.match(audio, /reencodeOnTrim/);
    assert.match(audio, /targetLoudness/);
    assert.match(audio, /Sample rate/);
    assert.match(audio, /Channels/);
  });

  it('MediaView gates format on trim and uses mediaJobOptions', () => {
    const media = read('src/views/MediaView.jsx');
    assert.match(media, /buildMediaJobOptions/);
    assert.match(media, /media-trim-copy-note/);
    assert.match(media, /reencodeOnTrim/);
    assert.doesNotMatch(media, /operation === 'trim'\) \? \(\s*<div className="form-grid">\s*<SelectField label="Output format"/);
  });

  it('media processor supports re-encode on trim', () => {
    const proc = read('server/src/processors/media.ts');
    assert.match(proc, /forceReencode/);
    assert.match(proc, /Trimmed \(re-encoded\)/);
  });
});
