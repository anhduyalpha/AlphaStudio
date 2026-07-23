import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('UX/UI redesign foundations structural', () => {
  const styles = read('src/styles.css');
  const common = read('src/components/Common.jsx');
  const workbench = read('src/components/Workbench.jsx');
  const tokensDoc = read('docs/UX_UI_REDESIGN_BLUEPRINT.md');

  it('defines semantic spacing, motion, and family token scale', () => {
    assert.match(styles, /--space-1:/);
    assert.match(styles, /--space-7:/);
    assert.match(styles, /--duration-fast:/);
    assert.match(styles, /--duration-base:/);
    assert.match(styles, /--success:/);
    assert.match(styles, /--focus-ring:/);
    assert.match(styles, /--workbench-rail-width:/);
    assert.match(styles, /--family-accent/);
  });

  it('ships WorkbenchLayout stage/rail/runbar regions', () => {
    assert.match(workbench, /export function WorkbenchLayout/);
    assert.match(workbench, /workbench-stage/);
    assert.match(workbench, /workbench-rail/);
    assert.match(workbench, /workbench-runbar/);
    assert.match(styles, /\.workbench-layout/);
    assert.match(styles, /\.workbench-body/);
  });

  it('ships WorkspaceHeader and keeps PageIntro as adapter', () => {
    assert.match(workbench, /export function WorkspaceHeader/);
    assert.match(common, /WorkspaceHeader/);
    assert.match(common, /export function PageIntro/);
    assert.match(common, /meta=\{eyebrow\}/);
  });

  it('redesigns buttons with liquid-press and busy state', () => {
    assert.match(common, /liquid-press/);
    assert.match(common, /busy/);
    assert.match(common, /aria-busy/);
    assert.match(common, /IconButton/);
    assert.match(styles, /\.liquid-press/);
  });

  it('adds FeatureRail, Panel, field error contracts, ProgressWave', () => {
    assert.match(common, /export function FeatureRail/);
    assert.match(common, /export function Panel/);
    assert.match(common, /field-error/);
    assert.match(workbench, /export function ProgressWave/);
    assert.match(workbench, /export function CapabilityBanner/);
    assert.match(workbench, /export function Skeleton/);
  });

  it('includes reduced-motion and reduced-transparency fallbacks', () => {
    assert.match(styles, /prefers-reduced-motion:\s*reduce/);
    assert.match(styles, /prefers-reduced-transparency:\s*reduce/);
    assert.match(styles, /data-motion="reduce"/);
  });

  it('blueprint selected Studio Rail \\+ Workbench direction', () => {
    assert.match(tokensDoc, /Studio Rail \+ Workbench/);
    assert.match(tokensDoc, /command center/i);
    assert.match(tokensDoc, /conversion board/i);
  });
});
