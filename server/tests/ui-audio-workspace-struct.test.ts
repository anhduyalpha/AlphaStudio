import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Audio purpose-built workspace structural', () => {
  const audio = read('src/views/AudioView.jsx');

  it('is not a ModularWorkspaceView wrapper', () => {
    assert.doesNotMatch(audio, /ModularWorkspaceView/);
    assert.match(audio, /audio-workspace/);
    assert.match(audio, /WorkspaceHeader/);
    assert.match(audio, /WorkbenchLayout/);
  });

  it('includes player, waveform, timeline range, and mode segments', () => {
    assert.match(audio, /<audio/);
    assert.match(audio, /WaveformStrip/);
    assert.match(audio, /TimelineRange/);
    assert.match(audio, /SegmentedControl/);
    assert.match(audio, /normalize/);
    assert.match(audio, /trim/);
  });

  it('maps jobs to media processor with family audio', () => {
    assert.match(audio, /run\('media'/);
    assert.match(audio, /family:\s*'audio'/);
  });
});
