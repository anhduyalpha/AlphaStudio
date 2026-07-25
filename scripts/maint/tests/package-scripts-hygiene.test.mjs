/**
 * Regression guards for package.json script honesty and clean-clone fixtures.
 * Drives the real root package.json and the tracked fixtures tree.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canResolveTsxPackage, resolveTsxCli } from '../lib/tsx-resolve.mjs';

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

  it('resolves tsx after npm ci (root hoist preferred over server/node_modules only)', () => {
    const cli = resolveTsxCli(repoRoot);
    const pkgOk = canResolveTsxPackage(repoRoot);
    assert.ok(pkgOk || cli, 'tsx must resolve after workspaces install');
    // Workspaces typically hoist to root; never require nested-only path
    if (cli) {
      assert.ok(
        cli.includes(`${path.sep}node_modules${path.sep}tsx${path.sep}`),
        `unexpected tsx path: ${cli}`,
      );
    }
    // reset.mjs must not hardcode server-only tsx
    const resetSrc = fs.readFileSync(path.join(repoRoot, 'scripts', 'maint', 'reset.mjs'), 'utf8');
    assert.match(resetSrc, /canResolveTsxPackage|resolveTsxCli|--import',\s*'tsx'/);
    assert.ok(
      !resetSrc.includes("path.join(projectRoot, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs')") ||
        resetSrc.includes('resolveTsxCli'),
      'reset must use shared tsx resolver, not server-only path alone',
    );
  });

  it('init-db.mjs performs full initDb (not dirs-only) when tsx or dist available', () => {
    const scratchDbDir = path.join(repoRoot, 'tmp', `hygiene-init-db-${process.pid}`);
    fs.rmSync(scratchDbDir, { recursive: true, force: true });
    fs.mkdirSync(scratchDbDir, { recursive: true });
    const dbPath = path.join(scratchDbDir, 't.db');
    const initScript = path.join(repoRoot, 'scripts', 'maint', 'init-db.mjs');
    assert.ok(fs.existsSync(initScript));

    const args = canResolveTsxPackage(repoRoot) || resolveTsxCli(repoRoot)
      ? ['--import', 'tsx', initScript]
      : [initScript];

    const r = spawnSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        DB_PATH: dbPath,
        DATA_DIR: scratchDbDir,
        LOG_LEVEL: 'error',
      },
    });
    assert.equal(r.status, 0, `init-db failed: ${r.stderr || r.stdout}`);
    assert.match(String(r.stdout || ''), /\[init-db\] ok/);
    assert.ok(fs.existsSync(dbPath), 'DB file must exist after init-db');
    assert.ok(fs.statSync(dbPath).size > 0, 'DB must be non-empty');
    fs.rmSync(scratchDbDir, { recursive: true, force: true });
  });

  it('bench-startup default fixtures prefer fixtures/samples', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'maint', 'bench-startup.mjs'), 'utf8');
    // path.join(projectRoot, 'fixtures', 'samples', ...)
    assert.match(src, /'fixtures',\s*'samples'/);
    assert.ok(
      src.indexOf("'fixtures', 'samples'") < src.indexOf("'audit', 'fixtures'") ||
        !src.includes("'audit', 'fixtures'"),
      'fixtures/samples must be preferred before legacy audit/fixtures',
    );
    assert.ok(fs.existsSync(path.join(repoRoot, 'fixtures', 'samples', 'sample.png')));
  });
});
