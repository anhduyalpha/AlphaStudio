import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Shell a11y structural (CP6)', () => {
  const palette = read('src/components/CommandPalette.jsx');
  const topbar = read('src/components/Topbar.jsx');
  const sidebar = read('src/components/Sidebar.jsx');
  const app = read('src/App.jsx');
  const settings = read('src/views/SettingsView.jsx');
  const common = read('src/components/Common.jsx');
  const converter = read('src/views/ConverterView.jsx');
  const styles = read('src/styles.css');

  it('command palette has dialog a11y, focus trap, restore, and non-tabbable scrim', () => {
    assert.match(palette, /role="dialog"/);
    assert.match(palette, /aria-modal/);
    assert.match(palette, /Escape/);
    assert.match(palette, /tabIndex=\{-1\}/);
    assert.match(palette, /previous\.focus|previousFocus|previous && typeof previous\.focus/);
    assert.match(palette, /getFocusable|querySelectorAll/);
    assert.match(palette, /ArrowDown|ArrowUp/);
  });

  it('topbar search always exposes an accessible name and menu expanded state', () => {
    assert.match(topbar, /aria-label="Search tools"/);
    assert.match(topbar, /aria-expanded=\{menuExpanded\}/);
    assert.match(topbar, /aria-controls="studio-sidebar"/);
  });

  it('mobile drawer supports Escape, focus trap, and aria-current on active route', () => {
    assert.match(sidebar, /Escape/);
    assert.match(sidebar, /getFocusable|querySelectorAll/);
    assert.match(sidebar, /aria-current=\{route === item\.id \? 'page' : undefined\}/);
    assert.match(sidebar, /id="studio-sidebar"/);
  });

  it('app provides skip link, route title, and main landmark focus target', () => {
    assert.match(app, /skip-link/);
    assert.match(app, /Skip to main content/);
    assert.match(app, /id="main-content"/);
    assert.match(app, /document\.title/);
    assert.match(app, /mainRef\.current\?\.focus/);
  });

  it('settings motion control wires useMotionPreference setMode', () => {
    assert.match(settings, /useMotionPreference/);
    assert.match(settings, /setMotionMode|setMode/);
    assert.match(settings, /label="Motion"|Motion/);
    assert.match(settings, /full|balanced|reduced/);
    assert.ok(!/Subtle animations/.test(settings), 'dead Subtle animations toggle must be removed');
  });

  it('workspace tabs support keyboard roving and progressbars expose value bounds', () => {
    assert.match(common, /ArrowRight|ArrowLeft/);
    assert.match(common, /tabIndex=\{active === tab \? 0 : -1\}/);
    assert.match(converter, /aria-valuemin=\{0\}/);
    assert.match(converter, /aria-valuemax=\{100\}/);
    assert.match(converter, /aria-label="Conversion progress"|aria-label="File progress"/);
  });

  it('skip-link styles exist so the control is visible on focus', () => {
    assert.match(styles, /\.skip-link/);
  });
});
