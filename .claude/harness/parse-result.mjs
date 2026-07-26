#!/usr/bin/env node
// Extract the final result text from a `claude -p --output-format stream-json`
// log. Prints ONLY the final assistant result text, so sentinel scanning
// (DONE/ALL-DONE/BLOCKED/SPLIT) can't false-positive on skill instructions or
// tool output earlier in the stream.
//
// Usage: node .claude/harness/parse-result.mjs <logfile>
// Exit 0: result found and printed. Exit 3: no result event in the log.

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: parse-result.mjs <logfile>');
  process.exit(1);
}

let last = null;
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t.startsWith('{')) continue;
  let obj;
  try {
    obj = JSON.parse(t);
  } catch {
    continue;
  }
  if (obj && obj.type === 'result') last = obj;
}

if (!last) {
  console.error('parse-result: no result event found (run likely died mid-stream)');
  process.exit(3);
}

if (last.is_error) console.error(`parse-result: result flagged is_error (subtype=${last.subtype || '?'})`);
process.stdout.write(String(last.result ?? '') + '\n');
