import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  hubRegistry,
  legacyRedirects,
  navigationItems,
  resolveHashRoute,
  routeTable,
} from '../hubs/index';

const MAIN = fileURLToPath(new URL('../main.jsx', import.meta.url));
const INDEX_HTML = fileURLToPath(new URL('../../index.html', import.meta.url));

describe('D1 hub registry and navigation', () => {
  it('publishes the six hubs once and derives navigation order from them', () => {
    expect(hubRegistry.map((hub) => hub.id)).toEqual([
      'convert',
      'pdf',
      'media',
      'text',
      'security',
      'utilities',
    ]);
    expect(navigationItems.map((item) => item.id)).toEqual([
      'home',
      ...hubRegistry.map((hub) => hub.id),
      'activity',
      'settings',
      'profile',
    ]);
    expect(Object.keys(routeTable)).toHaveLength(10);
  });

  it('keeps each hub default and tab order in modes array order', () => {
    expect(resolveHashRoute('#/pdf')).toMatchObject({
      href: '#/pdf',
      mode: { id: 'operations' },
    });
    expect(resolveHashRoute('#/pdf?mode=export')).toMatchObject({
      href: '#/pdf?mode=export',
      mode: { id: 'export' },
    });
    expect(resolveHashRoute('#/pdf?mode=missing')).toMatchObject({
      href: '#/pdf?mode=operations',
      mode: { id: 'operations' },
      redirected: true,
    });
  });
});

describe('D1 hash resolution and legacy redirects', () => {
  const changedLegacyRoutes = {
    '#/dashboard': '#/',
    '#/converter': '#/convert',
    '#/image': '#/media?mode=image',
    '#/audio': '#/media?mode=audio',
    '#/media': '#/media?mode=video',
    '#/archive': '#/security?mode=archive',
    '#/developer': '#/text?mode=dev',
    '#/qr': '#/utilities?mode=qr',
    '#/color': '#/utilities?mode=color',
    '#/text': '#/text?mode=text',
    '#/security': '#/security?mode=security',
  } as const;

  it('contains the complete changed-route redirect table', () => {
    expect(legacyRedirects).toEqual(changedLegacyRoutes);
    for (const [legacy, expected] of Object.entries(changedLegacyRoutes)) {
      expect(resolveHashRoute(legacy).href).toBe(expected);
    }
  });

  it.each(['#/pdf', '#/activity', '#/settings', '#/profile'])(
    'keeps unchanged legacy route %s stable',
    (hash) => {
      expect(resolveHashRoute(hash).href).toBe(hash);
    },
  );

  it('sends unknown and production-only asset hashes home', () => {
    expect(resolveHashRoute('#/not-a-route')).toMatchObject({
      href: '#/',
      route: { id: 'home' },
      redirected: true,
    });
    expect(resolveHashRoute('#/assets')).toMatchObject({
      href: '#/',
      route: { id: 'home' },
    });
    expect(resolveHashRoute('#/assets', { includeAssets: true })).toMatchObject({
      href: '#/assets',
      route: { id: 'assets' },
      redirected: false,
    });
  });

  it('does not redirect canonical mode links through a legacy path mapping', () => {
    expect(resolveHashRoute('#/media?mode=audio')).toMatchObject({
      href: '#/media?mode=audio',
      mode: { id: 'audio' },
      redirected: false,
    });
  });

  it.each([
    ['#/media?mode=', '#/media?mode=video'],
    ['#/media?foo=bar', '#/media?mode=video'],
    ['#/text?mode=', '#/text?mode=text'],
    ['#/text?foo=bar', '#/text?mode=text'],
    ['#/security?mode=', '#/security?mode=security'],
    ['#/security?foo=bar', '#/security?mode=security'],
  ])('canonicalizes %s to an idempotent explicit default', (input, expected) => {
    const first = resolveHashRoute(input);
    const second = resolveHashRoute(first.href);
    expect(first.href).toBe(expected);
    expect(second.href).toBe(expected);
    expect(second.redirected).toBe(false);
  });
});

describe('D1 client entry and pre-paint bootstrap', () => {
  it('loads only the final client after contracts are ready', () => {
    const source = fs.readFileSync(MAIN, 'utf8');
    expect(source).not.toContain('VITE_UI');
    expect(source).toContain("await import('./protocol/contracts')");
    expect(source).toContain('await contracts.loadContracts()');
    expect(source.indexOf('await contracts.loadContracts()'))
      .toBeLessThan(source.indexOf("return import('./App')"));
    expect(source).toContain("return import('./App')");
    expect(source).toContain("document.documentElement.dataset.shell = 'next'");
    expect(source).not.toContain("import('./styles.css')");
    expect(source).not.toContain("import('./animations/index.css')");
  });

  it('removes only the verified no-op device heuristic', () => {
    const source = fs.readFileSync(INDEX_HTML, 'utf8');
    expect(source).not.toContain('navigator.connection');
    expect(source).not.toContain('navigator.hardwareConcurrency');
    expect(source).not.toContain('navigator.deviceMemory');
    expect(source).not.toContain("lite ? 'balanced' : 'balanced'");
    expect(source).toContain("let motion = 'balanced'");
  });
});
