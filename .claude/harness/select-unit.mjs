#!/usr/bin/env node
// Deterministic unit selection over PROGRESS.md.
// Usage: node .claude/harness/select-unit.mjs [--file <path-to-PROGRESS.md>]
//
// Prints one of:
//   NEXT <n> <unit> <name>        — lowest-numbered `todo` whose deps are all `done`
//   ALL-DONE                      — no `todo` units remain
//   STALLED <reason>              — `todo` units remain but none is eligible
// followed by a JSON detail line. Exit code 0 in every parsed case.

import fs from 'node:fs';

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const file = fileIdx !== -1 ? args[fileIdx + 1] : 'PROGRESS.md';

const text = fs.readFileSync(file, 'utf8');
const rows = [];
for (const line of text.split(/\r?\n/)) {
  const t = line.trim();
  if (!t.startsWith('|')) continue;
  const cells = t.split('|').map((c) => c.trim());
  // cells[0] and last are empty (leading/trailing pipes)
  const c = cells.slice(1, -1);
  if (c.length < 7 || !/^\d+$/.test(c[0])) continue;
  const deps = [];
  const depField = c[6] || '';
  if (depField && depField !== '—' && depField !== '-') {
    for (const part of depField.split(',').map((p) => p.trim())) {
      const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        for (let i = Number(range[1]); i <= Number(range[2]); i++) deps.push(i);
      } else if (/^\d+$/.test(part)) {
        deps.push(Number(part));
      }
    }
  }
  rows.push({
    number: Number(c[0]),
    unit: c[1],
    name: c[2],
    status: c[3].toLowerCase(),
    branch: c[4],
    commit: c[5],
    deps,
    notes: c[7] || '',
  });
}

if (rows.length === 0) {
  console.error(`select-unit: no parseable rows in ${file}`);
  process.exit(1);
}

const byNumber = new Map(rows.map((r) => [r.number, r]));
const todos = rows.filter((r) => r.status === 'todo').sort((a, b) => a.number - b.number);

if (todos.length === 0) {
  console.log('ALL-DONE');
  console.log(
    JSON.stringify({
      result: 'all-done',
      counts: count(rows),
    })
  );
  process.exit(0);
}

const eligible = todos.find((r) =>
  r.deps.every((d) => (byNumber.get(d) || {}).status === 'done')
);

if (eligible) {
  console.log(`NEXT ${eligible.number} ${eligible.unit} ${eligible.name}`);
  console.log(JSON.stringify({ result: 'next', pick: eligible, counts: count(rows) }));
} else {
  const blockers = todos.map((r) => ({
    number: r.number,
    unit: r.unit,
    waitingOn: r.deps.filter((d) => (byNumber.get(d) || {}).status !== 'done'),
  }));
  console.log('STALLED no todo unit has all dependencies done (blocked or in-progress deps)');
  console.log(JSON.stringify({ result: 'stalled', blockers, counts: count(rows) }));
}

function count(all) {
  const c = { todo: 0, 'in-progress': 0, done: 0, blocked: 0, manual: 0 };
  for (const r of all) if (c[r.status] !== undefined) c[r.status]++;
  return c;
}
