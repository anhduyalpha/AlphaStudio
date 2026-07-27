/**
 * Companion to `styles-tokens.test.ts` (PLAN C1, SPEC §4.6 / §5.3 MUST 2).
 *
 * Two jobs, both discovered by this unit's spec review:
 *
 *  1. **Rules the sibling scan misses.** That file — and the frozen
 *     `scripts/visual/checks/token-purity.mjs` / `motion-purity.mjs` — match a
 *     declaration literally named `font-size`, and their duration regex has a
 *     `.` in its lookbehind. C1 establishes `font: var(--text-meta)` as the
 *     house style, so later units will write `font:` shorthands, and
 *     `font: 500 13px/1.4 Inter` or `transition: opacity .3s` would sail
 *     through every existing check while violating §4.6. Closed here.
 *
 *  2. **The two token sets must never share a document.** `src/styles.css`
 *     (pre-rebuild, still shipping until F1) defines `--text-display`,
 *     `--text-title`, `--text-section`, `--text-body` and `--text-meta` on
 *     `:root` as bare lengths, consumed by 19 `font-size: var(--text-*)`
 *     declarations — and also a translucent `--surface` and the retired cyan
 *     `--focus-ring`. `tokens.css` reuses those exact names with a different
 *     grammar and SPEC's values, at equal specificity, so document order alone
 *     decides and neither order is safe: tokens-first breaks the old client's
 *     `font-size`, styles-last collapses the new client's `font:` shorthand to
 *     a family-less value (UA serif) and silently restores a translucent
 *     `--surface` and a cyan focus ring, both of which §4.1 retires.
 *
 *     No gate can see that: every purity check scans only `src/styles/`, and
 *     there is no new-client baseline yet. So this is a tripwire for D1, which
 *     is the unit that first mounts the new shell — the two import sets must be
 *     mutually exclusive (imports inside the flag branch, or a second entry).
 *     It is a tripwire, not a proof of graph disjointness.
 *
 * This is a separate file because the harness treats an existing test file as
 * immutable, so the sibling could not be extended in place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));
const STYLES_DIR = path.join(SRC_DIR, 'styles');

/* ---------------------------------------------------------------- *
 * 1. §4.6 / §5.3 rules the other scans miss
 * ---------------------------------------------------------------- */

describe('§4.6 purity — rules the sibling scan misses', () => {
  /** A `font` shorthand component that is neither a token nor a CSS-wide keyword. */
  const FONT_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'normal', '']);
  const BOX_ALLOW_RAW = new Set(['0', '1px', '2px', '50%', '100%', '100vh', '100vw', '100dvh', 'auto']);

  const sheets = fs.existsSync(STYLES_DIR)
    ? fs
        .readdirSync(STYLES_DIR)
        .filter((file) => file.endsWith('.css') && file !== 'tokens.css')
        .sort()
    : [];

  it('has stylesheets to scan', () => {
    expect(sheets.length).toBeGreaterThan(0);
  });

  it.each(sheets)('%s uses no un-tokenized font shorthand', (sheet) => {
    const violations: string[] = [];
    fs.readFileSync(path.join(STYLES_DIR, sheet), 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        // `font:` only — `font-size:`/`font-family:` have a '-' where this needs ':'.
        const re = /(?:^|[\s;{])font\s*:\s*([^;]+);/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(line))) {
          const leftovers = match[1]
            .replace(/var\([^()]*\)/g, ' ')
            .replace(/[/,]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter((part) => part && !FONT_KEYWORDS.has(part));
          if (leftovers.length) {
            violations.push(`${sheet}:${index + 1} un-tokenized font shorthand: ${leftovers.join(' ')}`);
          }
        }
      });
    expect(violations).toEqual([]);
  });

  it.each(sheets)('%s uses no literal duration, including leading-dot forms', (sheet) => {
    // The frozen checks' lookbehind contains '.', so `.3s` escapes them.
    const duration = /(?<![\w#-])(?:\d+(?:\.\d+)?|\.\d+)m?s\b/;
    const violations: string[] = [];
    fs.readFileSync(path.join(STYLES_DIR, sheet), 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (duration.test(line) && !/@media/.test(line)) {
          violations.push(`${sheet}:${index + 1} literal duration: ${line.trim()}`);
        }
      });
    expect(violations).toEqual([]);
  });

  it.each(sheets)('%s tokenizes every box declaration on a line, not just the first', (sheet) => {
    const violations: string[] = [];
    fs.readFileSync(path.join(STYLES_DIR, sheet), 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (/@media/.test(line)) return;
        const re = /(?:^|[\s;{])(margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;]+);/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(line))) {
          const values = match[2]
            .replace(/var\(--space-\d\)/g, '')
            .replace(/calc\([^)]*\)/g, '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          if (values.some((value) => !BOX_ALLOW_RAW.has(value) && !value.startsWith('var(--'))) {
            violations.push(`${sheet}:${index + 1} un-tokenized ${match[1]}: ${match[2].trim()}`);
          }
        }
      });
    expect(violations).toEqual([]);
  });

  it('actually rejects the shapes the frozen checks let through', () => {
    // Non-vacuity: the two matchers above, applied to the exact strings that
    // pass token-purity.mjs and motion-purity.mjs.
    const fontRe = /(?:^|[\s;{])font\s*:\s*([^;]+);/;
    const bad = '  .btn-sm { font: 500 13px/1.4 Inter, sans-serif; }';
    const parts = (fontRe.exec(bad)?.[1] ?? '')
      .replace(/var\([^()]*\)/g, ' ')
      .replace(/[/,]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((p) => p && !FONT_KEYWORDS.has(p));
    expect(parts.length).toBeGreaterThan(0);

    const duration = /(?<![\w#-])(?:\d+(?:\.\d+)?|\.\d+)m?s\b/;
    expect(duration.test('transition: opacity .3s ease;')).toBe(true);
    expect(duration.test('transition: opacity 0.3s ease;')).toBe(true);
    expect(duration.test('transition: color var(--duration-fast) var(--ease-standard);')).toBe(false);
  });
});

/* ---------------------------------------------------------------- *
 * 2. The pre-rebuild and rebuild token sets never share a document
 * ---------------------------------------------------------------- */

describe('the pre-rebuild and rebuild token sets never share a document', () => {
  /** Every source module under src/, excluding the test tree itself. */
  function sourceFiles(): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      const holder = entry as unknown as { parentPath?: string; path?: string };
      const parent = holder.parentPath ?? holder.path ?? SRC_DIR;
      const full = path.join(parent, entry.name);
      // Tests mention both paths as strings; they import neither.
      if (/[\\/]tests[\\/]/.test(full) || /\.test\.[jt]sx?$/.test(full)) continue;
      out.push(full);
    }
    return out;
  }

  const OLD_SHEET = /(?:import|from)\s+['"][^'"]*(?:^|\/|\.\/)?styles\.css['"]/;
  const NEW_SHEET = /(?:import|from)\s+['"][^'"]*styles\/(?:tokens|base)\.css['"]/;

  it('no module imports both stylesheet sets', () => {
    const both: string[] = [];
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      if (OLD_SHEET.test(src) && NEW_SHEET.test(src)) {
        both.push(path.relative(SRC_DIR, file));
      }
    }
    // If this fails, the two :root blocks are cascading over each other and the
    // rendered result depends on import order — see the header for why neither
    // order is safe. Split them across the entry flag instead.
    expect(both).toEqual([]);
  });

  it('scans a non-empty set of modules, and the matchers work', () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
    expect(OLD_SHEET.test("import './styles.css';")).toBe(true);
    expect(NEW_SHEET.test("import './styles/tokens.css';")).toBe(true);
    expect(NEW_SHEET.test("import './styles/base.css';")).toBe(true);
    // The old-sheet matcher must not fire on the new paths.
    expect(OLD_SHEET.test("import './styles/tokens.css';")).toBe(false);
    expect(OLD_SHEET.test("import './styles/base.css';")).toBe(false);
  });
});
