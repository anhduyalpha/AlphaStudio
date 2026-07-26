#!/usr/bin/env node
// npm run visual:capture — boots the app (API + dev client, flag build
// VITE_UI=next by default) and captures every screen and component state the
// manifest defines, in both themes, motion=reduced, animations frozen.
//
// Output: visual/captures/*.png + visual/captures/report.json
//   report.json: { captured[], missing[], consoleErrors{}, cls{} }
// Missing targets (shell marker / gallery instance not yet built) are DATA,
// not failures — units make them exist over time. Boot failure exits 1.
//
// Flags: --keep-server (debug), --ui <flag> (VITE_UI value, default "next").

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import CONFIG from './config.mjs';
import { THEMES, routeEntries, stateEntries, TAB_INTERACTION_ROUTES } from './manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'visual', 'captures');
const args = process.argv.slice(2);
const uiFlag = args.includes('--ui') ? args[args.indexOf('--ui') + 1] : 'next';

const clientUrl = `http://127.0.0.1:${CONFIG.CLIENT_PORT}`;
const serverUrl = `http://127.0.0.1:${CONFIG.SERVER_PORT}`;

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || res.status < 500) return resolve();
      } catch {}
      if (Date.now() > deadline) return reject(new Error(`timeout waiting for ${url}`));
      setTimeout(tick, 500);
    };
    tick();
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {}
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alphastudio-visual-'));
const children = [];

function boot(cmd, argv, env, name) {
  const child = spawn(cmd, argv, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => {
    if (process.env.VISUAL_DEBUG) process.stderr.write(`[${name}] ${d}`);
  });
  children.push(child);
  return child;
}

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`[visual:capture] booting API (${serverUrl}) + client (${clientUrl}, VITE_UI=${uiFlag})`);
  boot(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(CONFIG.SERVER_PORT),
    CORS_ORIGIN: clientUrl,
    SERVE_FRONTEND: '0',
    DATA_DIR: dataDir,
    DB_PATH: path.join(dataDir, 'visual.db'),
    WORKER_POOL_SIZE: '1',
    LOG_LEVEL: 'warn',
  }, 'api');
  boot(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(CONFIG.CLIENT_PORT), '--strictPort'], {
    VITE_API_URL: serverUrl,
    VITE_UI: uiFlag,
  }, 'vite');

  await waitForUrl(`${serverUrl}/api/health`, 60_000);
  await waitForUrl(clientUrl, 120_000);

  const browser = await chromium.launch();
  const report = { captured: [], missing: [], consoleErrors: {}, cls: {}, meta: { uiFlag, when: new Date().toISOString() } };

  for (const theme of THEMES) {
    const context = await browser.newContext({ viewport: CONFIG.VIEWPORT, deviceScaleFactor: 1 });
    await context.addInitScript(([t]) => {
      localStorage.setItem('alpha-studio-theme', t);
      localStorage.setItem('alpha-studio-motion', 'reduced');
      window.__visualShifts = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__visualShifts.push({ v: e.value, t: e.startTime });
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
    }, [theme]);

    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    const settle = async () => {
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    };
    const clsSince = (t0) => page.evaluate((t) => (window.__visualShifts || []).filter((s) => s.t > t).reduce((a, s) => a + s.v, 0), t0);

    // --- unconditional smoke shot: proves boot + pipeline even pre-rebuild ---
    if (theme === 'dark') {
      await page.goto(`${clientUrl}/#/`);
      await settle();
      await page.screenshot({ path: path.join(outDir, 'smoke--home.png'), animations: 'disabled' });
      report.captured.push({ id: 'smoke--home', theme, baseline: false });
    }

    // --- routes (gated on the new-shell marker) ---
    for (const entry of routeEntries()) {
      await page.goto(`${clientUrl}/${entry.hash}`);
      await settle();
      const isNext = await page.evaluate(() => document.documentElement.dataset.shell === 'next');
      if (!isNext) {
        report.missing.push({ id: `${entry.id}--${theme}`, reason: 'html[data-shell="next"] absent (new shell not built/enabled)' });
        continue;
      }
      const loadCls = await clsSince(0);
      await page.screenshot({ path: path.join(outDir, `${entry.id}--${theme}.png`), fullPage: true, animations: 'disabled' });
      report.captured.push({ id: `${entry.id}--${theme}`, theme });
      report.cls[`${entry.id}--${theme}--load`] = loadCls;
      report.consoleErrors[`${entry.id}--${theme}`] = errors.splice(0);

      if (TAB_INTERACTION_ROUTES.includes(entry.hash.replace('#/', ''))) {
        const tabs = page.locator('[role="tab"]');
        if ((await tabs.count()) > 1) {
          const t0 = await page.evaluate(() => performance.now());
          await tabs.nth(1).click();
          await settle();
          report.cls[`${entry.id}--${theme}--interact`] = await clsSince(t0);
        }
      }
    }

    // --- component states in the Asset Gallery ---
    await page.goto(`${clientUrl}/#/assets`);
    await settle();
    const hasGallery = await page.locator('[data-vis-gallery]').count();
    if (!hasGallery) {
      for (const entry of stateEntries()) report.missing.push({ id: `${entry.id}--${theme}`, reason: '[data-vis-gallery] not rendered (Asset Gallery not built/enabled)' });
    } else {
      errors.splice(0);
      for (const entry of stateEntries()) {
        const node = page.locator(entry.selector).first();
        if ((await node.count()) === 0) {
          report.missing.push({ id: `${entry.id}--${theme}`, reason: `no gallery instance ${entry.selector}` });
          continue;
        }
        if (entry.action === 'hover') await node.hover();
        else if (entry.action === 'focus') await node.focus();
        else if (entry.action === 'mousedown') { await node.hover(); await page.mouse.down(); }
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
        await node.screenshot({ path: path.join(outDir, `${entry.id}--${theme}.png`), animations: 'disabled' });
        if (entry.action === 'mousedown') await page.mouse.up();
        if (entry.action) { await page.mouse.move(0, 0); await page.keyboard.press('Escape').catch(() => {}); }
        report.captured.push({ id: `${entry.id}--${theme}`, theme, component: entry.component, variant: entry.variant, state: entry.state });
      }
      report.consoleErrors[`gallery--${theme}`] = errors.splice(0);
    }
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[visual:capture] captured=${report.captured.length} missing=${report.missing.length} → ${path.relative(root, outDir)}`);
  if (report.missing.length) console.log('[visual:capture] missing targets are pending build units (see report.json), not failures');
}

main()
  .then(() => { for (const c of children) killTree(c); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0); })
  .catch((err) => { console.error('[visual:capture] FAILED:', err.message); for (const c of children) killTree(c); process.exit(1); });
