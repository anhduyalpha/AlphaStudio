// SPEC §4.6 token purity, deterministic. Scans styles CSS (except tokens.css)
// for: color literals (hex/rgb/rgba/hsl), un-tokenized border-radius and
// font-size, un-tokenized margin/padding/gap; and new-UI JSX for design
// constants inside style={{...}}. Assert count == 0.
// Returns { name, status: 'pass'|'fail'|'pending', violations: [] }.

import fs from 'node:fs';
import path from 'node:path';

const ALLOW_RAW = new Set(['0', '1px', '2px', '50%', '100%', '100vh', '100vw', '100dvh', 'auto', 'transparent', 'currentColor', 'inherit', 'initial', 'unset', 'none']);

function listCss(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'tokens.css').map((f) => path.join(dir, f));
}
function listJsx(dirs) {
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { recursive: true, withFileTypes: true })) {
      if (e.isFile() && /\.(jsx|tsx|js|ts)$/.test(e.name)) out.push(path.join(e.parentPath ?? e.path, e.name));
    }
  }
  return out;
}

export default function tokenPurity({ stylesDir, jsxDirs, root }) {
  const violations = [];
  const cssFiles = listCss(stylesDir);
  const jsxFiles = listJsx(jsxDirs);
  if (!cssFiles.length && !jsxFiles.length) {
    return { name: 'token-purity (§4.6)', status: 'pending', violations: [], note: `no target files yet under ${path.relative(root, stylesDir)} (built by units C1+)` };
  }

  for (const file of cssFiles) {
    const rel = path.relative(root, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const loc = `${rel}:${i + 1}`;
      const inMedia = /@media/.test(line);
      if (/#[0-9a-fA-F]{3,8}\b/.test(line)) violations.push(`${loc} hex color literal: ${line.trim()}`);
      if (/\b(rgb|rgba|hsl|hsla)\s*\(/.test(line)) violations.push(`${loc} color function literal: ${line.trim()}`);
      const radius = line.match(/border-radius\s*:\s*([^;]+);?/);
      if (radius && !/var\(--radius/.test(radius[1]) && !ALLOW_RAW.has(radius[1].trim())) violations.push(`${loc} un-tokenized border-radius: ${radius[1].trim()}`);
      const fsz = line.match(/font-size\s*:\s*([^;]+);?/);
      if (fsz && !/var\(--text/.test(fsz[1]) && !ALLOW_RAW.has(fsz[1].trim())) violations.push(`${loc} un-tokenized font-size: ${fsz[1].trim()}`);
      const box = line.match(/(?:^|[\s;{])(margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;]+);?/);
      if (box && !inMedia) {
        const vals = box[2].replace(/var\(--space-\d\)/g, '').replace(/calc\([^)]*\)/g, '').trim().split(/\s+/).filter(Boolean);
        for (const v of vals) {
          if (!ALLOW_RAW.has(v) && !/^var\(--/.test(v)) { violations.push(`${loc} un-tokenized ${box[1]}: ${box[2].trim()}`); break; }
        }
      }
    });
  }

  for (const file of jsxFiles) {
    const rel = path.relative(root, file);
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/style=\{\{/.test(line) && /(#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl)\s*\(|\b\d+px\b)/.test(line)) {
        violations.push(`${path.relative(root, file)}:${i + 1} design constant in JSX style={}: ${line.trim().slice(0, 120)}`);
      }
    });
  }

  return { name: 'token-purity (§4.6)', status: violations.length ? 'fail' : 'pass', violations, scanned: cssFiles.length + jsxFiles.length };
}
