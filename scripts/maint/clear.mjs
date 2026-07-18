#!/usr/bin/env node
/**
 * npm run clear — remove disposable artifacts (preview first).
 * Flags: --dry-run --all --keep-workspaces --keep-tools --help
 */
import {
  parseClearArgs,
  resolveClearTargets,
  formatTargetList,
} from './lib/clear-targets.mjs';
import { safeRemove } from './lib/paths.mjs';
import { projectRoot } from './lib/platform.mjs';

const flags = parseClearArgs();

if (flags.help) {
  console.log(`Usage: npm run clear -- [options]

Remove generated files, logs, caches, temp uploads/outputs, coverage, build
folders, stale test data, and optional tool caches.

Options:
  --dry-run           Preview only; do not delete
  --all               Also remove full data/, .runtime/, and legacy .tools/ trees
  --keep-workspaces   Do not touch data/ workspace storage
  --keep-tools        Do not remove tool downloads or .tools
  --help              Show this help

Never deletes source code, lockfiles, migrations, tests, docs, or .env.
`);
  process.exit(0);
}

const targets = resolveClearTargets(
  {
    all: flags.all,
    keepWorkspaces: flags.keepWorkspaces,
    keepTools: flags.keepTools,
  },
  projectRoot,
);

const rels = formatTargetList(targets, projectRoot);

console.log('AlphaStudio clear');
console.log(`root: ${projectRoot}`);
console.log(
  `flags: dryRun=${flags.dryRun} all=${flags.all} keepWorkspaces=${flags.keepWorkspaces} keepTools=${flags.keepTools}`,
);
console.log('');
if (rels.length === 0) {
  console.log('Nothing to delete (no matching disposable artifacts).');
  process.exit(0);
}

console.log(`Will ${flags.dryRun ? 'delete (dry-run)' : 'delete'} ${rels.length} path(s):`);
for (const r of rels) {
  console.log(`  - ${r}`);
}
console.log('');

if (flags.dryRun) {
  console.log('Dry-run complete; no files removed.');
  process.exit(0);
}

let failed = 0;
let removed = 0;
for (const t of targets) {
  const result = safeRemove(t, { root: projectRoot, dryRun: false });
  if (result.skipped === 'already absent' || result.skipped === 'protected path') {
    console.log(`  skip ${result.path}${result.skipped ? ` (${result.skipped})` : ''}`);
    continue;
  }
  if (!result.ok) {
    console.error(`  FAIL ${result.path}: ${result.error}`);
    failed += 1;
  } else {
    console.log(`  removed ${result.path}`);
    removed += 1;
  }
}

console.log('');
console.log(`Done. removed=${removed} failed=${failed}`);
if (failed > 0) {
  console.error('ACTION REQUIRED: Fix file locks/permissions and re-run npm run clear');
  process.exit(1);
}
process.exit(0);
