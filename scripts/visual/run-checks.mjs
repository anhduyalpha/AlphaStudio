#!/usr/bin/env node
// npm run visual:checks — deterministic SPEC checks (no browser, no judgment).
// Exit 1 on any FAIL. PENDING = the target files aren't built yet; that is
// honest data, not a pass claim — each pending line names the unit that
// creates the target.
//
// Self-test flags: --styles-dir <d>, --tokens-file <f>.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tokenPurity from './checks/token-purity.mjs';
import motionPurity from './checks/motion-purity.mjs';
import contrast from './checks/contrast.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);

const stylesDir = path.resolve(root, opt('--styles-dir', 'src/styles'));
const tokensFile = args.includes('--tokens-file') ? path.resolve(root, opt('--tokens-file')) : undefined;
// New-UI JSX scope. SPEC governs only the rebuilt client: while src/next
// exists (transitional, pre-F1) the OLD client still lives in src/components
// + src/views and is exempt (F1 deletes it). After the flip (src/next gone,
// src/styles present) the final paths are enforced.
import fs from 'node:fs';
const transitional = fs.existsSync(path.join(root, 'src/next'));
const flipped = !transitional && fs.existsSync(path.join(root, 'src/styles'));
const jsxDirs = (transitional
  ? ['src/next', 'src/workbench']
  : flipped
    ? ['src/components', 'src/views', 'src/workbench']
    : []
).map((d) => path.join(root, d));

const results = [
  tokenPurity({ stylesDir, jsxDirs, root }),
  motionPurity({ stylesDir, jsxDirs, root }),
  contrast({ root, tokensFile }),
];

let failed = 0;
for (const r of results) {
  const tag = r.status === 'pass' ? 'PASS   ' : r.status === 'pending' ? 'PENDING' : 'FAIL   ';
  console.log(`${tag} ${r.name}${r.note ? ` — ${r.note}` : ''}${r.scanned ? ` [${r.scanned} file(s)]` : ''}`);
  for (const v of r.violations) console.log(`         ✗ ${v}`);
  if (r.status === 'fail') failed++;
}
process.exit(failed ? 1 : 0);
