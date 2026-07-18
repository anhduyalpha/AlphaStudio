#!/usr/bin/env node
/**
 * npm run clean — remove only build, cache, logs, coverage, and temporary files.
 */
import { resolveCleanTargets, formatTargetList } from './lib/clear-targets.mjs';
import { safeRemove } from './lib/paths.mjs';
import { projectRoot } from './lib/platform.mjs';

const dryRun = process.argv.includes('--dry-run');
const help = process.argv.includes('--help') || process.argv.includes('-h');

if (help) {
  console.log(`Usage: npm run clean -- [--dry-run]

Removes build outputs (dist), caches, logs, coverage, and temp directories only.
Does not remove data workspaces, .tools installs, or node_modules.
`);
  process.exit(0);
}

const targets = resolveCleanTargets(projectRoot);
const rels = formatTargetList(targets, projectRoot);

console.log('AlphaStudio clean');
console.log(`root: ${projectRoot}`);
if (rels.length === 0) {
  console.log('Nothing to clean.');
  process.exit(0);
}

console.log(`${dryRun ? 'Would remove' : 'Removing'} ${rels.length} path(s):`);
for (const r of rels) console.log(`  - ${r}`);

if (dryRun) {
  console.log('Dry-run complete.');
  process.exit(0);
}

let failed = 0;
for (const t of targets) {
  const result = safeRemove(t, { root: projectRoot });
  if (!result.ok && !result.skipped) {
    console.error(`  FAIL ${result.path}: ${result.error}`);
    failed += 1;
  } else if (!result.skipped || result.skipped === 'dry-run') {
    console.log(`  removed ${result.path}`);
  }
}

if (failed) {
  console.error('ACTION REQUIRED: Close processes locking build/cache files, then re-run npm run clean');
  process.exit(1);
}
console.log('Clean complete.');
process.exit(0);
