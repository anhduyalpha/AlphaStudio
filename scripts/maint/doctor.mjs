#!/usr/bin/env node
/**
 * npm run doctor — full environment diagnostics.
 * Never downloads tools; uses manifest cache for fast tool status.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {
  projectRoot,
  detectEnvironment,
  nodeVersion,
  npmVersion,
  isWritableDir,
  toolsPlatformDir,
  toolsRoot,
  featureFlags,
} from './lib/platform.mjs';
import { checkAllTools, repairInstructions, requiredToolNames } from './lib/tools-probe.mjs';
import { loadManifest, manifestPath, legacyConfigPath, isEntryCacheValid } from './lib/manifest.mjs';

const help = process.argv.includes('--help') || process.argv.includes('-h');
if (help) {
  console.log(`Usage: npm run doctor

Reports environment, dependencies, database, storage, permissions, ports, and tools.
Does NOT download or reinstall tools (use npm run tools:install for that).
Exit 0 if healthy enough to run; non-zero if critical issues found.
`);
  process.exit(0);
}

const issues = [];
const warnings = [];

function ok(msg) {
  console.log(`  [OK]   ${msg}`);
}
function warn(msg) {
  console.log(`  [WARN] ${msg}`);
  warnings.push(msg);
}
function fail(msg, repair) {
  console.log(`  [FAIL] ${msg}`);
  if (repair) console.log(`         Repair: ${repair}`);
  issues.push({ msg, repair });
}

console.log('AlphaStudio doctor');
console.log(`time: ${new Date().toISOString()}`);
console.log('');

// ── Environment ──────────────────────────────────────────────────────────
console.log('== Environment ==');
const env = detectEnvironment(projectRoot);
ok(`OS ${env.os} platform=${env.platform} arch=${env.archLabel} (${env.arch})`);
ok(`Node ${env.node}`);
const npmV = npmVersion();
if (npmV) ok(`npm ${npmV}`);
else if (env.packageManagers.some((p) => p.name === 'npm')) ok('npm available (package manager list)');
else fail('npm not found on PATH', 'Install Node.js LTS which includes npm');
ok(`Package managers: ${env.packageManagers.map((p) => p.name).join(', ') || 'none'}`);
ok(`Project root: ${env.projectRoot}`);
ok(`Elevated/admin: ${env.elevation.elevated ? 'yes' : 'no'} (${env.elevation.method}; not required for portable tools)`);
const f = featureFlags();
ok(
  `Features: ocr=${f.ocr} pdfExtras=${f.pdfExtras} imagemagick=${f.imagemagick} pandocRequired=${f.pandocRequired}`,
);
console.log('');

// ── Dependencies ─────────────────────────────────────────────────────────
console.log('== Dependencies ==');
// npm workspaces: single root node_modules; server/node_modules is not required
const rootNm = path.join(projectRoot, 'node_modules');
const serverPkg = path.join(projectRoot, 'server', 'package.json');
if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
  fail('root package.json missing', 'Restore package.json');
} else {
  ok('root package.json present');
}
if (!fs.existsSync(serverPkg)) {
  fail('server package.json missing', 'Restore server/package.json');
} else {
  ok('server package.json present (workspace)');
}
if (!fs.existsSync(rootNm)) {
  fail('root node_modules missing', 'npm install');
} else {
  ok('root node_modules present (workspace hoist)');
}
if (fs.existsSync(path.join(projectRoot, 'server', 'node_modules'))) {
  warn('server/node_modules still present — prefer removing after workspaces (rm -rf server/node_modules)');
} else {
  ok('no nested server/node_modules (expected under workspaces)');
}
// Sharp/libvips is bundled via npm sharp (workspace hoist → root node_modules)
const sharpCandidates = [
  path.join(projectRoot, 'node_modules', 'sharp'),
  path.join(projectRoot, 'server', 'node_modules', 'sharp'),
];
const sharpPkg = sharpCandidates.find((p) => fs.existsSync(p));
if (sharpPkg) ok(`sharp (libvips bundled) present at ${path.relative(projectRoot, sharpPkg)}`);
else warn('sharp package not found under node_modules (image ops may fail until npm install)');
console.log('');

// ── Database ─────────────────────────────────────────────────────────────
console.log('== Database ==');
const dataDir = path.join(projectRoot, 'data');
const dbPath = path.join(dataDir, 'alphastudio.db');
if (fs.existsSync(dbPath)) {
  ok(`SQLite DB exists: ${dbPath} (${fs.statSync(dbPath).size} bytes)`);
  // Schema heal check: detect_cache must exist
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => r.name);
    db.close();
    if (tables.includes('detect_cache')) ok('detect_cache table present');
    else warn('detect_cache missing — run npm run db:repair');
  } catch (e) {
    warn(`could not inspect schema: ${e.message}`);
  }
} else {
  warn(`SQLite DB not found at ${dbPath} (created on first server start / reset)`);
}
console.log('');

// ── Storage ──────────────────────────────────────────────────────────────
console.log('== Storage ==');
for (const rel of ['data', 'data/uploads', 'data/outputs', 'data/temp', '.runtime', '.tools']) {
  const p = path.join(projectRoot, rel);
  if (isWritableDir(p)) ok(`writable ${rel}`);
  else if (rel === '.tools') warn(`legacy ${rel} not writable (ok if using .runtime only)`);
  else fail(`not writable ${rel}`, `Fix permissions on ${p}`);
}
console.log('');

// ── Permissions ──────────────────────────────────────────────────────────
console.log('== Permissions ==');
if (env.writable.projectRoot) ok('project root writable');
else fail('project root not writable', 'Run from a user-owned clone of the repo');
const toolsDir = toolsPlatformDir(projectRoot);
if (env.writable.toolsPlatform) ok(`.runtime tools dir writable (${toolsDir})`);
else fail('.runtime tools not writable', `Ensure ${toolsRoot(projectRoot)} is user-writable`);
if (!env.elevation.elevated) ok('running without admin (portable tools OK)');
else warn('running elevated — not required; prefer normal user for portable .runtime installs');
console.log('');

// ── Port ─────────────────────────────────────────────────────────────────
console.log('== Port ==');
const port = Number(process.env.PORT || 8787);
await checkPort(port);
console.log('');

// ── Tool manifest cache ──────────────────────────────────────────────────
console.log('== Tool manifest ==');
const manPath = manifestPath(projectRoot);
const cfgPath = legacyConfigPath(projectRoot);
const manifest = loadManifest(projectRoot);
if (fs.existsSync(manPath)) {
  ok(`manifest.json present (v${manifest.version}, ${Object.keys(manifest.tools).length} tools, updated ${manifest.updatedAt || 'n/a'})`);
} else {
  warn('manifest.json missing (will be created by tools:install / tools:repair)');
}
if (fs.existsSync(cfgPath)) ok(`config.json present (server registry)`);
else warn('config.json missing (server will fall back to PATH / project discovery)');
ok(`manifest platform=${manifest.platform || env.platform} arch=${manifest.architecture || env.archLabel}`);
console.log('');

// ── Tools (cache-fast, no download) ──────────────────────────────────────
console.log('== Tools ==');
const started = Date.now();
// Prefer cache; doctor never force-probes unless cache empty for a tool
const tools = checkAllTools(projectRoot, { forceProbe: false });
const required = new Set(requiredToolNames());
const missing = [];
let cacheHits = 0;
for (const t of tools) {
  if (t.skipped) {
    ok(`${t.name}: skipped (feature disabled)`);
    continue;
  }
  if (t.cached) cacheHits += 1;
  if (t.available) {
    const tag = t.cached ? 'cache' : t.source;
    ok(`${t.name}: ${t.path} (${tag}) ${t.version || ''}`.trim());
    // Cross-check manifest identity for project tools
    const entry = manifest.tools[t.name];
    if (entry && t.path !== 'bundled') {
      const v = isEntryCacheValid(entry);
      if (!v.ok) warn(`${t.name}: manifest identity stale (${v.reason}) — run npm run tools:repair`);
    }
  } else if (!required.has(t.name)) {
    warn(`${t.name}: not found (optional)`);
  } else {
    fail(`${t.name}: missing`, 'npm run tools:install');
    missing.push(t.name);
  }
}
console.log(`  (resolved in ${Date.now() - started}ms, cache hits ${cacheHits}/${tools.filter((t) => !t.skipped).length})`);
if (missing.length) {
  console.log('');
  console.error(repairInstructions(missing));
}
console.log('');

// ── Summary ──────────────────────────────────────────────────────────────
console.log('== Summary ==');
console.log(`  platform: ${env.os}/${env.archLabel}`);
console.log(`  failures: ${issues.length}`);
console.log(`  warnings: ${warnings.length}`);
if (issues.length) {
  console.error('Doctor found critical issues. Address FAIL items above.');
  process.exit(1);
}
console.log('Doctor passed (warnings allowed). No tools were downloaded.');
process.exit(0);

function checkPort(p) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        warn(`port ${p} in use (server may already be running)`);
      } else {
        warn(`port ${p} check: ${err.message}`);
      }
      resolve();
    });
    server.once('listening', () => {
      server.close(() => {
        ok(`port ${p} available`);
        resolve();
      });
    });
    server.listen(p, '127.0.0.1');
  });
}
