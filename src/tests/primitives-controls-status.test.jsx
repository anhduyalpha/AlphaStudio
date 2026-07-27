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
  getEffectiveTabValue,
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

  it('preserves and merges caller-owned Field accessibility relationships', () => {
    const externalOnly = renderToStaticMarkup(
      <Field
        label="Output"
        aria-describedby="external-help"
        aria-invalid="grammar"
      />,
    );
    const merged = renderToStaticMarkup(
      <Field
        label="Output"
        hint="Local hint"
        error="Local error"
        aria-describedby="external-help"
        aria-invalid="false"
      />,
    );
    expect(externalOnly).toContain('aria-describedby="external-help"');
    expect(externalOnly).toContain('aria-invalid="grammar"');
    expect(merged).toMatch(/aria-describedby="external-help [^"]+-hint [^"]+-error"/);
    expect(merged).toContain('aria-invalid="true"');
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

  it('normalizes missing, removed, and disabled selections to an enabled tab', () => {
    expect(getEffectiveTabValue(items, undefined)).toBe('first');
    expect(getEffectiveTabValue(items, 'missing')).toBe('first');
    expect(getEffectiveTabValue(items, 'disabled')).toBe('first');
    expect(getEffectiveTabValue(items, 'last')).toBe('last');
    expect(getEffectiveTabValue([], undefined)).toBeUndefined();
    expect(getEffectiveTabValue(items.map((item) => ({ ...item, disabled: true })), 'first')).toBeUndefined();
  });

  it.each([
    { label: 'missing controlled value', props: { value: 'missing' } },
    { label: 'disabled controlled value', props: { value: 'disabled' } },
    { label: 'missing default value', props: { defaultValue: 'missing' } },
    { label: 'async population fallback', props: {} },
  ])('keeps one reachable tab stop for $label', ({ props }) => {
    const html = renderToStaticMarkup(<Tabs aria-label="Modes" items={items} {...props} />);
    expect(html.match(/tabindex="0"/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"/);
  });

  it('keeps every tab out of the order when all items are disabled', () => {
    const disabledItems = items.map((item) => ({ ...item, disabled: true }));
    const html = renderToStaticMarkup(<Tabs aria-label="Modes" items={disabledItems} value="first" />);
    expect(html).not.toContain('tabindex="0"');
    expect(html.match(/tabindex="-1"/g) ?? []).toHaveLength(disabledItems.length);
  });

  it('has exactly one tablist owner without blocking unrelated keyboard handlers', () => {
    const sources = fs
      .readdirSync(COMPONENTS_DIR)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => ({
        file,
        source: fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8'),
      }));
    const owners = sources.filter(({ source }) => source.includes('role="tablist"'));
    expect(owners.map(({ file }) => file)).toEqual(['Tabs.jsx']);
    expect(owners.flatMap(({ source }) => source.match(/role="tablist"/g) ?? [])).toHaveLength(1);
    expect(owners[0].source.match(/onKeyDown=/g) ?? []).toHaveLength(1);
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

  it('keeps interactive Card actions outside its native button target', () => {
    const html = renderToStaticMarkup(
      <Card
        interactive
        as="div"
        title="Recent workspace"
        actions={<Button variant="icon" aria-label="More actions"><Icon name="menu" /></Button>}
      >
        Open workspace
      </Card>,
    );
    expect(html).toMatch(/^<section class="card card--panel is-interactive">/);
    expect(html).toContain('class="card__interactive"');
    expect(html.match(/<button/g) ?? []).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  });

  it.each(['button', 'a'])('forces a safe wrapper for interactive Card as="%s"', (as) => {
    const html = renderToStaticMarkup(
      <Card interactive as={as} href={as === 'a' ? '/workspace' : undefined}>
        Open workspace
      </Card>,
    );
    expect(html).toMatch(/^<section class="card card--panel is-interactive">/);
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).not.toMatch(/^<(?:button|a)\b/);
    expect(html).not.toContain('href=');
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
