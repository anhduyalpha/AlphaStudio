import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Skeleton,
  StatusBadge,
  Tabs,
  Toggle,
  getNextTabIndex,
  resolveIconName,
} from '../next/components/index.jsx';

const COMPONENTS_DIR = fileURLToPath(new URL('../next/components/', import.meta.url));
const PRIMITIVES_CSS = fileURLToPath(new URL('../styles/primitives.css', import.meta.url));

describe('C2 controls expose the SPEC state contracts', () => {
  it.each(['primary', 'secondary', 'ghost', 'danger', 'icon'])(
    'renders the %s Button variant',
    (variant) => {
      const html = renderToStaticMarkup(
        <Button variant={variant} aria-label={variant === 'icon' ? 'Refresh' : undefined}>
          {variant === 'icon' ? <Icon name="refresh" /> : 'Continue'}
        </Button>,
      );
      expect(html).toContain(`button--${variant}`);
      expect(html).toContain('type="button"');
    },
  );

  it('gives a busy Button native and announced busy semantics', () => {
    const html = renderToStaticMarkup(<Button busy>Export</Button>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('button__spinner');
    expect(html).toContain('Export');
  });

  it.each(['text', 'select', 'textarea', 'color', 'range', 'checkbox'])(
    'renders a labelled %s Field',
    (variant) => {
      const html = renderToStaticMarkup(
        <Field
          label={`Example ${variant}`}
          variant={variant}
          options={variant === 'select' ? [{ value: 'one', label: 'One' }] : undefined}
          defaultValue={variant === 'range' ? 50 : undefined}
        />,
      );
      expect(html).toContain('<label');
      expect(html).toContain(`field--${variant}`);
    },
  );

  it('connects Field error and hint copy to the native control', () => {
    const html = renderToStaticMarkup(
      <Field label="Output name" hint="Include an extension" error="Use a supported extension" />,
    );
    expect(html).toContain('has-error');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]+-hint [^"]+-error"/);
    expect(html).toContain('role="alert"');
  });

  it('renders Toggle as a named native button switch', () => {
    const html = renderToStaticMarkup(<Toggle label="Keep metadata" checked />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('type="button"');
    expect(html).toContain('Keep metadata');
  });
});

describe('Tabs use one roving-tabindex keyboard model', () => {
  const items = [
    { id: 'first', label: 'First' },
    { id: 'disabled', label: 'Disabled', disabled: true },
    { id: 'last', label: 'Last' },
  ];

  it.each(['underline', 'segmented'])('renders accessible %s tabs', (variant) => {
    const html = renderToStaticMarkup(
      <Tabs aria-label="Modes" items={items} value="first" variant={variant} />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain(`tabs--${variant}`);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-disabled="true"');
  });

  it('wraps, skips disabled tabs, and supports Arrow/Home/End', () => {
    expect(getNextTabIndex(items, 0, 'ArrowRight')).toBe(2);
    expect(getNextTabIndex(items, 2, 'ArrowRight')).toBe(0);
    expect(getNextTabIndex(items, 0, 'ArrowLeft')).toBe(2);
    expect(getNextTabIndex(items, 2, 'Home')).toBe(0);
    expect(getNextTabIndex(items, 0, 'End')).toBe(2);
    expect(getNextTabIndex(items, 0, 'Enter')).toBe(0);
  });

  it('has exactly one tablist keydown implementation in the component layer', () => {
    const sources = fs
      .readdirSync(COMPONENTS_DIR)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8'))
      .join('\n');
    expect(sources.match(/onKeyDown=/g) ?? []).toHaveLength(1);
  });
});

describe('C2 status and content primitives preserve semantic roles', () => {
  it.each(['neutral', 'live', 'success', 'warning', 'danger'])(
    'renders the %s status tone',
    (tone) => {
      const html = renderToStaticMarkup(<StatusBadge tone={tone}>Ready</StatusBadge>);
      expect(html).toContain(`status-badge--${tone}`);
      expect(html).toContain('status-badge__dot');
    },
  );

  it('announces live status without relying on color alone', () => {
    const html = renderToStaticMarkup(<StatusBadge tone="live">3 active jobs</StatusBadge>);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('3 active jobs');
  });

  it('keeps EmptyState quiet by default and polite when live', () => {
    const quiet = renderToStaticMarkup(<EmptyState title="No files" />);
    const live = renderToStaticMarkup(<EmptyState title="No results" live action={<Button>Retry</Button>} />);
    expect(quiet).not.toContain('aria-live');
    expect(live).toContain('role="status"');
    expect(live).toContain('aria-live="polite"');
    expect(live).toContain('Retry');
  });

  it.each(['neutral', 'warning'])('renders a %s status Banner', (tone) => {
    const html = renderToStaticMarkup(<Banner tone={tone}>Capability notice</Banner>);
    expect(html).toContain('role="status"');
    expect(html).toContain(`banner--${tone}`);
  });

  it.each(['panel', 'flat'])('renders an opaque %s Card', (variant) => {
    const html = renderToStaticMarkup(<Card variant={variant} title="Details">Content</Card>);
    expect(html).toContain(`card--${variant}`);
    expect(html).toContain('card__header');
  });

  it.each(['block', 'row'])('renders a decorative %s Skeleton', (variant) => {
    const html = renderToStaticMarkup(<Skeleton variant={variant} />);
    expect(html).toContain(`skeleton--${variant}`);
    expect(html).toContain('aria-hidden="true"');
  });

  it('keeps Icon decorative by default, labelled when meaningful, and safe for unknown names', () => {
    const decorative = renderToStaticMarkup(<Icon name="refresh" />);
    const meaningful = renderToStaticMarkup(<Icon name="completed" label="Completed" />);
    const fallback = renderToStaticMarkup(<Icon name="not-in-the-registry" />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(meaningful).toContain('role="img"');
    expect(meaningful).toContain('<title');
    expect(resolveIconName('not-in-the-registry')).toBe('dashboard');
    expect(fallback).toContain('#icon-dashboard');
  });

  it('uses only token-driven design values in primitives.css', () => {
    const css = fs.readFileSync(PRIMITIVES_CSS, 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\s*\(/i);
    expect(css).not.toMatch(/(?<![\w#-])(?:\d+(?:\.\d+)?|\.\d+)m?s\b/);
    expect(css).not.toContain('backdrop-filter');
  });
});
