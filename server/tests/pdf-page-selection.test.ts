/**
 * Unit tests for shared page-selection parser (shipped helper).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePageSelection,
  parsePages,
  formatPageRangeLabel,
} from '../src/pdf/page-selection.js';

describe('parsePageSelection', () => {
  it('parses single page one-based → zero-based', () => {
    assert.deepEqual(parsePageSelection('1', 5), [0]);
    assert.deepEqual(parsePageSelection('5', 5), [4]);
  });

  it('parses comma lists', () => {
    assert.deepEqual(parsePageSelection('1,3,5', 5), [0, 2, 4]);
  });

  it('parses closed ranges', () => {
    assert.deepEqual(parsePageSelection('1-3', 5), [0, 1, 2]);
  });

  it('parses open ranges 1- and -5', () => {
    assert.deepEqual(parsePageSelection('1-', 4), [0, 1, 2, 3]);
    assert.deepEqual(parsePageSelection('-5', 10), [0, 1, 2, 3, 4]);
    assert.deepEqual(parsePageSelection('2-', 4), [1, 2, 3]);
  });

  it('parses all, odd, even, last', () => {
    assert.deepEqual(parsePageSelection('all', 4), [0, 1, 2, 3]);
    assert.deepEqual(parsePageSelection('odd', 5), [0, 2, 4]);
    assert.deepEqual(parsePageSelection('even', 5), [1, 3]);
    assert.deepEqual(parsePageSelection('last', 5), [4]);
  });

  it('parses combinations like 1-3,7,10-', () => {
    assert.deepEqual(parsePageSelection('1-3,7,10-', 12), [0, 1, 2, 6, 9, 10, 11]);
  });

  it('dedupes while preserving first-seen order', () => {
    assert.deepEqual(parsePageSelection('3,1,3,2', 5), [2, 0, 1]);
  });

  it('preserves intentional duplicates when dedupe=false', () => {
    assert.deepEqual(
      parsePageSelection('1,1,2', 5, { dedupe: false }),
      [0, 0, 1],
    );
  });

  it('empty means all by default', () => {
    assert.deepEqual(parsePageSelection('', 3), [0, 1, 2]);
    assert.deepEqual(parsePageSelection(null, 2), [0, 1]);
  });

  it('throws PAGE_OUT_OF_RANGE for pages beyond document', () => {
    assert.throws(
      () => parsePageSelection('9', 5),
      (e: { code?: string }) => e.code === 'PAGE_OUT_OF_RANGE',
    );
    assert.throws(
      () => parsePageSelection('1-10', 5),
      (e: { code?: string }) => e.code === 'PAGE_OUT_OF_RANGE',
    );
  });

  it('throws PAGE_RANGE_INVALID for bad syntax', () => {
    assert.throws(
      () => parsePageSelection('abc', 5),
      (e: { code?: string }) => e.code === 'PAGE_RANGE_INVALID',
    );
    assert.throws(
      () => parsePageSelection('1-2-3', 5),
      (e: { code?: string }) => e.code === 'PAGE_RANGE_INVALID',
    );
    assert.throws(
      () => parsePageSelection('-', 5),
      (e: { code?: string }) => e.code === 'PAGE_RANGE_INVALID',
    );
  });

  it('parsePages alias works', () => {
    assert.deepEqual(parsePages('1-3', 5), [0, 1, 2]);
  });

  it('formatPageRangeLabel collapses runs', () => {
    assert.equal(formatPageRangeLabel([0, 1, 2, 4]), '1-3_5');
  });
});
