// WCAG 2.1 contrast over the token definitions themselves (SPEC §4.1 table,
// both themes), deterministic math — no browser needed. Thresholds in
// config.mjs (AA 4.5:1 text-on-surface; 3:1 on-accent and status labels —
// see config.mjs for the recorded SPEC tension on --on-accent).
// Parses styles/tokens.css; pending until unit C1 creates it.
// Accepts { tokensFile } override for self-tests.

import fs from 'node:fs';
import path from 'node:path';
import CONFIG from '../config.mjs';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(f)) return null;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}
function luminance([r, g, b]) {
  const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function parseThemeBlocks(css) {
  // tokens defined under :root/html[data-theme="dark"] (dark default) and
  // html[data-theme="light"]. Simple block scan keyed by selector text.
  const themes = { dark: {}, light: {} };
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(css))) {
    const sel = m[1].trim();
    const isLight = /data-theme=["']?light/.test(sel);
    const isDark = /data-theme=["']?dark/.test(sel) || /^:root$/.test(sel) || /^html$/.test(sel);
    if (!isLight && !isDark) continue;
    const target = isLight ? ['light'] : ['dark'];
    const varRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
    let v;
    while ((v = varRe.exec(m[2]))) for (const t of target) themes[t][v[1]] = v[2].trim();
  }
  return themes;
}

export default function contrast({ root, tokensFile }) {
  const file = tokensFile || path.join(root, 'src', 'styles', 'tokens.css');
  if (!fs.existsSync(file)) {
    return { name: 'contrast (WCAG AA on §4.1 tokens)', status: 'pending', violations: [], note: 'src/styles/tokens.css not built yet (unit C1)' };
  }
  const themes = parseThemeBlocks(fs.readFileSync(file, 'utf8'));
  const violations = [];
  const checks = [
    { fg: ['--text', '--text-2', '--text-3'], bg: ['--bg', '--bg-raised', '--surface', '--surface-2'], min: CONFIG.CONTRAST_TEXT, label: 'text' },
    { fg: ['--on-accent'], bg: ['--accent'], min: CONFIG.CONTRAST_ON_ACCENT, label: 'on-accent' },
    { fg: ['--success', '--warning', '--danger', '--live'], bg: ['--surface'], min: CONFIG.CONTRAST_STATUS, label: 'status' },
  ];
  for (const [themeName, vars] of Object.entries(themes)) {
    if (!Object.keys(vars).length) { violations.push(`${themeName}: no token block found in tokens.css`); continue; }
    for (const c of checks) {
      for (const fgName of c.fg) {
        for (const bgName of c.bg) {
          const fg = hexToRgb(vars[fgName] || '');
          const bg = hexToRgb(vars[bgName] || '');
          if (!fg || !bg) { violations.push(`${themeName}: ${fgName} or ${bgName} missing/non-hex — cannot verify (${c.label})`); continue; }
          const r = ratio(fg, bg);
          if (r < c.min) violations.push(`${themeName}: ${fgName} on ${bgName} = ${r.toFixed(2)}:1 < ${c.min}:1 (${c.label})`);
        }
      }
    }
  }
  return { name: 'contrast (WCAG AA on §4.1 tokens)', status: violations.length ? 'fail' : 'pass', violations };
}
