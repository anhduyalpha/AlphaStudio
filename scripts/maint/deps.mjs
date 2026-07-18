#!/usr/bin/env node
/**
 * npm run deps:check | deps:prune
 *
 * check  — missing installs, proven-unused (import scan), scope, lock dups,
 *          deprecated fields, npm audit
 * prune  — uninstall only *proven* unused production deps (re-scanned just
 *          before removal); then npm prune + dedupe for extraneous modules.
 *          Never removes packages that appear in imports, dynamic imports,
 *          string-literal config targets, package scripts, or the keep list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, runNpm } from './lib/platform.mjs';

const cmd = process.argv[2] || 'check';
const help = process.argv.includes('--help') || process.argv.includes('-h');
const dryRun = process.argv.includes('--dry-run');

/**
 * Packages loaded by name at runtime (string config / transport), not via
 * static import. Exact string-literal matches only count for these.
 * They are also never auto-pruned.
 */
const STRING_LOADED = new Set([
  // pino transport target: { target: 'pino-pretty' }
  'pino-pretty',
]);

/** Packages that must never be auto-pruned even if the scanner misses them. */
const NEVER_PRUNE = new Set([...STRING_LOADED]);

/** Root-only frontend packages — must not appear in server/package.json. */
const ROOT_ONLY = new Set(['react', 'react-dom', 'vite']);

/** Server-ish packages — must not appear in root package.json. */
const SERVER_ONLY = new Set([
  'fastify',
  '@fastify/cors',
  '@fastify/multipart',
  '@fastify/websocket',
  'better-sqlite3',
  'sharp',
  'pino',
  'pino-pretty',
  'archiver',
  'extract-zip',
  'file-type',
  'pdf-lib',
  'qrcode',
  'jsqr',
  'tar',
  'uuid',
  'dotenv',
]);

const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|css|html|md)$/i;
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'data',
  'data-test',
  'data-test-converter',
  'audit',
  'tmp',
  'coverage',
  '.tools',
]);

if (help) {
  console.log(`Usage: node scripts/maint/deps.mjs <check|prune> [--dry-run]

  check  Report missing, proven-unused (import scan), scope issues, lock
         duplicates, deprecated packages, and npm audit vulns
  prune  Uninstall only proven-unused production deps, then npm prune + dedupe
         (root and server). Use --dry-run to preview without writing.
`);
  process.exit(0);
}

function readPkg(dir) {
  const p = path.join(dir, 'package.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function listDeclared(pkg) {
  return {
    deps: Object.keys(pkg.dependencies || {}),
    devDeps: Object.keys(pkg.devDependencies || {}),
    all: [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})],
  };
}

/** Resolve workspace-hoisted packages from dir or any parent node_modules. */
function installedPackageJson(dir, name) {
  let current = path.resolve(dir);
  while (true) {
    const candidate = path.join(current, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collect text from a package's relevant trees for import scanning.
 * @param {string} pkgDir
 * @param {string[]} relativeRoots  dirs/files relative to pkgDir
 * @param {string[]} [extraAbsFiles]
 */
function collectHaystack(pkgDir, relativeRoots, extraAbsFiles = []) {
  const chunks = [];

  function walk(abs, depth = 0) {
    if (depth > 10) return;
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return;
    }
    if (st.isFile()) {
      if (SOURCE_EXT.test(abs) || /\.config\.[cm]?[jt]s$/i.test(abs)) {
        try {
          chunks.push(fs.readFileSync(abs, 'utf8'));
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (!st.isDirectory()) return;
    let ents;
    try {
      ents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      walk(path.join(abs, ent.name), depth + 1);
    }
  }

  for (const rel of relativeRoots) {
    const abs = path.join(pkgDir, rel);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const f of extraAbsFiles) {
    if (f && fs.existsSync(f)) walk(f);
  }

  // Always include this package.json (scripts + dep names themselves don't count as use)
  try {
    const pkg = readPkg(pkgDir);
    chunks.push(JSON.stringify(pkg.scripts || {}));
    // Config fields that may name modules (e.g. future "exports" tooling)
    if (pkg.main) chunks.push(String(pkg.main));
    if (pkg.module) chunks.push(String(pkg.module));
    if (pkg.bin) chunks.push(JSON.stringify(pkg.bin));
  } catch {
    /* ignore */
  }

  return chunks.join('\n');
}

/**
 * True if `name` is referenced via import/require/dynamic import, as a
 * package.json script token/bin, or (only for STRING_LOADED) as a full
 * string literal config target.
 *
 * Plain string literals are intentionally NOT treated as usage for arbitrary
 * packages — otherwise this tool's own package-name lists would hide unused deps.
 */
function isPackageReferenced(name, hay, pkgScriptsText) {
  // NEVER_PRUNE always counts as referenced (safe default: never auto-delete)
  if (NEVER_PRUNE.has(name)) return true;

  const esc = escapeRe(name);

  // ESM / CJS / dynamic: from 'pkg', from "pkg/sub", require('pkg'), import('pkg')
  const importRe = new RegExp(
    String.raw`(?:` +
      // import … from 'pkg' | export … from 'pkg'
      String.raw`(?:^|[^\w$])(?:import|export)(?:\s+type)?(?:[\s\w*{}$,]*?)\s+from\s*['"]${esc}(?:/[^'"]*)?['"]` +
      String.raw`|` +
      // side-effect import 'pkg'
      String.raw`(?:^|[^\w$])import\s*['"]${esc}(?:/[^'"]*)?['"]` +
      String.raw`|` +
      // import('pkg') / import("pkg/x")
      String.raw`\bimport\s*\(\s*['"]${esc}(?:/[^'"]*)?['"]` +
      String.raw`|` +
      // require('pkg')
      String.raw`\brequire\s*\(\s*['"]${esc}(?:/[^'"]*)?['"]` +
      String.raw`)`,
    'm',
  );
  if (importRe.test(hay)) return true;

  // Config string targets only for known string-loaded packages
  if (STRING_LOADED.has(name)) {
    const litRe = new RegExp(String.raw`['"]${esc}['"]`);
    if (litRe.test(hay)) return true;
  }

  // Scripts may invoke package bins by name (vite, tsx, concurrently…)
  if (pkgScriptsText) {
    const binRe = new RegExp(String.raw`(?:^|[\s"'=/])${esc}(?:[\s"'@]|$)`);
    if (binRe.test(pkgScriptsText)) return true;
  }

  // Resolve package bin names from node_modules when available (typescript → tsc)
  // Caller may pass binsHay as part of pkgScriptsText already expanded.

  return false;
}

/**
 * Map installed package → bin command names; used so typescript is "referenced"
 * when scripts call `tsc`.
 */
function packageBinNames(pkgDir, name) {
  const binPkg = path.join(pkgDir, 'node_modules', name, 'package.json');
  try {
    if (!fs.existsSync(binPkg)) return [];
    const meta = JSON.parse(fs.readFileSync(binPkg, 'utf8'));
    if (!meta.bin) return [];
    if (typeof meta.bin === 'string') return [name];
    return Object.keys(meta.bin);
  } catch {
    return [];
  }
}

function isPackageReferencedIn(pkgDir, name, hay, pkgScriptsText) {
  if (isPackageReferenced(name, hay, pkgScriptsText)) return true;
  // Bin alias: typescript provides `tsc`
  const bins = packageBinNames(pkgDir, name);
  if (!bins.length || !pkgScriptsText) return false;
  for (const bin of bins) {
    const binRe = new RegExp(String.raw`(?:^|[\s"'=/])${escapeRe(bin)}(?:[\s"'@/]|$)`);
    if (binRe.test(pkgScriptsText)) return true;
  }
  return false;
}

/**
 * @types/foo is considered used when package `foo` is declared, or the types
 * name appears in source (rare).
 */
function isTypesPackageUsed(name, declared, hay) {
  if (!name.startsWith('@types/')) return null;
  const base = name.slice('@types/'.length);
  // scoped: @types/babel__core → @babel/core (not handled exhaustively)
  if (declared.all.includes(base) || declared.all.some((d) => d === base || d.endsWith(`/${base}`))) {
    return true;
  }
  // @types/ws often supports transitive `ws` from @fastify/websocket
  if (litOrImport(base, hay) || litOrImport(name, hay)) return true;
  // Keep @types/* when any sibling runtime dep may need it — mark as "unknown" not unused
  return 'keep';
}

function litOrImport(name, hay) {
  return isPackageReferenced(name, hay, '');
}

/**
 * High-confidence unused production deps only.
 * @returns {{ unused: string[], keptDynamic: string[] }}
 */
function findProvenUnused(pkgDir, pkg, scanRoots, extraFiles = []) {
  const declared = listDeclared(pkg);
  const hay = collectHaystack(pkgDir, scanRoots, extraFiles);
  const scriptsText = JSON.stringify(pkg.scripts || {});
  const unused = [];
  const keptDynamic = [];

  for (const name of declared.deps) {
    if (NEVER_PRUNE.has(name)) {
      keptDynamic.push(name);
      continue;
    }
    if (isPackageReferencedIn(pkgDir, name, hay, scriptsText)) continue;
    unused.push(name);
  }

  return { unused, keptDynamic, hayLength: hay.length };
}

function scanRootsFor(label) {
  if (label === 'root') {
    return {
      roots: ['src', 'scripts', 'public', 'vite.config.js', 'index.html'],
      extra: [],
    };
  }
  // server: source + tests; also monorepo scripts that may load server modules
  return {
    roots: ['src', 'tests'],
    extra: [
      path.join(projectRoot, 'scripts'),
      path.join(projectRoot, 'vite.config.js'),
    ],
  };
}

function duplicatesInLock(lockPath) {
  if (!fs.existsSync(lockPath)) return [];
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const versions = new Map();
    const pkgs = lock.packages || {};
    for (const [key, meta] of Object.entries(pkgs)) {
      if (!key || key === '') continue;
      const n = key.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)$/)?.[1];
      if (!n) continue;
      if (!versions.has(n)) versions.set(n, new Set());
      if (meta.version) versions.get(n).add(meta.version);
    }
    const dups = [];
    for (const [n, set] of versions) {
      if (set.size > 1) dups.push({ name: n, versions: [...set] });
    }
    return dups.slice(0, 40);
  } catch {
    return [];
  }
}

function runAudit(cwd) {
  try {
    const r = runNpm(['audit', '--json'], {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.error) {
      return { error: r.error.message, code: 'spawn' };
    }
    const raw = String(r.stdout || '');
    try {
      const j = JSON.parse(raw);
      if (j.metadata?.vulnerabilities) {
        return j.metadata.vulnerabilities;
      }
      return { raw: 'parsed', total: j.metadata?.vulnerabilities?.total ?? null, exit: r.status };
    } catch {
      return {
        note: 'audit json parse failed or audit disabled',
        exit: r.status,
        stderr: String(r.stderr || '').slice(0, 200),
      };
    }
  } catch (e) {
    return { error: e.message };
  }
}

/** Packages whose installed package.json has a `deprecated` field. */
function findDeprecated(dir, declared) {
  const out = [];
  for (const name of declared.all) {
    const pkgPath = installedPackageJson(dir, name);
    try {
      if (!pkgPath) continue;
      const p = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (p.deprecated) {
        out.push({
          name,
          version: p.version || '',
          message: String(p.deprecated).slice(0, 200),
        });
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Frontend vs server dependency scoping. */
function checkScope(label, declared) {
  const issues = [];
  if (label === 'server') {
    for (const name of declared.all) {
      if (ROOT_ONLY.has(name)) {
        issues.push(`${name} belongs at repo root (frontend), not in server/`);
      }
    }
  } else if (label === 'root') {
    for (const name of declared.all) {
      if (SERVER_ONLY.has(name)) {
        issues.push(`${name} belongs in server/, not at repo root`);
      }
    }
  }
  return issues;
}

function checkPkg(label, dir) {
  console.log(`\n=== ${label} (${dir}) ===`);
  const pkg = readPkg(dir);
  const declared = listDeclared(pkg);
  console.log(`  declared deps: ${declared.deps.length} prod, ${declared.devDeps.length} dev`);

  const missing = [];
  for (const name of declared.all) {
    if (!installedPackageJson(dir, name)) missing.push(name);
  }
  if (missing.length) {
    console.log(`  [MISSING] ${missing.join(', ')}`);
    console.log('    Repair: npm install');
  } else {
    console.log('  [OK] all declared packages present (including workspace-hoisted node_modules)');
  }

  const { roots, extra } = scanRootsFor(label);
  const { unused, keptDynamic } = findProvenUnused(dir, pkg, roots, extra);
  if (unused.length) {
    console.log(`  [PROVEN UNUSED prod] ${unused.join(', ')}`);
    console.log('    Safe to remove via: npm run deps:prune  (or --dry-run first)');
  } else {
    console.log('  [OK] no proven-unused production deps (import/script scan)');
  }
  if (keptDynamic.length) {
    console.log(`  [KEEP] non-import runtime: ${keptDynamic.join(', ')}`);
  }

  const scopeIssues = checkScope(label, declared);
  if (scopeIssues.length) {
    console.log(`  [SCOPE] ${scopeIssues.length} misplaced package(s):`);
    for (const s of scopeIssues) console.log(`    - ${s}`);
  } else {
    console.log('  [OK] dependency scope (frontend vs server)');
  }

  // Dev-only notes: @types kept; tooling bins via scripts are fine
  const unusedDevHints = [];
  const hay = collectHaystack(dir, roots, extra);
  const scriptsText = JSON.stringify(pkg.scripts || {});
  for (const name of declared.devDeps) {
    const typesUse = isTypesPackageUsed(name, declared, hay);
    if (typesUse === true || typesUse === 'keep') continue;
    if (typesUse === null && !isPackageReferencedIn(dir, name, hay, scriptsText)) {
      // Only report as candidate, never auto-prune devDeps
      unusedDevHints.push(name);
    }
  }
  if (unusedDevHints.length) {
    console.log(`  [CANDIDATE UNUSED dev] ${unusedDevHints.join(', ')}`);
    console.log('    Review only — devDeps are never auto-pruned.');
  }

  const dups = duplicatesInLock(path.join(dir, 'package-lock.json'));
  if (dups.length) {
    console.log(`  [DUPLICATED] ${dups.length} packages with multiple versions (showing up to 10):`);
    for (const d of dups.slice(0, 10)) {
      console.log(`    - ${d.name}: ${d.versions.join(', ')}`);
    }
    console.log('    Repair: npm dedupe (transitive multi-versions are often unavoidable)');
  } else {
    console.log('  [OK] no multi-version duplicates detected in lockfile scan');
  }

  const deprecated = findDeprecated(dir, declared);
  if (deprecated.length) {
    console.log(`  [DEPRECATED] ${deprecated.length} installed package(s):`);
    for (const d of deprecated.slice(0, 15)) {
      console.log(`    - ${d.name}@${d.version}: ${d.message}`);
    }
    if (deprecated.length > 15) console.log(`    … and ${deprecated.length - 15} more`);
    console.log('    Repair: upgrade or replace deprecated packages');
  } else {
    console.log('  [OK] no deprecated field on declared installed packages');
  }

  console.log('  Running npm audit (network)…');
  const audit = runAudit(dir);
  console.log(`  [AUDIT] ${JSON.stringify(audit)}`);

  return { missing, unused, dups, deprecated, audit, scopeIssues };
}

function runCheck() {
  console.log('AlphaStudio deps:check');
  console.log(`root: ${projectRoot}`);
  const rootResult = checkPkg('root', projectRoot);
  const serverDir = path.join(projectRoot, 'server');
  const serverResult = fs.existsSync(path.join(serverDir, 'package.json'))
    ? checkPkg('server', serverDir)
    : null;

  const problems =
    rootResult.missing.length +
    (serverResult?.missing.length || 0) +
    rootResult.scopeIssues.length +
    (serverResult?.scopeIssues.length || 0);

  const unusedTotal =
    rootResult.unused.length + (serverResult?.unused.length || 0);

  console.log('');
  if (problems) {
    console.error('ACTION REQUIRED: fix missing packages (npm install) and/or scope issues');
    process.exitCode = 1;
  } else if (unusedTotal) {
    console.log(
      `deps:check complete with ${unusedTotal} proven-unused production dep(s). Run: npm run deps:prune`,
    );
    process.exitCode = 0;
  } else {
    console.log('deps:check complete.');
    process.exitCode = 0;
  }
}

/**
 * Uninstall only packages that still look unused on a fresh rescan.
 * Never touches NEVER_PRUNE, never removes on scan failure.
 */
function uninstallProvenUnused(label, dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return { removed: [], skipped: [] };

  const pkg = readPkg(dir);
  const { roots, extra } = scanRootsFor(label);
  const { unused } = findProvenUnused(dir, pkg, roots, extra);
  const removed = [];
  const skipped = [];

  if (!unused.length) {
    console.log(`  no proven-unused production deps in ${label}`);
    return { removed, skipped };
  }

  // Safety: re-verify each name one more time against a fresh haystack
  const hay = collectHaystack(dir, roots, extra);
  const scriptsText = JSON.stringify(pkg.scripts || {});
  const safe = [];
  for (const name of unused) {
    if (NEVER_PRUNE.has(name)) {
      skipped.push({ name, reason: 'never-prune list' });
      continue;
    }
    if (isPackageReferencedIn(dir, name, hay, scriptsText)) {
      skipped.push({ name, reason: 're-scan found reference' });
      continue;
    }
    // Must still be a production dependency
    if (!pkg.dependencies?.[name]) {
      skipped.push({ name, reason: 'not a production dependency' });
      continue;
    }
    safe.push(name);
  }

  if (!safe.length) {
    console.log(`  nothing safe to uninstall in ${label}`);
    for (const s of skipped) console.log(`    skip ${s.name}: ${s.reason}`);
    return { removed, skipped };
  }

  console.log(`  proven unused → uninstall: ${safe.join(', ')}`);
  if (dryRun) {
    console.log('  (dry-run: not uninstalling)');
    return { removed: safe, skipped, dryRun: true };
  }

  const r = runNpm(['uninstall', ...safe, '--no-fund', '--no-audit'], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (r.error) {
    console.error(`  uninstall spawn failed: ${r.error.message}`);
    process.exitCode = 1;
    return { removed, skipped, error: r.error.message };
  }
  if (r.status !== 0) {
    console.error(`  npm uninstall failed (exit ${r.status})`);
    process.exitCode = r.status || 1;
    return { removed, skipped, error: `exit ${r.status}` };
  }
  removed.push(...safe);
  for (const s of skipped) console.log(`    skip ${s.name}: ${s.reason}`);
  return { removed, skipped };
}

function runPrune() {
  console.log('AlphaStudio deps:prune');
  if (dryRun) {
    console.log('Dry-run mode: will report proven-unused uninstalls without writing\n');
  }

  for (const [label, dir] of [
    ['root', projectRoot],
    ['server', path.join(projectRoot, 'server')],
  ]) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    console.log(`\n=== prune ${label} ===`);

    const result = uninstallProvenUnused(label, dir);
    if (result.removed?.length) {
      console.log(
        dryRun
          ? `  would remove from package.json: ${result.removed.join(', ')}`
          : `  removed: ${result.removed.join(', ')}`,
      );
    }

    if (dryRun) {
      console.log('  dry-run: skip npm prune / dedupe');
      continue;
    }

    for (const args of [['prune'], ['dedupe']]) {
      console.log(`  npm ${args.join(' ')}…`);
      const r = runNpm(args, {
        cwd: dir,
        stdio: 'inherit',
      });
      if (r.error) {
        console.error(`ACTION REQUIRED: npm ${args.join(' ')} spawn failed: ${r.error.message}`);
        process.exitCode = 1;
        return;
      }
      if (r.status !== 0) {
        console.error(`ACTION REQUIRED: npm ${args.join(' ')} failed in ${dir} (exit ${r.status})`);
        process.exitCode = r.status || 1;
        return;
      }
    }
  }

  console.log(
    dryRun
      ? '\nDry-run complete. Re-run without --dry-run to apply proven-unused removals + prune/dedupe.'
      : '\nPrune complete: proven-unused production deps removed (if any); extraneous modules pruned; lockfiles may have updated.',
  );
  process.exitCode = process.exitCode || 0;
}

if (cmd === 'check') runCheck();
else if (cmd === 'prune') runPrune();
else {
  console.error(`Unknown deps command: ${cmd}`);
  process.exit(1);
}
