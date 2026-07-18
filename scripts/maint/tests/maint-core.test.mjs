/**
 * Unit tests for maintenance helpers — drive real shipped modules.
 * Includes spaces and Unicode in path fixtures.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const {
  projectRoot,
  detectPlatform,
  which,
  toolsPlatformDir,
  findNpmCli,
  runNpm,
  npmVersion,
} = await import('../lib/platform.mjs');
const {
  assertUnderRoot,
  isUnderRoot,
  isProtectedPath,
  safeRemove,
  toRelPosix,
} = await import('../lib/paths.mjs');
const {
  resolveClearTargets,
  resolveCleanTargets,
  parseClearArgs,
  formatTargetList,
} = await import('../lib/clear-targets.mjs');
const { hashFile, verifyChecksum, hashString } = await import('../lib/checksum.mjs');
const {
  loadManifest,
  saveManifest,
  upsertTool,
  upsertTools,
  manifestPath,
  isEntryCacheValid,
  writeLegacyConfig,
  legacyConfigPath,
} = await import('../lib/manifest.mjs');
const {
  checkAllTools,
  listToolDefs,
  resolveTool,
  requiredToolNames,
} = await import('../lib/tools-probe.mjs');
const { fileIdentity, matchesIdentity } = await import('../lib/checksum.mjs');
const { featureFlags, detectEnvironment } = await import('../lib/platform.mjs');

// Must NOT live under protected prefixes (src, scripts, …) so safeRemove can delete it
const fixtureRoot = path.join(repoRoot, 'tmp', `_fixture space 测试-${process.pid}`);

before(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
});

after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('platform detect', () => {
  it('detects OS and arch labels', () => {
    const p = detectPlatform();
    assert.ok(['windows', 'linux', 'macos', 'other'].includes(p.os));
    assert.ok(p.platform);
    assert.ok(p.archLabel);
    assert.equal(projectRoot, repoRoot);
  });

  it('toolsPlatformDir includes platform and arch', () => {
    const d = toolsPlatformDir(repoRoot);
    const p = detectPlatform();
    assert.ok(d.includes('.runtime') || d.includes('.tools'), d);
    assert.ok(d.includes(p.platform) || d.includes(p.archLabel), d);
  });

  it('which finds node', () => {
    const n = which('node');
    assert.ok(n, 'node must be on PATH');
    assert.ok(fs.existsSync(n));
  });

  it('runNpm works on this OS (no EINVAL on Windows npm.cmd)', () => {
    const cli = findNpmCli();
    // Prefer npm-cli.js; cmd fallback still allowed on Windows if cli missing
    const r = runNpm(['--version'], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(r.error, undefined, `spawn error: ${r.error?.message}`);
    assert.equal(r.status, 0, `npm --version failed status=${r.status} stderr=${r.stderr}`);
    assert.match(String(r.stdout || npmVersion() || ''), /^\d+\.\d+/);
    if (cli) assert.ok(fs.existsSync(cli));
  });
});

describe('path safety', () => {
  it('assertUnderRoot accepts in-root paths with spaces and Unicode', () => {
    const child = path.join(fixtureRoot, 'nested', 'file.txt');
    fs.mkdirSync(path.dirname(child), { recursive: true });
    fs.writeFileSync(child, 'x');
    // relative from repo root
    const rel = path.relative(repoRoot, child);
    const abs = assertUnderRoot(rel, repoRoot);
    assert.equal(path.resolve(abs), path.resolve(child));
    assert.ok(isUnderRoot(child, repoRoot));
  });

  it('assertUnderRoot rejects paths outside root', () => {
    assert.throws(() => assertUnderRoot('..\\..\\Windows\\System32', repoRoot));
    assert.throws(() => assertUnderRoot('/etc/passwd', repoRoot));
    assert.ok(!isUnderRoot(path.resolve(repoRoot, '..', 'outside'), repoRoot));
  });

  it('isProtectedPath protects source and lockfiles', () => {
    assert.ok(isProtectedPath(path.join(repoRoot, 'src'), repoRoot));
    assert.ok(isProtectedPath(path.join(repoRoot, 'server', 'src', 'index.ts'), repoRoot));
    assert.ok(isProtectedPath(path.join(repoRoot, 'package.json'), repoRoot));
    assert.ok(isProtectedPath(path.join(repoRoot, 'package-lock.json'), repoRoot));
    assert.ok(!isProtectedPath(path.join(repoRoot, 'dist'), repoRoot));
  });

  it('safeRemove refuses outside root and protected paths', () => {
    const outside = path.resolve(repoRoot, '..', `outside-clear-${process.pid}.tmp`);
    const r1 = safeRemove(outside, { root: repoRoot });
    assert.equal(r1.ok, false);

    const srcFile = path.join(repoRoot, 'package.json');
    const r2 = safeRemove(srcFile, { root: repoRoot });
    assert.equal(r2.ok, false);
    assert.ok(r2.skipped === 'protected path' || r2.error);
    assert.ok(fs.existsSync(srcFile), 'package.json must survive');
  });

  it('safeRemove deletes disposable path with space/Unicode under fixture', () => {
    const junk = path.join(fixtureRoot, 'tmp-delete-me');
    fs.mkdirSync(junk, { recursive: true });
    fs.writeFileSync(path.join(junk, 'a.txt'), 'bye');
    const rel = path.relative(repoRoot, junk);
    const r = safeRemove(rel, { root: repoRoot });
    assert.equal(r.ok, true);
    assert.ok(!fs.existsSync(junk));
  });
});

describe('clear / clean allowlist', () => {
  it('parseClearArgs reads flags', () => {
    const f = parseClearArgs(['--dry-run', '--keep-tools', '--keep-workspaces', '--all']);
    assert.equal(f.dryRun, true);
    assert.equal(f.keepTools, true);
    assert.equal(f.keepWorkspaces, true);
    assert.equal(f.all, true);
  });

  it('resolveCleanTargets never includes src or package.json', () => {
    const targets = resolveCleanTargets(repoRoot);
    for (const t of targets) {
      assert.ok(!isProtectedPath(t, repoRoot), `clean must not target protected ${t}`);
      const rel = toRelPosix(t, repoRoot);
      assert.ok(!rel.startsWith('src/'), rel);
      assert.notEqual(rel, 'package.json');
    }
  });

  it('resolveClearTargets with keep-tools does not list .tools root when only downloads missing', () => {
    const withKeep = resolveClearTargets({ keepTools: true, keepWorkspaces: true }, repoRoot);
    const rels = formatTargetList(withKeep, repoRoot);
    assert.ok(!rels.includes('.tools'), `should not clear full .tools when keep-tools: ${rels.join(',')}`);
    assert.ok(!rels.some((r) => r === 'src' || r.startsWith('src/')));
  });

  it('clear --dry-run CLI previews without deleting fixture file in dist', () => {
    const distProbe = path.join(repoRoot, 'dist', `_maint-probe-${process.pid}.txt`);
    fs.mkdirSync(path.dirname(distProbe), { recursive: true });
    fs.writeFileSync(distProbe, 'probe');
    const r = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/maint/clear.mjs'), '--dry-run', '--keep-tools', '--keep-workspaces'],
      { cwd: repoRoot, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /dry-run|Will delete/i);
    assert.ok(fs.existsSync(distProbe), 'dry-run must not delete');
    // cleanup probe via real clear keep flags after dry-run check
    fs.unlinkSync(distProbe);
  });
});

describe('checksum + manifest', () => {
  it('hashFile and verifyChecksum work', () => {
    const f = path.join(fixtureRoot, 'hash-me.bin');
    fs.writeFileSync(f, Buffer.from('alpha-studio-checksum'));
    const h = hashFile(f);
    assert.equal(h.length, 64);
    const ok = verifyChecksum(f, h);
    assert.equal(ok.ok, true);
    const bad = verifyChecksum(f, '0'.repeat(64));
    assert.equal(bad.ok, false);
    assert.equal(hashString('x').length, 64);
  });

  it('fileIdentity + matchesIdentity detect size/mtime changes', () => {
    const f = path.join(fixtureRoot, 'id-me.bin');
    fs.writeFileSync(f, 'abc');
    const id = fileIdentity(f);
    assert.ok(id);
    assert.equal(matchesIdentity(f, id), true);
    fs.writeFileSync(f, 'abcd');
    assert.equal(matchesIdentity(f, id), false);
  });

  it('upsertTool writes manifest fields + size/mtime + atomic config', () => {
    // Manifest always writes under repo .tools — use real path but restore
    const fakeBin = path.join(fixtureRoot, 'fake-tool.exe');
    fs.writeFileSync(fakeBin, 'MZ-fake');
    const before = fs.existsSync(manifestPath(repoRoot))
      ? fs.readFileSync(manifestPath(repoRoot), 'utf8')
      : null;
    const beforeCfg = fs.existsSync(legacyConfigPath(repoRoot))
      ? fs.readFileSync(legacyConfigPath(repoRoot), 'utf8')
      : null;
    const key = `_test_tool_${process.pid}`;
    try {
      const m = upsertTool(
        key,
        { version: '1.0.0', executablePath: fakeBin, source: 'test' },
        repoRoot,
      );
      assert.ok(m.version >= 1);
      assert.ok(m.tools[key]);
      const e = m.tools[key];
      assert.equal(e.name, key);
      assert.equal(e.version, '1.0.0');
      assert.ok(e.platform);
      assert.ok(e.architecture);
      assert.ok(e.checksum);
      assert.ok(e.size != null);
      assert.ok(e.mtimeMs != null);
      assert.equal(e.executablePath, fakeBin);
      assert.ok(e.installedAt);
      assert.equal(isEntryCacheValid(e).ok, true);
      // Legacy config written atomically alongside
      const cfg = JSON.parse(fs.readFileSync(legacyConfigPath(repoRoot), 'utf8'));
      assert.equal(cfg.tools[key]?.path, fakeBin);
    } finally {
      // remove test entry
      const m = loadManifest(repoRoot);
      delete m.tools[key];
      if (Object.keys(m.tools).length === 0 && before == null) {
        try {
          fs.unlinkSync(manifestPath(repoRoot));
        } catch {
          /* ignore */
        }
      } else {
        saveManifest(m, repoRoot);
      }
      if (beforeCfg != null) {
        fs.writeFileSync(legacyConfigPath(repoRoot), beforeCfg);
      } else {
        writeLegacyConfig(repoRoot);
      }
    }
  });

  it('upsertTools batch write keeps multiple entries', () => {
    const a = path.join(fixtureRoot, 'batch-a.bin');
    const b = path.join(fixtureRoot, 'batch-b.bin');
    fs.writeFileSync(a, 'A');
    fs.writeFileSync(b, 'B');
    const ka = `_batch_a_${process.pid}`;
    const kb = `_batch_b_${process.pid}`;
    const before = loadManifest(repoRoot);
    try {
      const m = upsertTools(
        {
          [ka]: { version: 'a', executablePath: a, source: 'test' },
          [kb]: { version: 'b', executablePath: b, source: 'test' },
        },
        repoRoot,
      );
      assert.ok(m.tools[ka]);
      assert.ok(m.tools[kb]);
    } finally {
      const m = loadManifest(repoRoot);
      delete m.tools[ka];
      delete m.tools[kb];
      // restore prior non-test tools
      for (const [k, v] of Object.entries(before.tools)) {
        if (!m.tools[k]) m.tools[k] = v;
      }
      saveManifest(m, repoRoot);
    }
  });
});

describe('tools probe', () => {
  it('lists required tool names including ImageMagick, 7z, and sharp', () => {
    const names = listToolDefs();
    for (const n of ['ffmpeg', 'ffprobe', 'libreoffice', 'pandoc', 'imagemagick', '7z', 'sharp']) {
      assert.ok(names.includes(n), `missing def ${n}`);
    }
  });

  it('checkAllTools returns structured status for each (includes bundled sharp)', () => {
    const all = checkAllTools(repoRoot);
    // Core set: ffmpeg, ffprobe, libreoffice, pandoc, 7z, imagemagick, sharp
    // Feature extras (tesseract/pdftoppm) only when env flags set
    assert.ok(all.length >= 7, `expected >=7 tools, got ${all.length}`);
    const byName = Object.fromEntries(all.map((t) => [t.name, t]));
    assert.ok(byName.sharp?.available);
    assert.equal(byName.sharp.path, 'bundled');
    for (const t of all) {
      assert.ok(typeof t.available === 'boolean');
      assert.ok(typeof t.name === 'string');
      assert.ok('path' in t);
      assert.ok('version' in t);
      assert.ok('source' in t);
    }
  });

  it('requiredToolNames excludes optional imagemagick and includes ffmpeg', () => {
    const req = requiredToolNames();
    assert.ok(req.includes('ffmpeg'));
    assert.ok(req.includes('ffprobe'));
    assert.ok(req.includes('libreoffice'));
    assert.ok(req.includes('7z'));
    assert.ok(!req.includes('imagemagick'));
    assert.ok(!req.includes('sharp'));
    assert.ok(!req.includes('pandoc'));
  });

  it('resolveTool uses cache when manifest identity is valid', () => {
    // If ffmpeg is available in this environment, second resolve should be cacheable
    const first = resolveTool('ffmpeg', repoRoot, { forceProbe: true });
    if (!first.available) return; // skip soft when no ffmpeg
    // Write/ensure identity via upsert so cache can hit
    upsertTool(
      'ffmpeg',
      { version: first.version, executablePath: first.path, source: first.source },
      repoRoot,
    );
    const cached = resolveTool('ffmpeg', repoRoot, { forceProbe: false });
    assert.equal(cached.available, true);
    assert.equal(cached.cached, true);
  });

  it('detectEnvironment reports platform and writable tools dirs', () => {
    const e = detectEnvironment(repoRoot);
    assert.ok(['windows', 'linux', 'macos', 'other'].includes(e.os));
    assert.ok(e.archLabel);
    assert.ok(typeof e.writable.toolsRoot === 'boolean');
    assert.ok(typeof featureFlags().pandocRequired === 'boolean');
  });
});

describe('package.json script surface', () => {
  it('exposes all ten required npm scripts as node entrypoints', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const required = [
      'clear',
      'clean',
      'reset',
      'tools:check',
      'tools:install',
      'tools:repair',
      'tools:update',
      'deps:check',
      'deps:prune',
      'doctor',
    ];
    for (const name of required) {
      assert.ok(pkg.scripts[name], `missing script ${name}`);
      assert.match(pkg.scripts[name], /^node /);
    }
  });
});

describe('deps:check reports deprecated section via real CLI', () => {
  it('prints DEPRECATED or OK deprecated line', () => {
    const r = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/maint/deps.mjs'), 'check'],
      { cwd: repoRoot, encoding: 'utf8', timeout: 180_000, windowsHide: true },
    );
    // audit may be slow; allow non-zero only for missing packages
    assert.ok(r.status === 0 || r.status === 1, `unexpected exit ${r.status}`);
    assert.match(r.stdout, /\[DEPRECATED\]|no deprecated field/i);
    assert.match(r.stdout, /\[AUDIT\]/);
    // Audit must not be pure spawn failure
    assert.ok(!/\"code\":\"spawn\"/.test(r.stdout), 'audit spawn must succeed');
  });
});
