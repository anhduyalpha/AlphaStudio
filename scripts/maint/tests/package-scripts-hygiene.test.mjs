/**
 * Regression guards for package.json script honesty and clean-clone fixtures.
 * Drives the real root package.json and the tracked fixtures tree.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function listScriptPathRefs(scriptValue) {
  const refs = [];
  const re = /(?:^|[\s"'])((?:scripts|server|fixtures|e2e|python)\/[A-Za-z0-9_./@+${}-]+)/g;
  let m;
  while ((m = re.exec(scriptValue)) !== null) {
    let p = m[1];
    // strip trailing globs / wildcards for existence checks of parent
    p = p.replace(/\*.*$/, '');
    p = p.replace(/\/$/, '');
    if (p) refs.push(p);
  }
  return refs;
}

describe('package.json script hygiene', () => {
  it('every scripts/* path referenced by npm scripts exists (or its parent for globs)', () => {
    const pkgPath = path.join(repoRoot, 'package.json');
    assert.ok(fs.existsSync(pkgPath));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.ok(pkg.scripts && typeof pkg.scripts === 'object');

    const missing = [];
    for (const [name, value] of Object.entries(pkg.scripts)) {
      if (typeof value !== 'string') continue;
      for (const ref of listScriptPathRefs(value)) {
        const abs = path.join(repoRoot, ref);
        if (fs.existsSync(abs)) continue;
        // For "scripts/maint/tests/" style after stripping *
        if (fs.existsSync(path.dirname(abs))) continue;
        missing.push(`${name} -> ${ref}`);
      }
    }
    assert.deepEqual(missing, [], `missing script targets:\n${missing.join('\n')}`);
  });

  it('does not advertise removed audit scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['test:audit'], undefined);
    assert.equal(pkg.scripts['audit:backend'], undefined);
    assert.equal(fs.existsSync(path.join(repoRoot, 'scripts', 'audit')), false);
  });

  it('tracks clean-clone sample fixtures under fixtures/samples', () => {
    const dir = path.join(repoRoot, 'fixtures', 'samples');
    assert.ok(fs.existsSync(dir), 'fixtures/samples must be committed for clean clone');
    for (const name of ['sample.png', 'sample.pdf', 'sample.txt', 'sample.wav', 'sample.jpg']) {
      const p = path.join(dir, name);
      assert.ok(fs.existsSync(p), `missing tracked fixture ${name}`);
      assert.ok(fs.statSync(p).size > 0, `${name} must be non-empty`);
    }
  });

  it('gitignore ignores audit/ outputs but not fixtures/samples', () => {
    const gi = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    assert.match(gi, /^audit\/$/m);
    assert.ok(!/^fixtures\/$/m.test(gi));
    assert.ok(!/fixtures\/samples/.test(gi));
  });
});
