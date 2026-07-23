import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildArchiveTree, countTreeNodes, filterArchiveTree } from '../../src/lib/archiveTree.js';

describe('archiveTree', () => {
  it('builds nested folders from paths', () => {
    const root = buildArchiveTree([
      'src/a.js',
      'src/lib/b.js',
      { name: 'docs/readme.md', size: 12 },
      'root.txt',
    ]);
    assert.equal(root.children.some((c) => c.name === 'src' && c.isDir), true);
    const src = root.children.find((c) => c.name === 'src');
    assert.ok(src.children.some((c) => c.name === 'lib' && c.isDir));
    assert.ok(root.children.some((c) => c.name === 'root.txt' && !c.isDir));
    assert.ok(countTreeNodes(root) >= 5);
  });

  it('filters by path query', () => {
    const root = buildArchiveTree(['src/a.js', 'docs/x.md', 'src/lib/b.js']);
    const f = filterArchiveTree(root, 'lib');
    const flat = JSON.stringify(f);
    assert.match(flat, /b\.js/);
    assert.doesNotMatch(flat, /x\.md/);
  });
});
