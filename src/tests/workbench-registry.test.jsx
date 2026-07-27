import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { hubRegistry } from '../hubs/index';
import Workbench, {
  selectedWorkbenchFiles,
  workbenchProgress,
} from '../workbench/Workbench.jsx';
import RegisteredPanel, {
  getPanelLoader,
  knownPanelKeys,
  panelPaths,
  validateHubReferences,
} from '../workbench/registry.jsx';

const APP = fileURLToPath(new URL('../next/App.jsx', import.meta.url));
const WORKBENCH = fileURLToPath(new URL('../workbench/Workbench.jsx', import.meta.url));
const CSS = fileURLToPath(new URL('../styles/workbench.css', import.meta.url));

describe('D3 lazy panel registry', () => {
  it('publishes the complete normative panel-key set', () => {
    expect(knownPanelKeys).toEqual([
      'pdf-organizer',
      'qr-designer',
      'color-lab',
      'waveform',
      'timeline',
      'media-preview',
      'crop',
      'diff',
      'archive-tree',
      'compare',
    ]);
    expect(Object.keys(panelPaths)).toEqual(knownPanelKeys);
  });

  it('resolves discovered panel modules lazily without importing future files eagerly', () => {
    const loader = async () => ({ default: () => <div>Panel</div> });
    const modules = { './panels/CropPanel.jsx': loader };
    expect(getPanelLoader('crop', modules)).toBe(loader);
    expect(getPanelLoader('missing-panel', modules)).toBeNull();
  });

  it('renders a persistent ErrorState naming an unknown key', () => {
    const html = renderToStaticMarkup(<RegisteredPanel panelKey="missing-panel" />);
    expect(html).toContain('error-state');
    expect(html).toContain('Panel &quot;missing-panel&quot; is unavailable');
    expect(html).toContain('Continue without panel');
  });
});

describe('D3 hub reference validation', () => {
  it('accepts the D1 route-only stubs until their E units fill the config fields', () => {
    for (const hub of hubRegistry) {
      expect(validateHubReferences(hub), hub.id).toEqual([]);
    }
  });

  it('validates every normative reference family through injected resolvers', () => {
    const hub = {
      id: 'example',
      modes: [{
        id: 'edit',
        capabilityIds: ['cap.edit'],
        input: { kind: 'files', acceptFrom: 'images' },
        panels: ['crop'],
        run: {
          job: { buildOptions: 'buildEditOptions' },
          local: { compute: 'computeEdit' },
        },
      }],
    };
    const resolvers = {
      hasCapability: (key) => key === 'cap.edit',
      hasAcceptList: (key) => key === 'images',
      hasPanel: (key) => key === 'crop',
      hasBuilder: (key) => key === 'buildEditOptions',
      hasCompute: (key) => key === 'computeEdit',
    };
    expect(validateHubReferences(hub, resolvers)).toEqual([]);
    expect(validateHubReferences(hub)).toEqual([
      'example:edit unknown capability "cap.edit"',
      'example:edit unknown accept list "images"',
      'example:edit unknown options builder "buildEditOptions"',
      'example:edit unknown compute "computeEdit"',
    ]);
  });
});

describe('D3 canonical Workbench flow', () => {
  it('uses the store composed-progress selector and arithmetic mean', () => {
    const snapshot = {
      selectedFileIds: ['one', 'two'],
      files: [
        { id: 'one', composedProgress: 30 },
        { id: 'two', composedProgress: 90 },
        { id: 'ignored', composedProgress: 100 },
      ],
    };
    expect(selectedWorkbenchFiles(snapshot).map((file) => file.id)).toEqual(['one', 'two']);
    expect(workbenchProgress(snapshot)).toBe(60);
  });

  it('renders mode, input, configure, results, and exactly one persistent run bar', () => {
    const hub = {
      id: 'example',
      name: 'Example Studio',
      icon: 'tools-manager',
      modes: [{ id: 'default', name: 'Default mode' }],
    };
    const html = renderToStaticMarkup(<Workbench hub={hub} mode={hub.modes[0]} />);
    expect(html).toContain('aria-label="Example Studio workbench"');
    expect(html).toContain('aria-label="Example Studio modes"');
    expect(html).toContain('>Input<');
    expect(html).toContain('>Configure<');
    expect(html).toContain('>Results<');
    expect(html).toContain('This mode is not implemented yet.');
    expect(html.match(/class="run-bar(?:\s|")/g) ?? []).toHaveLength(1);
  });

  it('mounts from App for every hub without hub-name special cases', () => {
    const appSource = fs.readFileSync(APP, 'utf8');
    const workbenchSource = fs.readFileSync(WORKBENCH, 'utf8');
    expect(appSource).toContain("import Workbench from '../workbench/Workbench.jsx'");
    expect(appSource).toContain("<Workbench\n              hub={route.hub}");
    expect(workbenchSource).not.toMatch(/hub\.(?:id|name)\s*===/);
    expect(workbenchSource).toContain('selectRunProgress(snapshot');
    expect(workbenchSource).toContain('mode.panels || []');
  });

  it('uses the 1200/900 canonical columns and a single-column mobile run layout', () => {
    const css = fs.readFileSync(CSS, 'utf8');
    expect(css).toContain('minmax(280px, var(--rail-width))');
    expect(css).toContain('@media (max-width: 1200px)');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toMatch(/\.workbench__run\s*\{[\s\S]*position: sticky/);
  });
});
