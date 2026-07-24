/**
 * Windows 7z l -slt often lists the archive absolute path as Path= — must not
 * be treated as an extractable member (archive extract P1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse7zEntries, assertSafe7zEntry } from '../src/processors/archive.js';

describe('parse7zEntries container filter', () => {
  it('drops absolute Windows archive path, keeps members', () => {
    const listing = [
      'Path = C:\\Users\\Duy\\AppData\\Local\\Temp\\sample.7z',
      'Size = 0',
      '',
      'Path = hello.txt',
      'Size = 5',
      '',
      'Path = nested\\file.bin',
      'Size = 10',
      '',
    ].join('\n');
    const entries = parse7zEntries(listing);
    assert.ok(!entries.some((e) => /sample\.7z/i.test(e.path)));
    assert.ok(entries.some((e) => e.path === 'hello.txt' || e.path.replace(/\\/g, '/') === 'hello.txt'));
    for (const e of entries) {
      assert.doesNotThrow(() => assertSafe7zEntry(e.path));
    }
  });

  it('drops basename-only first archive container', () => {
    const listing = ['Path = pack.7z', 'Size = 0', '', 'Path = a.txt', 'Size = 1', ''].join('\n');
    const entries = parse7zEntries(listing);
    assert.deepEqual(
      entries.map((e) => e.path),
      ['a.txt'],
    );
  });

  it('keeps nested member named like an archive', () => {
    const listing = [
      'Path = outer.7z',
      'Size = 0',
      '',
      'Path = folder/nested.7z',
      'Size = 99',
      '',
    ].join('\n');
    const entries = parse7zEntries(listing);
    assert.ok(entries.some((e) => e.path.replace(/\\/g, '/') === 'folder/nested.7z'));
  });
});
