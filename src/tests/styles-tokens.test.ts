/**
 * Structural tests for the design tokens (PLAN C1; SPEC §4.1, §4.5, §5.2, §4.6).
 *
 * Two properties are pinned here, and they are the two the rest of Track C
 * builds on top of:
 *
 *  1. **The token tables are complete and exact.** SPEC §4.1/§4.5/§5.2 are
 *     normative *value* tables, not just name lists — a stylesheet that reads
 *     `var(--text-2)` gets the wrong grey if the value drifts, and nothing
 *     downstream would notice. So the tables are transcribed here and compared
 *     literally. Every theme-varying §4.1 token must be redefined in the light
 *     block: a token that silently cascades from the dark default renders a
 *     dark colour on a light surface.
 *
 *  2. **§4.6 purity holds for every non-token stylesheet.** `tokens.css` is the
 *     only definition site; every other file under `src/styles/` may reference
 *     tokens but may not carry colour, timing, radius, type or spacing
 *     literals. `npm run visual:checks` enforces the same rule, but the client
 *     suite must catch a violation on its own — the visual harness needs a
 *     browser and is not what a unit runs first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = fileURLToPath(new URL('../styles/', import.meta.url));
const TOKENS_CSS = fs.readFileSync(path.join(STYLES_DIR, 'tokens.css'), 'utf8');

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of every rule whose selector satisfies `match`. */
function declarations(css: string, match: (selector: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rule: RegExpExecArray | null;
  while ((rule = ruleRe.exec(stripComments(css)))) {
    if (!match(rule[1].trim())) continue;
    const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(rule[2]))) out[decl[1]] = decl[2].trim().replace(/\s+/g, ' ');
  }
  return out;
}

const dark = declarations(TOKENS_CSS, (s) => /(^|,)\s*:root\s*(,|$)/.test(s) || /data-theme=['"]?dark/.test(s));
const light = declarations(TOKENS_CSS, (s) => /data-theme=['"]?light/.test(s));

/** SPEC §4.1, dark column. */
const DARK_COLORS: Record<string, string> = {
  '--bg': '#070911',
  '--bg-raised': '#0d1020',
  '--surface': '#101422',
  '--surface-2': '#151a2c',
  '--border': 'rgba(255, 255, 255, 0.08)',
  '--border-strong': 'rgba(255, 255, 255, 0.14)',
  '--text': '#f7f8fc',
  '--text-2': '#a7b0c2',
  '--text-3': '#717b90',
  '--accent': '#9b7cff',
  '--accent-hover': '#ab90ff',
  '--accent-active': '#8a68f5',
  '--accent-soft': 'rgba(155, 124, 255, 0.14)',
  '--on-accent': '#ffffff',
  '--live': '#49dbe8',
  '--live-soft': 'rgba(73, 219, 232, 0.12)',
  '--success': '#43d99b',
  '--warning': '#f4bd5e',
  '--danger': '#ff7188',
  '--focus-ring': 'rgba(155, 124, 255, 0.85)',
  '--glass-bg': 'rgba(13, 17, 29, 0.72)',
  '--glass-border': 'rgba(255, 255, 255, 0.1)',
  '--shadow-1': '0 10px 28px rgba(0, 0, 0, 0.18)',
  '--shadow-2': '0 18px 48px rgba(0, 0, 0, 0.26)',
};

/** SPEC §4.1, light column. */
const LIGHT_COLORS: Record<string, string> = {
  '--bg': '#f3f6fb',
  '--bg-raised': '#eaf0fa',
  '--surface': '#ffffff',
  '--surface-2': '#f0f3fa',
  '--border': 'rgba(15, 23, 42, 0.08)',
  '--border-strong': 'rgba(15, 23, 42, 0.14)',
  '--text': '#111827',
  '--text-2': '#475569',
  '--text-3': '#6b7280',
  '--accent': '#5f3fe4',
  '--accent-hover': '#4f32c9',
  '--accent-active': '#462cb4',
  '--accent-soft': 'rgba(95, 63, 228, 0.1)',
  '--on-accent': '#ffffff',
  '--live': '#0891b2',
  '--live-soft': 'rgba(8, 145, 178, 0.1)',
  '--success': '#0f9d6b',
  '--warning': '#b45309',
  '--danger': '#dc2626',
  '--focus-ring': 'rgba(95, 63, 228, 0.8)',
  '--glass-bg': 'rgba(255, 255, 255, 0.78)',
  '--glass-border': 'rgba(15, 23, 42, 0.1)',
  '--shadow-1': '0 10px 28px rgba(50, 65, 90, 0.08)',
  '--shadow-2': '0 18px 48px rgba(50, 65, 90, 0.12)',
};

/** The §4.1 rows the table marks identical in both themes. */
const THEME_INDEPENDENT_COLORS: Record<string, string> = {
  '--glass-blur': '18px',
  '--gradient-brand': 'linear-gradient(135deg, #9b7cff 0%, #5d8dff 100%)',
};

/** SPEC §4.5 non-color tokens. */
const NON_COLOR: Record<string, string> = {
  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-5': '1.5rem',
  '--space-6': '2rem',
  '--space-7': '3rem',
  '--radius-xs': '8px',
  '--radius-sm': '12px',
  '--radius-md': '16px',
  '--radius-lg': '20px',
  '--radius-pill': '999px',
  '--z-rail': '10',
  '--z-drawer': '30',
  '--z-palette': '40',
  '--z-modal': '50',
  '--z-toast': '60',
  '--sidebar-width': '248px',
  '--topbar-height': '64px',
  '--rail-width': '320px',
  '--runbar-height': '64px',
};

/** SPEC §4.5 type scale: size / line-height / weight per step. */
const TYPE_STEPS: Record<string, { size: string; line: string; weight: string }> = {
  display: { size: '1.75rem', line: '1.2', weight: '650' },
  title: { size: '1.375rem', line: '1.25', weight: '600' },
  section: { size: '1.0625rem', line: '1.4', weight: '600' },
  body: { size: '0.9375rem', line: '1.5', weight: '400' },
  meta: { size: '0.8125rem', line: '1.4', weight: '500' },
  code: { size: '0.875rem', line: '1.5', weight: '400' },
};

/** SPEC §5.2 timing tokens. */
const TIMING: Record<string, string> = {
  '--duration-fast': '150ms',
  '--duration-base': '220ms',
  '--duration-slow': '320ms',
  '--duration-ambient': '2600ms',
  '--duration-toast': '2600ms',
  '--ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--ease-standard': 'cubic-bezier(0.22, 1, 0.36, 1)',
  '--ease-in-out': 'cubic-bezier(0.45, 0, 0.55, 1)',
};

describe('tokens.css — SPEC §4.1 color table', () => {
  it.each(Object.entries(DARK_COLORS))('dark %s', (token, value) => {
    expect(dark[token]).toBe(value);
  });

  it.each(Object.entries(LIGHT_COLORS))('light %s', (token, value) => {
    expect(light[token]).toBe(value);
  });

  it.each(Object.entries(THEME_INDEPENDENT_COLORS))('%s is defined once for both themes', (token, value) => {
    expect(dark[token]).toBe(value);
    expect(light[token]).toBeUndefined();
  });

  it('redefines every theme-varying token in the light block', () => {
    // A token missing here does not fall back to a light value — it inherits
    // the dark one and renders a dark colour on a light surface.
    const missing = Object.keys(DARK_COLORS).filter((token) => !(token in light));
    expect(missing).toEqual([]);
  });
});

describe('tokens.css — SPEC §4.5 non-color tokens', () => {
  it.each(Object.entries(NON_COLOR))('%s', (token, value) => {
    expect(dark[token]).toBe(value);
  });

  it('defines the Inter and mono stacks', () => {
    expect(dark['--font-sans']).toMatch(/^Inter,/);
    expect(dark['--font-mono']).toMatch(/monospace$/);
  });

  it.each(Object.entries(TYPE_STEPS))('type step %s publishes size, line-height and weight', (step, spec) => {
    expect(dark[`--text-${step}-size`]).toBe(spec.size);
    expect(dark[`--text-${step}-line`]).toBe(spec.line);
    expect(dark[`--text-${step}-weight`]).toBe(spec.weight);
  });

  it.each(Object.keys(TYPE_STEPS))('type step %s composes its shorthand from those parts', (step) => {
    // Composed, never re-typed: the literals live in exactly one place.
    expect(dark[`--text-${step}`]).toBe(
      `var(--text-${step}-weight) var(--text-${step}-size) / var(--text-${step}-line) ` +
        `var(--font-${step === 'code' ? 'mono' : 'sans'})`,
    );
  });

  it('defines exactly six type steps', () => {
    const steps = new Set(
      Object.keys(dark)
        .map((token) => /^--text-([a-z]+)(-size|-line|-weight)?$/.exec(token))
        .filter((m): m is RegExpExecArray => Boolean(m))
        .map((m) => m[1])
        .filter((step) => !/^\d+$/.test(step)),
    );
    expect([...steps].sort()).toEqual(Object.keys(TYPE_STEPS).sort());
  });
});

describe('tokens.css — SPEC §5.2 timing tokens', () => {
  it.each(Object.entries(TIMING))('%s', (token, value) => {
    expect(dark[token]).toBe(value);
  });

  it('defines no easing curve beyond the three §5.2 names', () => {
    const eases = Object.keys(dark).filter((token) => token.startsWith('--ease'));
    expect(eases.sort()).toEqual(['--ease-in-out', '--ease-out', '--ease-standard']);
  });
});

describe('§4.6 token purity — every stylesheet except tokens.css', () => {
  const ALLOW_RAW = new Set([
    '0',
    '1px',
    '2px',
    '50%',
    '100%',
    '100vh',
    '100vw',
    '100dvh',
    'auto',
    'transparent',
    'currentColor',
    'inherit',
    'initial',
    'unset',
    'none',
  ]);

  const sheets = fs
    .readdirSync(STYLES_DIR)
    .filter((file) => file.endsWith('.css') && file !== 'tokens.css')
    .sort();

  it('finds stylesheets to check', () => {
    // Guards against the scan silently passing because it looked at nothing.
    expect(sheets.length).toBeGreaterThan(0);
  });

  it.each(sheets)('%s carries no design literals', (sheet) => {
    const violations: string[] = [];
    fs.readFileSync(path.join(STYLES_DIR, sheet), 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        const at = `${sheet}:${index + 1}`;
        const push = (what: string) => violations.push(`${at} ${what}: ${line.trim()}`);

        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) push('hex color literal');
        if (/\b(rgba?|hsla?)\s*\(/.test(line)) push('color function literal');
        if (/cubic-bezier\s*\(/.test(line)) push('literal easing curve');
        if (/(?<![\w.#-])\d+(\.\d+)?m?s\b/.test(line) && !/@media/.test(line)) push('literal duration');

        const radius = /border-radius\s*:\s*([^;]+);/.exec(line);
        if (radius && !/var\(--radius/.test(radius[1]) && !ALLOW_RAW.has(radius[1].trim())) {
          push('un-tokenized border-radius');
        }

        const size = /font-size\s*:\s*([^;]+);/.exec(line);
        if (size && !/var\(--text/.test(size[1]) && !ALLOW_RAW.has(size[1].trim())) {
          push('un-tokenized font-size');
        }

        const box = /(?:^|[\s;{])(margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;]+);/.exec(line);
        if (box && !/@media/.test(line)) {
          const values = box[2]
            .replace(/var\(--space-\d\)/g, '')
            .replace(/calc\([^)]*\)/g, '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          if (values.some((value) => !ALLOW_RAW.has(value) && !value.startsWith('var(--'))) {
            push(`un-tokenized ${box[1]}`);
          }
        }
      });

    expect(violations).toEqual([]);
  });
});
