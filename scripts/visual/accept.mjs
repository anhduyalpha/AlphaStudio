#!/usr/bin/env node
// npm run visual:accept -- <id> [<id> ...]
// Promotes captures to baselines, APPEND-ONLY: an existing baseline is never
// overwritten or deleted by this script, and there is deliberately no --force.
// Replacing or removing an existing baseline is a human act performed outside
// the agent harness (the PreToolUse hooks deny agent writes to the dir).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const capDir = path.join(root, 'visual', 'captures');
const baseDir = path.join(root, 'visual', 'baselines');

const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!ids.length) {
  console.error('usage: npm run visual:accept -- <capture-id> [...]   (id = filename without .png)');
  process.exit(1);
}

fs.mkdirSync(baseDir, { recursive: true });
let added = 0, refused = 0, absent = 0;
for (const id of ids) {
  const name = id.endsWith('.png') ? id : `${id}.png`;
  const src = path.join(capDir, name);
  const dst = path.join(baseDir, name);
  if (!fs.existsSync(src)) { console.error(`  absent capture: ${name}`); absent++; continue; }
  if (fs.existsSync(dst)) { console.error(`  REFUSED (baseline exists, append-only): ${name}`); refused++; continue; }
  fs.copyFileSync(src, dst);
  console.log(`  accepted: ${name}`);
  added++;
}
console.log(`[visual:accept] added=${added} refused=${refused} absent=${absent}`);
process.exit(refused || absent ? 1 : 0);
