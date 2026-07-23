import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Studio primitives structural (corrective C1)', () => {
  const prim = read('src/components/StudioPrimitives.jsx');
  const styles = read('src/styles.css');

  it('exports SegmentedControl, TimelineRange, WaveformStrip, FileRow, CompareSlider', () => {
    assert.match(prim, /export function SegmentedControl/);
    assert.match(prim, /export function TimelineRange/);
    assert.match(prim, /export function WaveformStrip/);
    assert.match(prim, /export function FileRow/);
    assert.match(prim, /export function CompareSlider/);
  });

  it('WaveformStrip uses Web Audio decode with static fallback', () => {
    assert.match(prim, /AudioContext|webkitAudioContext/);
    assert.match(prim, /decodeAudioData/);
    assert.match(prim, /fallback/);
  });

  it('CSS ships segmented, timeline-range, waveform-strip, compare-slider', () => {
    assert.match(styles, /\.segmented-control/);
    assert.match(styles, /\.timeline-range/);
    assert.match(styles, /\.waveform-strip/);
    assert.match(styles, /\.compare-slider/);
    assert.match(styles, /\.studio-file-row/);
  });
});
