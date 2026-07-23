import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, diffWords, editorStats, summarizeDiff } from '../../src/lib/textDiff.js';

describe('textDiff', () => {
  it('detects added and removed lines', () => {
    const hunks = diffLines('a\nb\nc', 'a\nx\nc');
    const summary = summarizeDiff(hunks);
    assert.equal(summary.identical, false);
    assert.ok(summary.removed >= 1);
    assert.ok(summary.added >= 1);
    assert.ok(hunks.some((h) => h.type === 'equal' && h.text === 'a'));
  });

  it('word diff marks changed tokens', () => {
    const tokens = diffWords('hello world', 'hello there');
    assert.ok(tokens.some((t) => t.type === 'remove' && t.text.includes('world')));
    assert.ok(tokens.some((t) => t.type === 'add' && t.text.includes('there')));
  });

  it('editor stats count words and lines', () => {
    const s = editorStats('one two\nthree');
    assert.equal(s.words, 3);
    assert.equal(s.lines, 2);
  });
});
