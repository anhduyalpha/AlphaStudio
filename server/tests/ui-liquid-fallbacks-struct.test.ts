import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Liquid motion fallbacks (RQ11)', () => {
  it('CSS includes reduced-motion, reduced-transparency, supports, and low-power', () => {
    const css = read('src/styles.css');
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /prefers-reduced-transparency:\s*reduce/);
    assert.match(css, /@supports not \(\(backdrop-filter/);
    assert.match(css, /html\[data-power="low"\]/);
  });

  it('motion hook sets data-motion and optional data-power', () => {
    const hook = read('src/hooks/useMotionPreference.js');
    assert.match(hook, /dataset\.motion/);
    assert.match(hook, /dataset\.power|data-power|getBattery|saveData/);
  });
});
