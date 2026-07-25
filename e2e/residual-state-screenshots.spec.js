/**
 * RQ13 — residual-states screenshot matrix (empty / key states where reachable).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(root, 'docs', 'ux-ui-redesign', 'screenshots', 'residual-states');

const ROUTES = [
  { id: 'dashboard', states: ['empty'] },
  { id: 'image', states: ['empty', 'crop-mode'] },
  { id: 'text', states: ['empty', 'compare-mode'] },
  { id: 'archive', states: ['empty', 'inspect-mode'] },
  { id: 'color', states: ['empty', 'contrast-mode'] },
  { id: 'security', states: ['empty', 'password-mode'] },
  { id: 'activity', states: ['empty'] },
  { id: 'settings', states: ['empty'] },
  { id: 'profile', states: ['empty'] },
  { id: 'developer', states: ['empty'] },
  { id: 'media', states: ['empty', 'trim-mode'] },
  { id: 'audio', states: ['empty'] },
];

const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
];

test.describe.configure({ mode: 'serial' });

test('capture residual-states screenshots', async ({ page }) => {
  fs.mkdirSync(outRoot, { recursive: true });
  const index = [];

  for (const route of ROUTES) {
    const routeDir = path.join(outRoot, route.id);
    fs.mkdirSync(routeDir, { recursive: true });

    for (const state of route.states) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/');
        await page.evaluate((id) => {
          window.location.hash = id === 'dashboard' ? '#/' : `#/${id}`;
        }, route.id);
        await page.waitForTimeout(500);

        if (state === 'crop-mode') {
          await page.getByRole('tab', { name: 'Crop', exact: true }).click().catch(() => {});
        } else if (state === 'compare-mode') {
          await page.getByRole('tab', { name: 'Compare', exact: true }).click().catch(() => {});
        } else if (state === 'inspect-mode') {
          await page.getByRole('tab', { name: 'Inspect', exact: true }).click().catch(() => {});
        } else if (state === 'contrast-mode') {
          await page.getByRole('tab', { name: 'Contrast', exact: true }).click().catch(() => {});
        } else if (state === 'password-mode') {
          await page.getByRole('tab', { name: 'Password', exact: true }).click().catch(() => {});
        } else if (state === 'trim-mode') {
          await page.getByRole('tab', { name: 'Trim', exact: true }).click().catch(() => {});
        }
        await page.waitForTimeout(350);

        const file = path.join(routeDir, `${state}-${vp.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        index.push({
          route: route.id,
          state,
          viewport: vp.name,
          path: path.relative(root, file).replace(/\\/g, '/'),
        });
      }
    }
  }

  // Before/after composites index entries pointing at baseline vs residual empty 1440 when both exist
  const beforeAfter = [];
  const compareRoutes = ['dashboard', 'image', 'text', 'archive', 'color'];
  for (const r of compareRoutes) {
    const before = path.join(root, 'docs/ux-ui-redesign/screenshots/after-corrective', r, '1440.png');
    const after = path.join(outRoot, r, 'empty-1440.png');
    if (fs.existsSync(before) && fs.existsSync(after)) {
      beforeAfter.push({
        route: r,
        before: path.relative(root, before).replace(/\\/g, '/'),
        after: path.relative(root, after).replace(/\\/g, '/'),
        note: 'Pair for manual side-by-side; empty residual vs prior after-corrective empty frame',
      });
    }
  }

  fs.writeFileSync(path.join(outRoot, 'INDEX.json'), JSON.stringify({ frames: index, beforeAfter }, null, 2));
  fs.writeFileSync(
    path.join(outRoot, 'README.md'),
    [
      '# Residual-states screenshots',
      '',
      `Captured ${index.length} frames across routes: ${ROUTES.map((r) => r.id).join(', ')}.`,
      '',
      'States include empty and mode-selected where applicable (crop, compare, inspect, contrast, password, trim).',
      'Running/completed/failed job states require live jobs and are deferred when no fixtures are uploaded in harness.',
      '',
      `Before/after pairs indexed: ${beforeAfter.length}.`,
      '',
    ].join('\n'),
  );
});
