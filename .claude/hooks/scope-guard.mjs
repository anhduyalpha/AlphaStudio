#!/usr/bin/env node
// PreToolUse scope guard for Write/Edit/NotebookEdit.
// Reads the hook JSON from stdin; exits 2 (block, stderr shown to the model)
// when the target path violates the current unit's write scope.
//
// Rules, in order:
//   1. Paths outside the repo root (scratchpad, temp) are allowed.
//   2. fixtures/pdf/** is always blocked (sha256-pinned; never hand-edit).
//   3. An EXISTING test file is always blocked — test files may be created,
//      never modified or deleted. (Creation still needs rule 4.)
//   4. Hardcoded always-allow: PROGRESS.md, .claude/allowed-paths.txt, logs/.
//   5. Otherwise the path must match an entry in .claude/allowed-paths.txt
//      (one entry per line; '#' comments; 'dir/' prefix, '*'/'**' globs, or
//      exact file). If that file does not exist the guard is DISARMED
//      (allow-all except rules 2–3) so ad-hoc sessions aren't bricked;
//      /next-unit rewrites it per unit, so harness runs are always armed.

import fs from 'node:fs';
import path from 'node:path';

function deny(msg) {
  process.stderr.write(`scope-guard: ${msg}\n`);
  process.exit(2);
}

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // unparseable stdin: never wedge the session on guard bugs
}

const toolName = input.tool_name || '';
if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) process.exit(0);

const ti = input.tool_input || {};
const target = ti.file_path || ti.notebook_path;
if (!target) process.exit(0);

const repoRoot = path.resolve(input.cwd || process.cwd());
const abs = path.resolve(repoRoot, target);
const relRaw = path.relative(repoRoot, abs);
if (relRaw.startsWith('..') || path.isAbsolute(relRaw)) process.exit(0); // outside repo
const rel = relRaw.split(path.sep).join('/');

// Rule 2: pinned fixtures — block unconditionally.
if (/(^|\/)fixtures\/pdf\//.test(rel)) {
  deny(`"${rel}" is a sha256-pinned fixture (fixtures/pdf). Change scripts/test/generate-pdf-fixtures.mjs and run "npm run fixtures:pdf" instead.`);
}

// Rule 3: existing test files — block unconditionally.
const isTestFile =
  /(^|\/)server\/tests\//.test(rel) ||
  /(^|\/)python\/tests\//.test(rel) ||
  /(^|\/)e2e\/.*\.spec\.(js|mjs|ts)$/.test(rel) ||
  /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/.test(rel);
if (isTestFile && fs.existsSync(abs)) {
  deny(`"${rel}" is an existing test file. Test files may be created, never modified or deleted. If a test is wrong, that is a BLOCKED condition — record it in PROGRESS.md.`);
}

// Rule 4: bookkeeping paths the harness itself must always reach.
const ALWAYS_ALLOW = ['PROGRESS.md', '.claude/allowed-paths.txt'];
if (ALWAYS_ALLOW.includes(rel) || rel.startsWith('logs/')) process.exit(0);

// Rule 5: allowed-paths.txt.
const listPath = path.join(repoRoot, '.claude', 'allowed-paths.txt');
if (!fs.existsSync(listPath)) process.exit(0); // disarmed

const entries = fs
  .readFileSync(listPath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.replace(/\\/g, '/').replace(/^\.\//, ''));

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

const allowed = entries.some((entry) => {
  if (entry.endsWith('/')) return rel === entry.slice(0, -1) || rel.startsWith(entry);
  if (entry.includes('*')) return globToRegex(entry).test(rel);
  return rel === entry || rel.startsWith(entry + '/');
});

if (!allowed) {
  deny(
    `"${rel}" is outside the current unit's declared scope (.claude/allowed-paths.txt). ` +
      `If the unit genuinely needs this file, that is a scope problem: stop and report BLOCKED or SPLIT instead of widening scope silently.`
  );
}
process.exit(0);
