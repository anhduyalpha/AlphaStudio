#!/usr/bin/env node
// npm run visual:diff — compares visual/captures against visual/baselines and
// enforces the browser-side deterministic checks recorded by capture.
// Exit non-zero on ANY of:
//   - a baseline whose capture is missing            (something disappeared)
//   - a baseline/capture pixel diff > DIFF_FAIL_RATIO (regression)
//   - a capture with no baseline                      (unaccepted new surface
//     → run `npm run visual:accept -- <id>`; accept is append-only)
//   - two required states of one component visually indistinct (< DISTINCT_MIN_RATIO)
//   - console errors on any captured route/gallery
//   - CLS beyond CLS_LOAD_MAX / CLS_INTERACT_MAX
// Manifest targets that were never captured ("missing" in report.json) are
// pending build units and do not fail — they have no baselines yet.
//
// Flags for self-testing: --baseline-dir <d> --capture-dir <d>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import CONFIG from './config.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const baseDir = path.resolve(root, opt('--baseline-dir', 'visual/baselines'));
const capDir = path.resolve(root, opt('--capture-dir', 'visual/captures'));
const diffDir = path.join(root, 'visual', 'diffs');

const failures = [];
const notes = [];

async function loadRaw(file) {
  const img = sharp(file).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Returns ratio of pixels whose max channel delta exceeds tolerance.
async function pixelDiffRatio(fileA, fileB, diffOut) {
  const a = await loadRaw(fileA);
  const b = await loadRaw(fileB);
  if (a.width !== b.width || a.height !== b.height) return { ratio: 1, sizeMismatch: true };
  const total = a.width * a.height;
  let bad = 0;
  const overlay = diffOut ? Buffer.from(a.data) : null;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const d = Math.max(
      Math.abs(a.data[o] - b.data[o]),
      Math.abs(a.data[o + 1] - b.data[o + 1]),
      Math.abs(a.data[o + 2] - b.data[o + 2])
    );
    if (d > CONFIG.PIXEL_CHANNEL_TOLERANCE) {
      bad++;
      if (overlay) { overlay[o] = 255; overlay[o + 1] = 0; overlay[o + 2] = 64; overlay[o + 3] = 255; }
    }
  }
  const ratio = bad / total;
  if (overlay && ratio > 0) {
    fs.mkdirSync(path.dirname(diffOut), { recursive: true });
    await sharp(overlay, { raw: { width: a.width, height: a.height, channels: 4 } }).png().toFile(diffOut);
  }
  return { ratio, sizeMismatch: false };
}

async function main() {
  fs.rmSync(diffDir, { recursive: true, force: true });
  const baselines = fs.existsSync(baseDir) ? fs.readdirSync(baseDir).filter((f) => f.endsWith('.png')) : [];
  const captures = fs.existsSync(capDir) ? fs.readdirSync(capDir).filter((f) => f.endsWith('.png')) : [];
  const reportPath = path.join(capDir, 'report.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  const noBaselineNeeded = new Set((report?.captured || []).filter((c) => c.baseline === false).map((c) => `${c.id}.png`));

  // 1. every baseline still has a matching, matching-enough capture
  for (const f of baselines) {
    if (f === 'README.md') continue;
    if (!captures.includes(f)) { failures.push(`MISSING CAPTURE for baseline ${f} (surface disappeared or capture run incomplete)`); continue; }
    const { ratio, sizeMismatch } = await pixelDiffRatio(path.join(baseDir, f), path.join(capDir, f), path.join(diffDir, f));
    if (sizeMismatch) failures.push(`SIZE MISMATCH ${f} (layout dimension change)`);
    else if (ratio > CONFIG.DIFF_FAIL_RATIO) failures.push(`REGRESSION ${f}: diff ratio ${(ratio * 100).toFixed(3)}% > ${(CONFIG.DIFF_FAIL_RATIO * 100).toFixed(1)}% (see visual/diffs/${f})`);
    else notes.push(`ok ${f} (${(ratio * 100).toFixed(3)}%)`);
  }

  // 2. every capture is accounted for by a baseline (append-only accept flow)
  for (const f of captures) {
    if (!baselines.includes(f) && !noBaselineNeeded.has(f)) {
      failures.push(`NO BASELINE for capture ${f} — review it, then \`npm run visual:accept -- ${f.replace(/\.png$/, '')}\``);
    }
  }

  // 3. state distinctness: same component+variant+theme, pairwise
  if (report) {
    const groups = new Map();
    for (const c of report.captured) {
      if (!c.component) continue;
      const k = `${c.component}--${c.variant}--${c.theme}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c.id);
    }
    for (const [k, ids] of groups) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const fa = path.join(capDir, `${ids[i]}.png`);
          const fb = path.join(capDir, `${ids[j]}.png`);
          if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
          const { ratio, sizeMismatch } = await pixelDiffRatio(fa, fb, null);
          if (!sizeMismatch && ratio < CONFIG.DISTINCT_MIN_RATIO) {
            failures.push(`STATES NOT DISTINCT (${k}): ${ids[i]} vs ${ids[j]} differ by only ${(ratio * 100).toFixed(3)}% < ${(CONFIG.DISTINCT_MIN_RATIO * 100).toFixed(1)}%`);
          }
        }
      }
    }

    // 4. console errors + CLS from the capture run
    for (const [id, errs] of Object.entries(report.consoleErrors || {})) {
      if (errs.length) failures.push(`CONSOLE ERRORS on ${id}: ${errs.slice(0, 3).join(' | ')}`);
    }
    for (const [id, v] of Object.entries(report.cls || {})) {
      const max = id.endsWith('--interact') ? CONFIG.CLS_INTERACT_MAX : CONFIG.CLS_LOAD_MAX;
      if (v > max) failures.push(`LAYOUT SHIFT ${id}: CLS ${v.toFixed(4)} > ${max}`);
    }
  }

  for (const n of notes) console.log(`  ${n}`);
  if (failures.length) {
    console.error(`\n[visual:diff] FAIL — ${failures.length} problem(s):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`[visual:diff] PASS — ${baselines.length} baseline(s) verified, ${captures.length} capture(s) accounted for.`);
}

main().catch((e) => { console.error('[visual:diff] ERROR:', e.message); process.exit(1); });
