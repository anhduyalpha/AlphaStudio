import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { brandAssets } from '../assets/registry.js';
import {
  CommandPalette,
  Modal,
  Sidebar,
  Topbar,
  buildPaletteItems,
  filterPaletteItems,
  getPaletteInputEntryIndex,
  getNextPaletteIndex,
} from '../next/components/index.jsx';
import {
  isFocusableCandidate,
  selectInitialFocusTarget,
} from '../hooks/useFocusTrap.js';

const COMPONENTS_DIR = fileURLToPath(new URL('../next/components/', import.meta.url));
const FOCUS_TRAP = fileURLToPath(new URL('../hooks/useFocusTrap.js', import.meta.url));
const PRIMITIVES_CSS = fileURLToPath(new URL('../styles/primitives.css', import.meta.url));

const navigation = [
  { id: 'home', label: 'Home', icon: 'dashboard', href: '#/', group: 'Workspace' },
  {
    id: 'media',
    label: 'Media Studio',
    icon: 'media',
    href: '#/media',
    group: 'Studios',
    modes: [
      { id: 'video', name: 'Video' },
      { id: 'audio', name: 'Audio' },
    ],
  },
];

describe('C4 Modal and the single focus trap', () => {
  it.each(['dialog', 'palette'])('renders the %s Modal variant with dialog semantics', (variant) => {
    const html = renderToStaticMarkup(
      <Modal open variant={variant} title="Example dialog" onClose={() => {}}>
        Content
      </Modal>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`modal--${variant}`);
    expect(html).toContain('Example dialog');
  });

  it('blocks scrim and close actions while Modal is busy', () => {
    const html = renderToStaticMarkup(
      <Modal open busy title="Exporting" onClose={() => {}}>Please wait</Modal>,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('modal__scrim');
    expect(html).toContain('disabled=""');
  });

  it('returns no overlay markup when closed', () => {
    expect(renderToStaticMarkup(
      <Modal open={false} title="Closed" onClose={() => {}}>Hidden</Modal>,
    )).toBe('');
  });

  it('rejects an open unnamed dialog', () => {
    expect(() => renderToStaticMarkup(
      <Modal open onClose={() => {}}>Unnamed</Modal>,
    )).toThrow(/non-empty title or ariaLabel/);
  });

  it('keeps one focus-trap implementation and makes Modal and Sidebar consume it', () => {
    const sources = fs
      .readdirSync(COMPONENTS_DIR)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => ({ file, source: fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8') }));
    const consumers = sources
      .filter(({ source }) => source.includes("from '../../hooks/useFocusTrap'"))
      .map(({ file }) => file)
      .sort();
    expect(consumers).toEqual(['Modal.jsx', 'Sidebar.jsx']);
    expect(fs.readFileSync(FOCUS_TRAP, 'utf8')).toContain('export default function useFocusTrap');
    expect(sources.some(({ source }) => source.includes('querySelectorAll(FOCUSABLE_SELECTOR)'))).toBe(false);
  });

  it('does not restart the trap when escape, busy, or restoration options change', () => {
    const source = fs.readFileSync(FOCUS_TRAP, 'utf8');
    expect(source).toContain('optionsRef.current = { initialFocusRef, onEscape, restoreFocus }');
    expect(source).toContain('}, [active, containerRef]);');
  });

  it('falls back from disabled, hidden, or out-of-root initial targets', () => {
    const fallback = { id: 'fallback' };
    const disabled = { id: 'disabled' };
    const hidden = { id: 'hidden' };
    const outside = { id: 'outside' };
    const root = {
      contains: (candidate) => candidate !== outside,
    };
    const focusable = [fallback];
    expect(selectInitialFocusTarget(root, focusable, disabled)).toBe(fallback);
    expect(selectInitialFocusTarget(root, focusable, hidden)).toBe(fallback);
    expect(selectInitialFocusTarget(root, focusable, outside)).toBe(fallback);
  });

  it('excludes disabled controls and controls below hidden or inert ancestors', () => {
    const visible = {
      matches: () => false,
      closest: () => null,
      offsetParent: {},
    };
    expect(isFocusableCandidate(visible, null)).toBe(true);
    expect(isFocusableCandidate({ ...visible, matches: () => true }, null)).toBe(false);
    expect(isFocusableCandidate({ ...visible, closest: () => ({}) }, null)).toBe(false);
    expect(isFocusableCandidate({
      ...visible,
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ display: 'block', visibility: 'hidden' }),
        },
      },
    }, null)).toBe(false);
  });
});

describe('C4 CommandPalette searches hubs and modes with roving focus', () => {
  it('flattens mode routes beneath their owning hub', () => {
    const items = buildPaletteItems(navigation);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'media', label: 'Media Studio', href: '#/media' }),
      expect.objectContaining({
        id: 'media:audio',
        label: 'Audio',
        context: 'Media Studio',
        href: '#/media?mode=audio',
      }),
    ]));
  });

  it('finds Audio as Media Studio → Audio without maintaining another nav list', () => {
    const results = filterPaletteItems(buildPaletteItems(navigation), 'audio');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'media:audio',
      label: 'Audio',
      context: 'Media Studio',
    });
  });

  it('wraps Arrow navigation and supports Home/End', () => {
    expect(getNextPaletteIndex(3, 0, 'ArrowDown')).toBe(1);
    expect(getNextPaletteIndex(3, 2, 'ArrowDown')).toBe(0);
    expect(getNextPaletteIndex(3, 0, 'ArrowUp')).toBe(2);
    expect(getNextPaletteIndex(3, 2, 'Home')).toBe(0);
    expect(getNextPaletteIndex(3, 0, 'End')).toBe(2);
    expect(getNextPaletteIndex(0, 0, 'ArrowDown')).toBe(-1);
  });

  it('enters the result list from search without skipping the first option', () => {
    expect(getPaletteInputEntryIndex(3, 'ArrowDown')).toBe(0);
    expect(getPaletteInputEntryIndex(3, 'Home')).toBe(0);
    expect(getPaletteInputEntryIndex(3, 'ArrowUp')).toBe(2);
    expect(getPaletteInputEntryIndex(3, 'End')).toBe(2);
    expect(getPaletteInputEntryIndex(0, 'ArrowDown')).toBe(-1);
  });

  it('renders selected listbox options and a designed empty state', () => {
    const populated = renderToStaticMarkup(
      <CommandPalette open navigation={navigation} onClose={() => {}} onNavigate={() => {}} />,
    );
    const empty = renderToStaticMarkup(
      <CommandPalette
        open
        navigation={[]}
        initialQuery="missing"
        onClose={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(populated).toContain('role="listbox"');
    expect(populated).toContain('role="option"');
    expect(populated).toContain('aria-selected="true"');
    expect(populated).toContain('tabindex="0"');
    expect(empty).toContain('No tools or modes found');
    expect(empty).toContain('empty-state');
  });
});

describe('C4 Sidebar and Topbar chrome', () => {
  it('renders registry-derived grouped navigation, current route, and active jobs', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        navigation={navigation}
        currentHref="#/media"
        activeJobCount={3}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('3 active jobs');
    expect(html).toContain('status-badge--live');
  });

  it('uses the contrast-safe brand lockup for each chrome theme', () => {
    const dark = renderToStaticMarkup(
      <Sidebar navigation={navigation} theme="dark" />,
    );
    const light = renderToStaticMarkup(
      <Sidebar navigation={navigation} theme="light" />,
    );
    expect(dark).toContain(brandAssets.horizontal);
    expect(light).toContain(brandAssets.horizontalLight);
  });

  it('marks the mobile drawer open and exposes one named close action', () => {
    const html = renderToStaticMarkup(
      <Sidebar navigation={navigation} mobileOpen onClose={() => {}} />,
    );
    expect(html).toContain('is-mobile-open');
    expect(html).toContain('aria-modal="true"');
    expect(html.match(/aria-label="Close navigation"/g) ?? []).toHaveLength(2);
  });

  it('puts the skip link before Topbar controls and names menu/search/theme controls', () => {
    const html = renderToStaticMarkup(
      <Topbar
        title="Media Studio"
        subtitle="Audio"
        theme="dark"
        onMenuOpen={() => {}}
        onCommandOpen={() => {}}
        onThemeToggle={() => {}}
      />,
    );
    expect(html).toMatch(/^<a class="skip-link" href="#main-content">Skip to content<\/a>/);
    expect(html).toContain('aria-label="Open navigation"');
    expect(html).toContain('aria-label="Search tools and modes"');
    expect(html).toContain('aria-label="Use light theme"');
    expect(html).toContain('<h1');
  });

  it('uses glass only on modal/palette/mobile drawer, with opaque chrome and fallbacks', () => {
    const css = fs.readFileSync(PRIMITIVES_CSS, 'utf8');
    expect(css).toMatch(/\.modal__surface\s*\{[\s\S]*background: var\(--glass-bg\)/);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.sidebar\.is-mobile-open[\s\S]*background: var\(--glass-bg\)/);
    expect(css).toMatch(/\.sidebar\s*\{[\s\S]*background: var\(--surface\)/);
    expect(css).toMatch(/\.topbar\s*\{[\s\S]*background: var\(--surface\)/);
    expect(css).toMatch(/\[data-power='low'\] \.modal__surface[\s\S]*background: var\(--surface\)/);
  });
});
