/**
 * Corrective Phase 9 — capture after-corrective route screenshots.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(root, 'docs', 'ux-ui-redesign', 'screenshots', 'after-corrective');

const ROUTES = [
  'dashboard',
  'converter',
  'pdf',
  'qr',
  'image',
  'media',
  'archive',
  'text',
  'audio',
  'color',
  'security',
  'developer',
  'activity',
  'profile',
  'settings',
];

const VIEWPORTS = [
  { name: '320', width: 320, height: 720 },
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];

const MAJOR = new Set(['dashboard', 'converter', 'pdf', 'image', 'media', 'audio', 'archive']);

function viewportsFor(route) {
  if (MAJOR.has(route)) return VIEWPORTS;
  return VIEWPORTS.filter((v) => ['375', '768', '1440'].includes(v.name));
}

test.describe.configure({ mode: 'serial' });

test('capture after-corrective screenshots for all production routes', async ({ page }) => {
  fs.mkdirSync(outRoot, { recursive: true });
  const index = [];

  for (const route of ROUTES) {
    const routeDir = path.join(outRoot, route);
    fs.mkdirSync(routeDir, { recursive: true });

    for (const vp of viewportsFor(route)) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.evaluate((id) => {
        window.location.hash = id === 'dashboard' ? '#/' : `#/${id}`;
      }, route);
      await page.waitForTimeout(500);

      const file = path.join(routeDir, `${vp.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      index.push({
        route,
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        path: path.relative(root, file).replace(/\\/g, '/'),
      });
    }
  }

  fs.writeFileSync(path.join(outRoot, 'INDEX.json'), JSON.stringify(index, null, 2));
  fs.writeFileSync(
    path.join(outRoot, 'README.md'),
    [
      '# After-corrective screenshots',
      '',
      `Captured ${index.length} frames for routes: ${ROUTES.join(', ')}.`,
      '',
      'Post C4–C8 purpose-built workspace redesign.',
      '',
    ].join('\n'),
  );
});
