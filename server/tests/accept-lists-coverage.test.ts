/**
 * S2 (SPEC §3.5) coverage — the published accept lists must account for EVERY
 * extension the detector knows. AUDIT PR-4 asks for exactly this: "assert every
 * `detect.ts` extension maps into a published list/category", so a format added
 * to the detector without a home in the published contract fails here rather
 * than silently becoming an input the client can never offer.
 *
 * Pure module-level test — no server boot, so it stays cheap in the serial suite.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFamily, publishedAcceptLists } from '../src/convert/formats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

function detectExtensions(): string[] {
  const src = fs.readFileSync(path.join(serverRoot, 'src/convert/detect.ts'), 'utf8');
  const start = src.indexOf('const EXT_FAMILY');
  assert.ok(start >= 0, 'EXT_FAMILY table present in detect.ts');
  const block = src.slice(start, src.indexOf('\n};', start));
  const found = [...block.matchAll(/'(\.[a-z0-9]+)':/g)].map((m) => m[1]);
  assert.ok(found.length >= 50, `parsed ${found.length} extensions (expected the full table)`);
  return found;
}

describe('S2 accept-list coverage', () => {
  it('every detect.ts extension appears in at least one published accept list', () => {
    const { lists } = publishedAcceptLists();
    const covered = new Set<string>();
    for (const list of Object.values(lists)) for (const ext of list.extensions) covered.add(ext);
    const orphans = detectExtensions().filter((ext) => !covered.has(ext));
    assert.deepEqual(
      orphans,
      [],
      `extensions the detector accepts but no published list offers:\n  ${orphans.join('\n  ')}`,
    );
  });

  it('every published list extension is a format the table knows', () => {
    const { lists } = publishedAcceptLists();
    const unknown: string[] = [];
    for (const [id, list] of Object.entries(lists)) {
      for (const ext of list.extensions) {
        if (formatFamily(ext) === 'unknown') unknown.push(`${id}: ${ext}`);
      }
    }
    assert.deepEqual(unknown, [], `published extensions with no format definition:\n  ${unknown.join('\n  ')}`);
  });

  it('each list only advertises extensions from its own families', () => {
    const { lists } = publishedAcceptLists();
    const mismatched: string[] = [];
    for (const [id, list] of Object.entries(lists)) {
      for (const ext of list.extensions) {
        const family = formatFamily(ext);
        if (!list.families.includes(family)) {
          mismatched.push(`${id}: ${ext} is ${family}, list covers ${list.families.join('/')}`);
        }
      }
    }
    assert.deepEqual(mismatched, [], `list/family mismatch:\n  ${mismatched.join('\n  ')}`);
  });
});
