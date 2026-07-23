import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Shell and dashboard structural redesign', () => {
  const app = read('src/App.jsx');
  const sidebar = read('src/components/Sidebar.jsx');
  const topbar = read('src/components/Topbar.jsx');
  const palette = read('src/components/CommandPalette.jsx');
  const dashboard = read('src/views/DashboardView.jsx');

  it('shell exposes skip link, health probe, and main landmark id', () => {
    assert.match(app, /skip-link/);
    assert.match(app, /api\.health/);
    assert.match(app, /apiOnline/);
    assert.match(app, /id="main-content"/);
  });

  it('sidebar is studio rail with health and aria-current', () => {
    assert.match(sidebar, /studio-rail/);
    assert.match(sidebar, /apiOnline/);
    assert.match(sidebar, /aria-current/);
  });

  it('topbar shows live API health chip', () => {
    assert.match(topbar, /apiOnline/);
    assert.match(topbar, /API online|API offline|Local API/);
  });

  it('command palette supports arrow and enter keyboard selection', () => {
    assert.match(palette, /ArrowDown/);
    assert.match(palette, /ArrowUp/);
    assert.match(palette, /Enter/);
    assert.match(palette, /role="listbox"/);
    assert.match(palette, /aria-selected/);
  });

  it('dashboard is command center without marketing hero gallery', () => {
    assert.match(dashboard, /command-center/);
    assert.match(dashboard, /Needs attention|resumeJobs|Resume/i);
    assert.match(dashboard, /Active now|activeJobs/);
    assert.match(dashboard, /Quick launch|command-launch/);
    assert.match(dashboard, /WorkspaceHeader/);
    assert.doesNotMatch(dashboard, /dashboard-hero/);
    assert.doesNotMatch(dashboard, /AgentFanOut/);
    assert.doesNotMatch(dashboard, /One polished interface for the small tools/);
  });

  it('dashboard still uses real API stats/jobs/health only', () => {
    assert.match(dashboard, /api\.stats/);
    assert.match(dashboard, /api\.listJobs/);
    assert.match(dashboard, /api\.health/);
  });
});
