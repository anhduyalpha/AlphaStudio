import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { navigationItems } from '../hubs/index';
import AssetGallery from '../next/views/AssetGallery.jsx';
import { buildPaletteItems } from '../next/components/index.jsx';

const APP = fileURLToPath(new URL('../next/App.jsx', import.meta.url));
const GALLERY = fileURLToPath(new URL('../next/views/AssetGallery.jsx', import.meta.url));
const VIEWS_CSS = fileURLToPath(new URL('../styles/views.css', import.meta.url));

describe('D2 shell chrome contract', () => {
  it('derives both Sidebar and CommandPalette from the one hub registry', () => {
    const source = fs.readFileSync(APP, 'utf8');
    expect(source).toContain('navigation={navigationItems}');
    expect(source.match(/navigation=\{navigationItems\}/g)).toHaveLength(2);

    const paletteItems = buildPaletteItems(navigationItems);
    expect(paletteItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'convert', href: '#/convert' }),
      expect.objectContaining({ id: 'media:audio', href: '#/media?mode=audio' }),
    ]));
  });

  it('keeps the Asset Gallery development-only and outside the navigation', () => {
    const source = fs.readFileSync(APP, 'utf8');
    expect(source).toContain('const AssetGallery = import.meta.env.DEV');
    expect(source).toContain("import('./views/AssetGallery.jsx')");
    expect(navigationItems.some((item) => item.id === 'assets')).toBe(false);
  });

  it('owns route focus, Ctrl/Cmd K, active-job count, and one global announcer', () => {
    const source = fs.readFileSync(APP, 'utf8');
    expect(source).toContain('headingRef.current?.focus()');
    expect(source).toContain("event.key.toLocaleLowerCase() === 'k'");
    expect(source).toContain('selectActiveJobs(snapshot)');
    expect(source).toContain('activeJobCount={activeJobs.length}');
    expect(source).toContain("job.status === 'completed' || job.status === 'failed'");
    expect(source.match(/data-global-announcer/g)).toHaveLength(1);
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-atomic="true"');
  });

  it('renders Topbar before Sidebar so the skip link remains first in shell order', () => {
    const source = fs.readFileSync(APP, 'utf8');
    expect(source.indexOf('<Topbar')).toBeGreaterThan(-1);
    expect(source.indexOf('<Topbar')).toBeLessThan(source.indexOf('<Sidebar'));
    expect(source).toContain('<main id="main-content"');
  });
});

describe('D2 Asset Gallery state matrix', () => {
  it('renders every production primitive family from the real component barrel', () => {
    const html = renderToStaticMarkup(<AssetGallery theme="dark" />);
    for (const marker of [
      'button--primary',
      'tabs--underline',
      'tabs--segmented',
      'field--text',
      'field--select',
      'field--textarea',
      'field--color',
      'field--range',
      'field--checkbox',
      'toggle',
      'dropzone--files',
      'dropzone--paste',
      'file-row',
      'file-list--empty',
      'progress-bar--indeterminate',
      'status-badge--danger',
      'empty-state--compact',
      'error-state',
      'banner--warning',
      'card--flat',
      'is-interactive',
      'skeleton--block',
      'skeleton--row',
      'run-bar',
      'resume-strip--uploads-only',
      'toast--danger',
    ]) {
      expect(html, marker).toContain(marker);
    }
  });

  it('makes required visual states explicit and offers real overlay launchers', () => {
    const source = fs.readFileSync(GALLERY, 'utf8');
    for (const contract of [
      'D · H · F · A · L · X',
      'D · H · F · S · X',
      'D · F · Er · S · X',
      'D · H · F · drag · X · E',
      'D · H · F · S · L · Er · X · empty',
      'D · E · S · enter · exit · live',
      'D · L · X · full · uploads-only · E',
      'D · H · F · S · mobile trap',
    ]) {
      expect(source, contract).toContain(contract);
    }
    expect(source).toContain('setDialogOpen(true)');
    expect(source).toContain('setPaletteOpen(true)');
  });

  it('keeps shell/view styling token-only and adapts at the three legal breakpoints', () => {
    const css = fs.readFileSync(VIEWS_CSS, 'utf8');
    expect(css).toContain('@media (max-width: 1200px)');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('.force-button-focus');
    expect(css).toContain('.force-drop-drag');
    expect(css).toContain('.gallery-runbars .run-bar');
  });
});
