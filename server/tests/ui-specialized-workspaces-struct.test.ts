import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Specialized purpose-built workspaces structural', () => {
  it('archive is dedicated create/extract/inspect workspace', () => {
    const src = read('src/views/ArchiveView.jsx');
    assert.doesNotMatch(src, /ModularWorkspaceView/);
    assert.match(src, /archive-workspace/);
    assert.match(src, /WorkbenchLayout/);
    assert.match(src, /SegmentedControl/);
    assert.match(src, /archive-tree|Archive entries|Contents tree/);
    assert.match(src, /run\('archive'/);
  });

  it('text is dedicated workspace with client modes and OCR blocked honestly', () => {
    const src = read('src/views/TextView.jsx');
    assert.doesNotMatch(src, /ModularWorkspaceView/);
    assert.match(src, /text-workspace/);
    assert.match(src, /WorkbenchLayout/);
    assert.match(src, /SegmentedControl/);
    assert.match(src, /OCR/);
    assert.match(src, /clientOnly|Run in browser/);
    assert.match(src, /run\('text'/);
  });

  it('color is interactive studio not modular wrapper', () => {
    const src = read('src/views/ColorView.jsx');
    assert.doesNotMatch(src, /ModularWorkspaceView/);
    assert.match(src, /color-workspace/);
    assert.match(src, /WorkbenchLayout/);
    assert.match(src, /contrastRatio|paletteFrom|type="color"/);
  });

  it('security is dedicated inspector without preserve-metadata preset as primary UX', () => {
    const src = read('src/views/SecurityView.jsx');
    assert.doesNotMatch(src, /ModularWorkspaceView/);
    assert.match(src, /security-workspace/);
    assert.match(src, /WorkbenchLayout/);
    assert.match(src, /SegmentedControl/);
    assert.match(src, /operation:\s*mode/);
    assert.doesNotMatch(src, /preserveMetadata:\s*true/);
  });

  it('App routes specialized tools to dedicated views not ModularWorkspaceView', () => {
    const app = read('src/App.jsx');
    assert.match(app, /archive:\s*ArchiveView/);
    assert.match(app, /text:\s*TextView/);
    assert.match(app, /color:\s*ColorView/);
    assert.match(app, /security:\s*SecurityView/);
    assert.doesNotMatch(app, /ModularWorkspaceView/);
  });
});
