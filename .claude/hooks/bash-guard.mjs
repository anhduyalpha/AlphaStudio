#!/usr/bin/env node
// PreToolUse guard for Bash/PowerShell commands. Exit 2 = block.
// Enforces, unconditionally:
//   1. main is frozen: no push that targets main (explicit refspec or
//      implicit push while on main), no commit/merge/rebase/cherry-pick/
//      reset/revert while HEAD is main. Integration happens on `rebuild`.
//   2. No force-push of main or rebuild.
//   3. visual/baselines/** is append-only via `npm run visual:accept`:
//      shell commands may reference the dir only read-only (or `git add`).
//   4. scripts/visual/config.mjs (thresholds) is read-only for commands.
// Heuristic string matching — documented residual risk, not a sandbox.

import fs from 'node:fs';
import { execSync } from 'node:child_process';

function deny(msg) {
  process.stderr.write(`bash-guard: ${msg}\n`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const cmd = String(input?.tool_input?.command || '');
if (!cmd) process.exit(0);
const cwd = input.cwd || process.cwd();
const flat = cmd.replace(/\s+/g, ' ').trim();

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

// --- rule 1a: git push targeting main ---
if (/\bgit\b[^|;&]*\bpush\b/.test(flat)) {
  if (/(^|[\s:\/])main(\s|$|:)/.test(flat)) deny('push targets main. main is frozen — merge to `rebuild`; only the final human-approved PR lands on main.');
  // implicit push (no refspec after remote) while on main
  const pushArgs = flat.replace(/.*\bpush\b/, '').trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
  if (pushArgs.length <= 1 && currentBranch() === 'main') deny('implicit `git push` while on main. main is frozen — work happens on `rebuild`.');
  // rule 2: force-push of protected branches
  if (/(--force|--force-with-lease|\s-f\b)/.test(flat) && /\b(main|rebuild)\b/.test(flat)) deny('force-push of a protected branch (main/rebuild).');
}

// --- rule 1b: history-mutating git commands while on main ---
if (/\bgit\b[^|;&]*\b(commit|merge|rebase|cherry-pick|reset|revert|commit-tree)\b/.test(flat)) {
  if (currentBranch() === 'main') deny('git history mutation while on main. main stays the last known-good state — checkout `rebuild` first.');
}
if (/\bgit\b[^|;&]*\bbranch\b[^|;&]*(-D|-d|--delete)[^|;&]*\bmain\b/.test(flat)) deny('deleting main.');

// --- rules 3/4: protected visual-verification paths ---
const READONLY_PREFIX = /^(git (status|diff|log|show|add|ls-files)\b|ls\b|dir\b|type\b|cat\b|findstr\b|grep\b|node --check\b|Get-ChildItem\b|Get-Content\b|Test-Path\b|Select-String\b)/i;
if (/visual[\\\/]baselines/i.test(flat) && !READONLY_PREFIX.test(flat)) {
  deny('command touches visual/baselines. Baselines are append-only via `npm run visual:accept -- <id>`; existing baselines are never modified or deleted by the agent.');
}
if (/scripts[\\\/]visual[\\\/]config\.mjs/i.test(flat) && !READONLY_PREFIX.test(flat)) {
  deny('command touches scripts/visual/config.mjs (visual thresholds). Thresholds are frozen for agent runs — a failing threshold is a finding, not a knob.');
}

process.exit(0);
