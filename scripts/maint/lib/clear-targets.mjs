/**
 * Resolve allowlisted disposable paths for clean / clear.
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './platform.mjs';
import { assertUnderRoot, isProtectedPath, toRelPosix } from './paths.mjs';

/**
 * Parse argv flags for clear.
 * @param {string[]} argv
 */
export function parseClearArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes('--dry-run'),
    all: argv.includes('--all'),
    keepWorkspaces: argv.includes('--keep-workspaces'),
    keepTools: argv.includes('--keep-tools'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

/**
 * Paths removed by `clean` only: build, cache, logs, coverage, temp (not workspaces/tools/data).
 * @returns {string[]} absolute paths that currently exist
 */
export function resolveCleanTargets(root = projectRoot) {
  const candidates = [
    'dist',
    'server/dist',
    'coverage',
    'server/coverage',
    '.nyc_output',
    'node_modules/.cache',
    'server/node_modules/.cache',
    '.cache',
    '.vite',
    'server/.vite',
    'logs',
    'tmp',
    'temp',
    'data/temp',
    'data-test/temp',
    'data-test-converter/temp',
  ];
  // log files at root
  const abs = [];
  for (const rel of candidates) {
    try {
      const p = assertUnderRoot(rel, root);
      if (fs.existsSync(p) && !isProtectedPath(p, root)) abs.push(p);
    } catch {
      /* skip */
    }
  }
  // *.log at root and server
  for (const dir of [root, path.join(root, 'server')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.log')) {
        const p = path.join(dir, name);
        if (!isProtectedPath(p, root)) abs.push(p);
      }
    }
  }
  return uniqueExisting(abs);
}

/**
 * Full clear targets: clean + data artifacts + test data + optional tools.
 * @param {{ all?: boolean, keepWorkspaces?: boolean, keepTools?: boolean }} opts
 */
export function resolveClearTargets(opts = {}, root = projectRoot) {
  const {
    all = false,
    keepWorkspaces = false,
    keepTools = false,
  } = opts;

  const targets = new Set(resolveCleanTargets(root));

  // Generated build always
  for (const rel of ['dist', 'server/dist', 'coverage', 'server/coverage']) {
    addIfExists(targets, rel, root);
  }

  // Test data trees (always disposable)
  try {
    for (const name of fs.readdirSync(root)) {
      if (/^data-test/.test(name) || name === 'data-smoke') {
        addIfExists(targets, name, root);
      }
    }
  } catch {
    /* ignore */
  }

  // Runtime data subdirs (uploads/outputs/temp) — keep active workspace DB unless --all
  if (!keepWorkspaces) {
    if (all) {
      addIfExists(targets, 'data', root);
    } else {
      for (const rel of ['data/uploads', 'data/outputs', 'data/temp']) {
        addIfExists(targets, rel, root);
      }
      // Stale DB copies outside active data/ (test dbs already covered)
      for (const rel of ['data/alphastudio.db-journal']) {
        addIfExists(targets, rel, root);
      }
    }
  }

  // Project-local tools downloads / unused extract dirs (.runtime + legacy .tools)
  if (!keepTools) {
    if (all) {
      addIfExists(targets, '.runtime', root);
      addIfExists(targets, '.tools', root);
    } else {
      // Keep installed tools; remove only download caches and extract staging
      for (const rel of [
        '.runtime/downloads',
        '.runtime/tmp',
        '.runtime/cache',
        '.tools/downloads',
        '.tools/ffmpeg-extract',
        '.tools/pandoc-extract',
        '.tools/libreoffice-extract',
      ]) {
        addIfExists(targets, rel, root);
      }
      for (const toolsBase of [path.join(root, '.runtime'), path.join(root, '.tools')]) {
        if (fs.existsSync(toolsBase)) {
          walkNamed(toolsBase, (full, name) => {
            if (name === 'downloads' || name.endsWith('-extract') || name === 'tmp') {
              if (!isProtectedPath(full, root)) targets.add(full);
            }
          });
        }
      }
    }
  }

  // terminals session junk if present
  addIfExists(targets, 'terminals', root);

  return uniqueExisting([...targets]).filter((p) => !isProtectedPath(p, root));
}

function addIfExists(set, rel, root) {
  try {
    const p = assertUnderRoot(rel, root);
    if (fs.existsSync(p) && !isProtectedPath(p, root)) set.add(p);
  } catch {
    /* skip */
  }
}

function uniqueExisting(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    const n = path.resolve(p);
    if (seen.has(n)) continue;
    seen.add(n);
    if (fs.existsSync(n)) out.push(n);
  }
  // Prefer deleting deeper paths first when both parent and child listed — but
  // for preview we sort by path length desc so parents listed after children.
  return out.sort((a, b) => b.length - a.length);
}

function walkNamed(dir, fn, depth = 0) {
  if (depth > 6) return;
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      fn(full, ent.name);
      walkNamed(full, fn, depth + 1);
    }
  }
}

/** Human preview lines (relative). */
export function formatTargetList(absPaths, root = projectRoot) {
  return absPaths.map((p) => toRelPosix(p, root) || path.basename(p));
}
