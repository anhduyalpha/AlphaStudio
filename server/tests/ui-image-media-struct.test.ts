import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Image canvas workspace structural', () => {
  const image = read('src/views/ImageView.jsx');

  it('is purpose-built canvas workbench with compare slider', () => {
    assert.doesNotMatch(image, /ModularWorkspaceView/);
    assert.match(image, /image-canvas-workspace/);
    assert.match(image, /WorkspaceHeader/);
    assert.match(image, /WorkbenchLayout/);
    assert.match(image, /CompareSlider/);
    assert.match(image, /SegmentedControl/);
    assert.match(image, /run\('image'/);
  });
});

describe('Media timeline workspace structural', () => {
  const media = read('src/views/MediaView.jsx');

  it('is purpose-built timeline workbench with player and range', () => {
    assert.doesNotMatch(media, /ModularWorkspaceView/);
    assert.match(media, /media-timeline-workspace/);
    assert.match(media, /WorkbenchLayout/);
    assert.match(media, /TimelineRange/);
    assert.match(media, /SegmentedControl/);
    assert.match(media, /CapabilityBanner/);
    assert.match(media, /onLoadedMetadata/);
    assert.match(media, /run\('media'/);
  });
});
