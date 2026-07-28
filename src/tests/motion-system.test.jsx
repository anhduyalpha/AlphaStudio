import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import motionPurity from '../../scripts/visual/checks/motion-purity.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('F0 motion system', () => {
  it('defines the complete §5.2 timing vocabulary once', () => {
    const tokens = read('src/styles/tokens.css');
    expect(tokens).toContain('--duration-fast: 150ms;');
    expect(tokens).toContain('--duration-base: 220ms;');
    expect(tokens).toContain('--duration-slow: 320ms;');
    expect(tokens).toContain('--duration-ambient: 2600ms;');
    expect(tokens).toContain('--duration-toast: 2600ms;');
    expect(tokens).toContain('--ease-out: cubic-bezier(0.16, 1, 0.3, 1);');
    expect(tokens).toContain('--ease-standard: cubic-bezier(0.22, 1, 0.36, 1);');
    expect(tokens).toContain('--ease-in-out: cubic-bezier(0.45, 0, 0.55, 1);');
  });

  it('covers the functional trigger table with token-only compositor motion', () => {
    const motion = read('src/styles/motion.css');
    const primitives = read('src/styles/primitives.css');

    expect(motion).toMatch(/\.route-motion[\s\S]*motion-route-enter var\(--duration-slow\) var\(--ease-out\)/);
    expect(motion).toMatch(/\.tabs__panel:not\(\[hidden\]\)[\s\S]*var\(--duration-base\)/);
    expect(motion).toMatch(/tabs__tab\[aria-selected='true'\]::after[\s\S]*motion-tab-indicator/);
    expect(motion).toMatch(/\.button__icon,[\s\S]*transition: transform var\(--duration-fast\)/);
    expect(motion).toMatch(/modal-layer--exit \.modal__surface[\s\S]*var\(--duration-slow\)/);
    expect(primitives).toContain('transform: scaleX(var(--progress-scale));');
    expect(primitives).toContain('animation: progress-bar-slide calc(var(--duration-ambient) / 2)');
    expect(primitives).toContain('animation: toast-enter var(--duration-base)');
    expect(primitives).toContain('animation: toast-exit var(--duration-base)');
    expect(primitives).toMatch(/\.dropzone\.is-drag-over[\s\S]*transform: scale\(1\.01\)/);
  });

  it('keeps ambient-1 exclusive to full power and gives reduced mode static indicators', () => {
    const motion = read('src/styles/motion.css');
    const primitives = read('src/styles/primitives.css');

    expect(primitives).not.toMatch(/status-badge--live[\s\S]{0,160}animation:/);
    expect(motion).toMatch(/html\[data-motion='full'\]:not\(\[data-power='low'\]\)[\s\S]*primitive-pulse/);
    expect(motion).toMatch(/html\[data-power='low'\][\s\S]*animation: none/);
    expect(motion).toMatch(/html\[data-motion='reduced'\] \*,[\s\S]*animation: none !important/);
    expect(motion).toMatch(/html\[data-motion='reduced'\] \.skeleton[\s\S]*background: var\(--surface-2\)/);
    expect(motion).toMatch(/html\[data-motion='reduced'\] \.progress-bar--indeterminate[\s\S]*repeating-linear-gradient/);
    expect(motion).toMatch(/html\[data-motion='reduced'\] \.progress-bar__fill,[\s\S]*transition-duration: var\(--duration-fast\)/);
  });

  it('mounts one route entrance boundary and loads motion after component styles', () => {
    const app = read('src/next/App.jsx');
    const workbenchImport = app.indexOf("import '../styles/workbench.css';");
    const motionImport = app.indexOf("import '../styles/motion.css';");
    expect(workbenchImport).toBeGreaterThan(-1);
    expect(motionImport).toBeGreaterThan(workbenchImport);
    expect(app).toContain('<div className="route-motion" key={route.id}>');
  });

  it('keeps modal and drawer exit surfaces mounted for their exit motion', () => {
    const modal = read('src/next/components/Modal.jsx');
    const sidebar = read('src/next/components/Sidebar.jsx');
    expect(modal).toContain("setPhase('exit')");
    expect(modal).toContain("getPropertyValue('--duration-slow')");
    expect(modal).toContain('onAnimationEnd');
    expect(sidebar).toContain("'sidebar__scrim', mobileOpen ? 'is-visible' : ''");
    expect(sidebar).toContain('disabled={!mobileOpen}');
  });

  it('combines save-data and the normative below-20% battery threshold', () => {
    const hook = read('src/hooks/useMotionPreference.js');
    expect(hook).toContain('battery.level < 0.2');
    expect(hook).toContain('saveData || batteryLow');
    expect(hook).toContain("addEventListener?.('change', updateConnection)");
    expect(hook).toContain("removeEventListener?.('levelchange', updateBattery)");
  });

  it('rejects forbidden properties and non-§5.2 tokens in multiline transitions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alphastudio-motion-'));
    temporaryRoots.push(root);
    const stylesDir = path.join(root, 'styles');
    fs.mkdirSync(stylesDir, { recursive: true });
    fs.writeFileSync(path.join(stylesDir, 'bad.css'), `
      .bad {
        transition:
          width var(--duration-fast) var(--ease-standard),
          opacity var(--motion-fast) var(--ease-standard);
      }
    `);

    const result = motionPurity({ stylesDir, jsxDirs: [], root });
    expect(result.status).toBe('fail');
    expect(result.violations.join('\n')).toContain('non-compositor transition property "width"');
    expect(result.violations.join('\n')).toContain('transition must use a §5.2 duration token');
  });
});
