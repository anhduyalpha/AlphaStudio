import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Archive tree + Text diff structural (RQ5/RQ6)', () => {
  it('ArchiveView hosts ArchiveTree browser', () => {
    const src = read('src/views/ArchiveView.jsx');
    assert.match(src, /ArchiveTree/);
    assert.match(src, /archive-workspace/);
    const tree = read('src/components/archive/ArchiveTree.jsx');
    assert.match(tree, /archive-tree-browser/);
    assert.match(tree, /archive-tree-search/);
  });

  it('TextView hosts DiffView and editor export', () => {
    const src = read('src/views/TextView.jsx');
    assert.match(src, /DiffView/);
    assert.match(src, /text-editor-actions/);
    assert.match(src, /downloadText/);
    assert.match(src, /copyText/);
    const diff = read('src/components/text/DiffView.jsx');
    assert.match(diff, /text-diff-view/);
  });
});
