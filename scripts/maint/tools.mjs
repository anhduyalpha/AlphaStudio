#!/usr/bin/env node
/**
 * npm run tools:check | tools:install | tools:repair | tools:update
 *
 * Prefer system installs; install portable binaries under
 * .runtime/tools/<platform>-<arch>/ without admin / global PATH mutation.
 *
 * tools:check uses the atomic manifest cache (size+mtime) and is fast when tools are valid.
 * Without a selector, every Converter Phase 1 tool is required. tools:install
 * installs every missing tool and never re-downloads working ones.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  projectRoot,
  detectEnvironment,
  toolsPlatformDir,
  toolsRoot,
} from './lib/platform.mjs';
import {
  checkAllTools,
  repairInstructions,
  requiredToolNames,
  installableToolNames,
  parseToolSelection,
  toolNamesForSelection,
  selectionSizeEstimate,
} from './lib/tools-probe.mjs';
import {
  loadManifest,
  upsertTools,
  writeLegacyConfig,
  saveManifest,
  isEntryCacheValid,
  removeTool,
} from './lib/manifest.mjs';
import { verifyChecksum, fileIdentity } from './lib/checksum.mjs';

const cmd = process.argv[2] || 'check';
const help = process.argv.includes('--help') || process.argv.includes('-h');
const forceProbe = process.argv.includes('--force') || process.argv.includes('--no-cache');
let selection;
try {
  selection = parseToolSelection(process.argv.slice(3), process.env);
} catch (error) {
  console.error(`Invalid tool selection: ${error.message}`);
  process.exit(1);
}
const selectedToolNames = toolNamesForSelection(selection);

if (help) {
  console.log(`Usage: node scripts/maint/tools.mjs <check|install|repair|update> [options]

  check    Report OS, arch, and tool status (cache-fast when manifest valid)
  install  Install only MISSING required tools into .tools (portable, no admin)
  repair   Verify checksums/paths; re-scan system + project; rewrite manifest
  update   Re-run install for broken/missing only (does not re-download healthy tools)

  Options:
    --force / --no-cache   Bypass manifest cache (always re-probe)
    --profile <name>       Advanced direct-CLI filter; npm scripts always add full
    --tool <name>          Advanced direct-CLI filter; FFmpeg includes ffprobe
    --help / -h            Show this help

  Feature flags (env):
    ALPHA_FEATURE_OCR=1          require/report tesseract
    ALPHA_FEATURE_PDF_EXTRAS=1   require/report pdftoppm
`);
  process.exit(0);
}

function printEnvHeader() {
  const env = detectEnvironment(projectRoot);
  console.log('AlphaStudio tools');
  console.log(`  OS:           ${env.os} (${env.platform})`);
  console.log(`  Architecture: ${env.archLabel} (${env.arch})`);
  console.log(`  Node:         ${env.node}`);
  console.log(`  Project root: ${env.projectRoot}`);
  console.log(`  Tools dir:    ${env.toolsPlatformDir}`);
  console.log(`  Writable:     .tools=${env.writable.toolsRoot} platform=${env.writable.toolsPlatform}`);
  console.log(`  Elevated:     ${env.elevation.elevated ? 'yes' : 'no'} (not required for portable)`);
  console.log(`  Package mgrs: ${env.packageManagers.map((p) => p.name).join(', ') || '(none detected)'}`);
  const f = env.features;
  console.log(
    `  Features:     ocr=${f.ocr} pdfExtras=${f.pdfExtras} pandocRequired=${f.pandocRequired}`,
  );
  if (selection) {
    const estimate = selectionSizeEstimate(selection);
    console.log(
      `  Selection:    ${[
        ...(selection.profiles || []).map((profile) => `profile:${profile}`),
        ...(selection.tools || []).map((tool) => `tool:${tool}`),
      ].join(', ')}`,
    );
    console.log(
      `  Estimate:     download ~${estimate.downloadMb} MiB, installed ~${estimate.installedMb} MiB`,
    );
  } else {
    const estimate = selectionSizeEstimate(null);
    console.log('  Selection:    full Converter Phase 1 toolset (default)');
    console.log(
      `  Estimate:     download ~${estimate.downloadMb} MiB, installed ~${estimate.installedMb} MiB`,
    );
  }
  console.log('');
}

/**
 * Persist resolved tools into atomic manifest + legacy config.json.
 * Skips re-hash when identity already matches.
 */
function syncManifestFromResolved(tools) {
  const list = tools || checkAllTools(projectRoot, {
    forceProbe: true,
    toolNames: selectedToolNames,
  });
  const m = loadManifest(projectRoot);
  const batch = {};
  for (const t of list) {
    if (!t.available || !t.path) continue;
    if (t.path === 'bundled') {
      batch[t.name] = { version: t.version || 'bundled', executablePath: 'bundled', source: 'bundled' };
      continue;
    }
    const existing = m.tools[t.name];
    // Preserve checksum if path+identity unchanged
    if (
      existing &&
      existing.executablePath === t.path &&
      isEntryCacheValid(existing).ok
    ) {
      batch[t.name] = {
        version: t.version || existing.version,
        executablePath: t.path,
        source: t.source || existing.source,
        checksum: existing.checksum,
      };
    } else {
      batch[t.name] = {
        version: t.version,
        executablePath: t.path,
        source: t.source,
      };
    }
  }
  // Drop stale required entries that are no longer available
  for (const name of Object.keys(m.tools)) {
    if (batch[name]) continue;
    const still = list.find((t) => t.name === name);
    if (still && !still.available) {
      delete m.tools[name];
    }
  }
  // Merge batch into manifest via upsertTools (rewrites config too)
  const saved = upsertTools(batch, projectRoot);
  // Ensure removals persisted
  let dirty = false;
  for (const name of Object.keys(saved.tools)) {
    if (!batch[name] && list.some((t) => t.name === name && !t.available)) {
      delete saved.tools[name];
      dirty = true;
    }
  }
  if (dirty) saveManifest(saved, projectRoot);
  return list;
}

function runCheck() {
  printEnvHeader();
  const started = Date.now();
  // Fast path: use cache unless --force
  const tools = checkAllTools(projectRoot, { forceProbe, toolNames: selectedToolNames });
  const required = new Set(requiredToolNames(undefined, selection));
  const missing = [];
  let cacheHits = 0;

  for (const t of tools) {
    if (t.skipped) {
      console.log(`  [SKIP   ] ${t.name.padEnd(12)} (feature disabled)`);
      continue;
    }
    if (t.cached) cacheHits += 1;
    const status = t.available ? 'OK' : 'MISSING';
    const cacheTag = t.cached ? ' [cache]' : '';
    const detail = t.available
      ? `${t.path}  [${t.source}]  ${t.version || ''}`.trim() + cacheTag
      : '—';
    console.log(`  [${status.padEnd(7)}] ${t.name.padEnd(12)} ${detail}`);
    if (!t.available && required.has(t.name)) missing.push(t.name);
  }

  console.log('');
  const m = loadManifest(projectRoot);
  const ms = Date.now() - started;
  console.log(
    `  Manifest: ${path.join(toolsRoot(projectRoot), 'manifest.json')} (${Object.keys(m.tools).length} entries, v${m.version || 1})`,
  );
  console.log(`  Cache hits: ${cacheHits}/${tools.filter((t) => !t.skipped).length}  elapsed: ${ms}ms`);

  if (missing.length) {
    console.error('');
    console.error(repairInstructions(missing));
    process.exitCode = 2;
    return tools;
  }

  const optionalMissing = tools
    .filter((t) => !t.available && !t.skipped && !required.has(t.name) && t.tier !== 'bundled')
    .map((t) => t.name);
  if (optionalMissing.length) {
    console.log(`Note: optional not found: ${optionalMissing.join(', ')} (OK for core app).`);
  } else {
    console.log('All required tools resolved (system or project-local).');
  }
  process.exitCode = 0;
  return tools;
}

function runInstall({ force = false } = {}) {
  printEnvHeader();

  // Cold probe to know what's truly missing (system first via resolve)
  const before = checkAllTools(projectRoot, {
    forceProbe: true,
    toolNames: selectedToolNames,
  });
  const required = new Set(requiredToolNames(undefined, selection));
  const missing = before.filter((t) => !t.available && !t.skipped && required.has(t.name));
  const missingNames = missing.map((t) => t.name);

  // Always sync working tools into manifest without re-downloading
  const working = before.filter((t) => t.available && t.path && t.path !== 'bundled');
  if (working.length) {
    const batch = {};
    for (const t of working) {
      batch[t.name] = { version: t.version, executablePath: t.path, source: t.source };
    }
    upsertTools(batch, projectRoot);
  }

  // Map ffprobe → ffmpeg install unit (same build)
  const setupUnits = new Set();
  for (const n of missingNames) {
    if (n === 'ffprobe' || n === 'ffmpeg') setupUnits.add('ffmpeg');
    else if (installableToolNames().includes(n)) setupUnits.add(n);
  }

  // force=true only reinstalls if something is broken (repair), not healthy tools
  if (!force && setupUnits.size === 0) {
    console.log(
      missingNames.length
        ? `Required tools OK or non-portable missing: ${missingNames.join(', ')}. Manifest synced.`
        : 'Nothing to install; all required tools present. Manifest synced (no downloads).',
    );
    writeLegacyConfig(projectRoot);
    // Report gaps outside the complete Phase 1 runtime (for example Phase 2
    // image/vector tools or feature-gated OCR extras).
    const opt = before.filter((t) => !t.available && !t.skipped && !required.has(t.name));
    if (opt.length) {
      console.log(`Optional still missing: ${opt.map((t) => t.name).join(', ')}`);
    }
    process.exitCode = 0;
    return;
  }

  if (setupUnits.size === 0 && force) {
    console.log('Force requested but no installable gaps; re-syncing manifest only.');
    syncManifestFromResolved(before);
    process.exitCode = 0;
    return;
  }

  console.log(`Missing required: ${missingNames.join(', ') || '(none)'}`);
  console.log(`Install units:    ${[...setupUnits].join(', ')}`);
  console.log('Running project-local installer (scripts/setup-tools.mjs)…');
  console.log('(Prefers existing system tools; downloads only when needed.)');
  console.log('');

  const setupPath = path.join(projectRoot, 'scripts', 'setup-tools.mjs');
  const r = spawnSync(process.execPath, [setupPath, ...[...setupUnits].flatMap((u) => ['--only', u])], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ALPHA_TOOLS_ONLY: [...setupUnits].join(','),
    },
    windowsHide: true,
  });

  if (r.status !== 0 && r.status != null) {
    console.error('');
    console.error('ACTION REQUIRED: setup-tools exited with code', r.status);
    console.error(repairInstructions(missingNames));
    syncManifestFromResolved();
    process.exitCode = r.status || 1;
    return;
  }

  mirrorFlatToPlatformLayout();

  const after = syncManifestFromResolved();
  const still = after.filter((t) => !t.available && !t.skipped && required.has(t.name));
  console.log('');
  if (still.length) {
    console.error(repairInstructions(still.map((t) => t.name)));
    process.exitCode = 2;
  } else {
    console.log('Install pass complete; atomic manifest + config.json updated.');
    process.exitCode = 0;
  }
}

function mirrorFlatToPlatformLayout() {
  const plat = toolsPlatformDir(projectRoot);
  const flat = toolsRoot(projectRoot);
  const names = ['ffmpeg', '7z', 'pandoc', 'libreoffice', 'calibre'];
  for (const name of names) {
    const src = path.join(flat, name);
    const dest = path.join(plat, name);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
        console.log(`  mirrored ${name} → ${dest}`);
      } catch (e) {
        console.warn(`  mirror ${name} skipped: ${e.message}`);
      }
    }
  }
}

function runRepair() {
  printEnvHeader();
  console.log('Repair: verifying project-local binaries + re-scanning…');

  const m = loadManifest(projectRoot);
  const broken = [];
  const requested = selectedToolNames ? new Set(selectedToolNames) : null;
  for (const [name, entry] of Object.entries(m.tools)) {
    if (requested && !requested.has(name)) continue;
    if (!entry.executablePath || entry.executablePath === 'bundled') {
      console.log(`  [OK]     ${name}: bundled`);
      continue;
    }
    if (!fs.existsSync(entry.executablePath)) {
      console.log(`  [BROKEN] ${name}: missing file ${entry.executablePath}`);
      broken.push(name);
      removeTool(name, projectRoot);
      continue;
    }
    if (entry.checksum) {
      const v = verifyChecksum(entry.executablePath, entry.checksum);
      if (!v.ok) {
        // If identity still matches, binary may have been re-copied with same content path
        // but different hash storage — re-check identity first
        const id = fileIdentity(entry.executablePath);
        if (id && entry.size != null && id.size === entry.size) {
          console.log(`  [WARN]   ${name}: checksum mismatch (size ok) — will refresh hash`);
        } else {
          console.log(`  [BROKEN] ${name}: checksum mismatch actual=${v.actual} expected=${v.expected}`);
          broken.push(name);
          continue;
        }
      }
    }
    const cache = isEntryCacheValid(entry);
    if (!cache.ok && cache.reason === 'identity-mismatch') {
      console.log(`  [STALE]  ${name}: identity changed, will re-bind`);
    } else {
      console.log(`  [OK]     ${name}: ${entry.executablePath}`);
    }
  }

  // Force re-resolve from system → project
  const tools = checkAllTools(projectRoot, {
    forceProbe: true,
    toolNames: selectedToolNames,
  });
  syncManifestFromResolved(tools);
  const required = new Set(requiredToolNames(undefined, selection));
  const missing = tools.filter((t) => !t.available && !t.skipped && required.has(t.name)).map((t) => t.name);

  if (broken.length || missing.length) {
    console.log('');
    console.log('Re-installing missing/broken tools only…');
    runInstall({ force: broken.length > 0 });
    return;
  }

  writeLegacyConfig(projectRoot);
  console.log('');
  console.log('Repair complete; all tools healthy. Manifest + config.json rewritten.');
  process.exitCode = 0;
}

function runUpdate() {
  printEnvHeader();
  console.log('Update: refresh missing/broken only (healthy tools are never re-downloaded)…');
  // Re-probe; install only gaps
  runInstall({ force: false });
}

switch (cmd) {
  case 'check':
    runCheck();
    break;
  case 'install':
    runInstall({ force: false });
    break;
  case 'repair':
    runRepair();
    break;
  case 'update':
    runUpdate();
    break;
  default:
    console.error(`Unknown tools command: ${cmd}`);
    console.error('Use: check | install | repair | update');
    process.exit(1);
}
