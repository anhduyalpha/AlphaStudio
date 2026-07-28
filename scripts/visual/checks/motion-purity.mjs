// SPEC §5.2 + §5.3 MUST rules 1–2, deterministic. Outside tokens.css:
//   - zero literal ms/s durations, zero literal cubic-bezier
//   - @keyframes may declare ONLY transform/opacity
//   - transition(-property) may name ONLY transform, opacity,
//     background-color, border-color, color, outline-color (never `all`)
//   - Toast's JS auto-dismiss timer must read `--duration-toast` (no literal)
// Returns { name, status, violations }.

import fs from 'node:fs';
import path from 'node:path';

const TRANSITION_ALLOWED = new Set(['transform', 'opacity', 'background-color', 'border-color', 'color', 'outline-color', 'none']);
const DURATION_TOKEN = /var\(--duration-(?:fast|base|slow|ambient)\)/;
const EASING_TOKEN = /var\(--ease-(?:out|standard|in-out)\)/;

export default function motionPurity({ stylesDir, jsxDirs, root }) {
  const violations = [];
  const cssFiles = fs.existsSync(stylesDir)
    ? fs.readdirSync(stylesDir).filter((f) => f.endsWith('.css') && f !== 'tokens.css').map((f) => path.join(stylesDir, f))
    : [];
  if (!cssFiles.length) {
    return { name: 'motion-purity (§5.2/§5.3)', status: 'pending', violations: [], note: `no CSS yet under ${path.relative(root, stylesDir)} (built by units C1+/F0)` };
  }

  for (const file of cssFiles) {
    const rel = path.relative(root, file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const loc = `${rel}:${i + 1}`;
      if (/(?<![\w.#-])\d+(\.\d+)?m?s\b/.test(line) && !/@media/.test(line)) violations.push(`${loc} literal duration: ${line.trim()}`);
      if (/cubic-bezier\s*\(/.test(line)) violations.push(`${loc} literal easing curve: ${line.trim()}`);
    });

    // Parse complete declarations so multiline transition lists cannot bypass
    // the property and timing-token checks.
    const transitionRe = /\b(transition|transition-property)\s*:\s*([^;]+);/g;
    let transitionMatch;
    while ((transitionMatch = transitionRe.exec(text))) {
      const [, declaration, value] = transitionMatch;
      const lineNo = text.slice(0, transitionMatch.index).split('\n').length;
      const loc = `${rel}:${lineNo}`;
      const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
      for (const entry of entries) {
        const property = entry.split(/\s+/)[0];
        if (property === 'all') violations.push(`${loc} \`transition: all\` (can animate layout): ${entry}`);
        else if (!property.startsWith('var(') && !TRANSITION_ALLOWED.has(property)) {
          violations.push(`${loc} non-compositor transition property "${property}": ${entry}`);
        }
        if (declaration === 'transition' && property !== 'none') {
          if (!DURATION_TOKEN.test(entry)) violations.push(`${loc} transition must use a §5.2 duration token: ${entry}`);
          if (!EASING_TOKEN.test(entry)) violations.push(`${loc} transition must use a §5.2 easing token: ${entry}`);
        }
      }
    }

    const animationRe = /\banimation\s*:\s*([^;]+);/g;
    let animationMatch;
    while ((animationMatch = animationRe.exec(text))) {
      const value = animationMatch[1].trim();
      if (/^none(?:\s*!important)?$/.test(value)) continue;
      const lineNo = text.slice(0, animationMatch.index).split('\n').length;
      const loc = `${rel}:${lineNo}`;
      if (!DURATION_TOKEN.test(value)) violations.push(`${loc} animation must use a §5.2 duration token: ${value}`);
      if (!EASING_TOKEN.test(value)) violations.push(`${loc} animation must use a §5.2 easing token: ${value}`);
    }

    // @keyframes blocks: only transform/opacity may be declared
    const kfRe = /@keyframes[^{]*\{/g;
    let m;
    while ((m = kfRe.exec(text))) {
      let depth = 1, i = m.index + m[0].length;
      const start = i;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
      const body = text.slice(start, i);
      const declRe = /([a-z-]+)\s*:/g;
      let d;
      while ((d = declRe.exec(body))) {
        const prop = d[1];
        if (!['transform', 'opacity', 'animation-timing-function', 'offset'].includes(prop)) {
          const lineNo = text.slice(0, m.index).split('\n').length;
          violations.push(`${rel}:~${lineNo} @keyframes animates non-compositor property "${prop}"`);
        }
      }
    }
  }

  // Toast JS timer contract (§5.2 --duration-toast read from computed style)
  for (const dir of jsxDirs) {
    const toast = ['Toast.jsx', 'Toast.tsx']
      .flatMap((n) => [path.join(dir, 'components', n), path.join(dir, n)])
      .find((p) => fs.existsSync(p));
    if (toast) {
      const src = fs.readFileSync(toast, 'utf8');
      if (!src.includes('--duration-toast')) violations.push(`${path.relative(root, toast)}: Toast must read --duration-toast from computed style (§5.2)`);
      const st = src.match(/set(?:Timeout|Interval)\s*\(\s*[^,]+,\s*(\d{3,})\s*\)/);
      if (st) violations.push(`${path.relative(root, toast)}: hardcoded timer duration ${st[1]}ms (§5.2)`);
    }
  }

  return { name: 'motion-purity (§5.2/§5.3)', status: violations.length ? 'fail' : 'pass', violations, scanned: cssFiles.length };
}
