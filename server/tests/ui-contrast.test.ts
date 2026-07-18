/**
 * Style/contrast unit checks against the shipped CSS (styles.css + animation barrel).
 * Asserts theme tokens and critical control rules resolve to non-transparent,
 * non-zero-opacity readable colors in dark and light themes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const stylesPath = path.join(root, 'src', 'styles.css');
const motionPath = path.join(root, 'src', 'animations', 'motion-modes.css');
const shellPath = path.join(root, 'src', 'animations', 'shell.css');

function read(p: string) {
  return fs.readFileSync(p, 'utf8');
}

/** Extract a CSS custom property value from a block. */
function tokenInBlock(css: string, blockSelector: string, token: string): string | null {
  // Find block starting at selector { ... }
  const re = new RegExp(
    `${blockSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]+)\\}`,
    'm',
  );
  const m = css.match(re);
  if (!m) return null;
  const prop = m[1].match(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`));
  return prop ? prop[1].trim() : null;
}

function isTransparent(value: string): boolean {
  const v = value.toLowerCase().replace(/\s+/g, '');
  return v === 'transparent' || v === 'rgba(0,0,0,0)' || v === 'rgba(255,255,255,0)' || v === 'hsla(0,0%,0%,0)';
}

function isSolidReadableColor(value: string): boolean {
  if (!value || isTransparent(value)) return false;
  if (value.startsWith('var(')) return true; // theme token reference
  if (value.startsWith('#')) return value.length >= 4;
  if (value.startsWith('rgb') || value.startsWith('hsl')) {
    // reject fully transparent alpha
    const alpha = value.match(/,\s*([01]?\.?\d+)\s*\)$/);
    if (alpha && Number(alpha[1]) === 0) return false;
    return true;
  }
  return false;
}

describe('shipped CSS theme tokens', () => {
  const css = read(stylesPath);

  it('dark :root defines readable text tokens', () => {
    // :root is first block
    const text = tokenInBlock(css, ':root', '--text');
    const secondary = tokenInBlock(css, ':root', '--text-secondary');
    const muted = tokenInBlock(css, ':root', '--text-muted');
    assert.ok(text && isSolidReadableColor(text), `dark --text: ${text}`);
    assert.ok(secondary && isSolidReadableColor(secondary), `dark --text-secondary: ${secondary}`);
    assert.ok(muted && isSolidReadableColor(muted), `dark --text-muted: ${muted}`);
    assert.notEqual(text!.toLowerCase(), 'transparent');
    // dark text should be light-ish
    assert.match(text!, /^#f/i);
  });

  it('light theme defines readable text tokens (not white-on-white)', () => {
    const text = tokenInBlock(css, ':root[data-theme="light"]', '--text');
    const secondary = tokenInBlock(css, ':root[data-theme="light"]', '--text-secondary');
    const muted = tokenInBlock(css, ':root[data-theme="light"]', '--text-muted');
    assert.ok(text && isSolidReadableColor(text), `light --text: ${text}`);
    assert.ok(secondary && isSolidReadableColor(secondary), `light --text-secondary: ${secondary}`);
    assert.ok(muted && isSolidReadableColor(muted), `light --text-muted: ${muted}`);
    // light primary text should be dark, not white
    assert.ok(!/^#fff(fff)?$/i.test(text!), `light --text must not be pure white: ${text}`);
    assert.ok(text!.toLowerCase() !== 'white', `light --text must not be white keyword`);
    assert.ok(/^#1/i.test(text!) || /^#0/i.test(text!) || /^#2/i.test(text!), `light --text should be dark: ${text}`);
  });

  it('body uses theme text color', () => {
    assert.match(css, /body\s*\{[^}]*color:\s*var\(--text\)/s);
  });

  it('form controls set explicit resting text color (not hover-only)', () => {
    assert.match(css, /button,\s*input,\s*select,\s*textarea\s*\{[^}]*color:\s*var\(--text\)/s);
    assert.match(css, /\.field-group input[\s\S]*?color:\s*var\(--text\)/);
    assert.match(css, /option[\s\S]*?color:\s*var\(--text\)/);
    assert.match(css, /select option[\s\S]*?color:\s*var\(--text\)/);
    assert.match(css, /input::placeholder[\s\S]*?color:\s*var\(--text-muted\)/);
  });

  it('secondary buttons use theme text at rest', () => {
    assert.match(css, /\.button-secondary\s*\{[^}]*color:\s*var\(--text\)/s);
  });

  it('muted labels use secondary/muted tokens at rest', () => {
    assert.match(css, /\.field-group\s*>\s*span[\s\S]*?color:\s*var\(--text-secondary\)/);
    assert.match(css, /\.eyebrow\s*\{[^}]*color:\s*var\(--text-muted\)/s);
    assert.match(css, /\.status-badge\s*\{[^}]*color:\s*var\(--text-secondary\)/s);
  });

  it('no rest-state color:transparent on typography selectors', () => {
    // Allow transparent borders/backgrounds/tap-highlight, but not color: transparent on text rules
    const colorTransparent = [...css.matchAll(/^[^{}]*\{[^}]*color:\s*transparent/gim)];
    const offenders = colorTransparent
      .map((m) => m[0].slice(0, 120))
      .filter((s) => !/-webkit-tap-highlight-color/.test(s));
    assert.equal(offenders.length, 0, `unexpected color:transparent:\n${offenders.join('\n')}`);
  });

  it('reduced-motion disables animations entirely (no stuck opacity:0 from delay+backwards)', () => {
    const motion = read(motionPath);
    assert.match(motion, /html\[data-motion="reduced"\][\s\S]*animation:\s*none\s*!important/);
    assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none\s*!important/);
  });

  it('shell nav entrances use fill-mode both so final opacity is 1', () => {
    const shell = read(shellPath);
    assert.match(shell, /\.sidebar-link\s*\{[^}]*animation:[^;]*\bboth\b/s);
    assert.match(shell, /\.app-topbar\s*\{[^}]*animation:[^;]*\bboth\b/s);
  });

  it('view entrance uses both fill-mode', () => {
    assert.match(css, /\.view-stack\s*>\s*\*\s*\{[^}]*animation:[^;]*\bboth\b/s);
  });

  it('readability safety net present for sidebar and form chrome', () => {
    assert.match(css, /Resting readability safety net/);
    assert.match(css, /:root\[data-theme="light"\] \.button-secondary/);
  });
});

describe('page structural mapping', () => {
  const viewsDir = path.join(root, 'src', 'views');
  const viewFiles = fs.readdirSync(viewsDir).filter((f) => f.endsWith('.jsx'));

  it('routes every workspace view file', () => {
    const app = read(path.join(root, 'src', 'App.jsx'));
    for (const f of viewFiles) {
      const base = f.replace(/\.jsx$/, '');
      if (base === 'extraToolConfigs' || base === 'ModularWorkspaceView') continue;
      assert.match(app, new RegExp(base), `App should import/route ${base}`);
    }
  });

  it('form-heavy views use field-group / FilePicker / button classes wired to readable CSS', () => {
    const css = read(stylesPath);
    assert.match(css, /\.field-group/);
    assert.match(css, /\.button-primary/);
    assert.match(css, /\.status-badge/);
    assert.match(css, /\.workspace-tabs/);
    const converter = read(path.join(viewsDir, 'ConverterView.jsx'));
    assert.match(converter, /PrimaryButton|FilePicker|field-group|SelectField/);
    const settings = read(path.join(viewsDir, 'SettingsView.jsx'));
    assert.match(settings, /SelectField|ToggleRow|PrimaryButton/);
  });
});
