import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import securityHub from '../hubs/security';
import {
  buildSecurityJobOptions,
  defaultSecurityForm,
  validateSecurityWorkbench,
} from '../lib/securityJobOptions.js';
import {
  ARCHIVE_FORMATS,
  buildArchiveJobOptions,
  defaultArchiveForm,
  matchesArchiveAccept,
  validateArchiveWorkbench,
} from '../lib/archiveJobOptions.js';
import {
  buildArchiveTree,
  countTreeNodes,
  extractArchiveEntries,
  filterArchiveTree,
} from '../lib/archiveTree.js';
import ArchiveTreePanel from '../workbench/panels/ArchiveTreePanel.jsx';
import { getPanelLoader, validateHubReferences } from '../workbench/registry.jsx';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/App.jsx', import.meta.url)),
  'utf8',
);
const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/hooks/useSecurityArchiveWorkbench.js', import.meta.url)),
  'utf8',
);

describe('E7 Security & Archive config', () => {
  it('publishes both required modes and all operation families', () => {
    expect(securityHub.modes.map((mode) => mode.id)).toEqual(['security', 'archive']);
    expect(securityHub.modes[0]).toMatchObject({
      input: { kind: 'files', multiple: false },
      run: { job: { jobType: 'security', buildOptions: 'buildSecurityJobOptions' } },
    });
    expect(securityHub.modes[1]).toMatchObject({
      input: { kind: 'files', multiple: true },
      panels: ['archive-tree'],
      run: { job: { jobType: 'archive', buildOptions: 'buildArchiveJobOptions' } },
    });
    expect(CONTROLLER_SOURCE).toContain('SECURITY_OPERATIONS');
    expect(CONTROLLER_SOURCE).toContain('ARCHIVE_OPERATIONS');
  });

  it('resolves capabilities, builders, and the archive panel', () => {
    expect(validateHubReferences(securityHub, {
      hasCapability: () => true,
      hasAcceptList: () => true,
      hasBuilder: (id) => ['buildSecurityJobOptions', 'buildArchiveJobOptions'].includes(id),
      hasPanel: (id) => id === 'archive-tree',
    })).toEqual([]);
    expect(getPanelLoader('archive-tree', {
      './panels/ArchiveTreePanel.jsx': () => Promise.resolve({ default: ArchiveTreePanel }),
    })).toBeTypeOf('function');
  });

  it('mounts the dedicated controller without direct network primitives', () => {
    expect(APP_SOURCE).toContain(
      "import useSecurityArchiveWorkbench from './hooks/useSecurityArchiveWorkbench.js'",
    );
    expect(APP_SOURCE).toContain('mode: securityArchiveEnabled ? mode : null');
    expect(CONTROLLER_SOURCE).toContain("rememberActiveJob('security', modeId");
    expect(CONTROLLER_SOURCE).not.toMatch(/\b(XMLHttpRequest|EventSource)\b/);
  });
});

describe('E7 security job options', () => {
  it('builds exact hash, compare, and password payloads', () => {
    expect(buildSecurityJobOptions(defaultSecurityForm('hash'), ['file-1'])).toEqual({
      operation: 'hash',
      _mode: 'security',
      _uploadIds: ['file-1'],
      algorithms: ['md5', 'sha1', 'sha256', 'sha512'],
    });
    expect(buildSecurityJobOptions({
      ...defaultSecurityForm('compare'),
      algorithm: 'sha512',
      expected: 'AB'.repeat(32),
    }, ['file-2'])).toMatchObject({
      operation: 'compare',
      algorithm: 'sha512',
      expected: 'ab'.repeat(32),
    });
    expect(buildSecurityJobOptions({
      ...defaultSecurityForm('password'),
      length: '200',
      symbols: false,
    })).toMatchObject({
      operation: 'password',
      length: 128,
      symbols: false,
    });
  });

  it('validates file cardinality, checksum syntax, and password bounds', () => {
    expect(validateSecurityWorkbench(defaultSecurityForm('metadata'), []))
      .toBe('Select exactly one file for this security operation.');
    expect(validateSecurityWorkbench(defaultSecurityForm('compare'), ['file']))
      .toBe('Enter a hexadecimal checksum between 32 and 128 characters.');
    expect(validateSecurityWorkbench({
      ...defaultSecurityForm('password'),
      length: '7',
    })).toBe('Password length must be a whole number from 8 to 128.');
    expect(validateSecurityWorkbench(defaultSecurityForm('password'), [])).toBe('');
  });
});

describe('E7 archive job options and tree', () => {
  it('builds server-compatible create, extract, and inspect payloads', () => {
    expect(ARCHIVE_FORMATS.map((entry) => entry.value)).toEqual(['zip', 'tar', 'gz', '7z']);
    expect(buildArchiveJobOptions({
      ...defaultArchiveForm('create'),
      format: 'tar',
    }, ['one', 'two'])).toEqual({
      operation: 'create',
      format: 'tar',
      _mode: 'archive',
      _uploadIds: ['one', 'two'],
    });
    expect(buildArchiveJobOptions(defaultArchiveForm('extract'), ['archive']))
      .toMatchObject({ operation: 'extract', format: 'auto' });
    expect(buildArchiveJobOptions(defaultArchiveForm('inspect'), ['archive']))
      .toMatchObject({ operation: 'inspect', format: 'zip' });
  });

  it('prevents lossy GZ batches and enforces archive input cardinality', () => {
    expect(validateArchiveWorkbench({
      operation: 'create',
      format: 'gz',
    }, ['one', 'two'])).toBe('GZ creation accepts exactly one file.');
    expect(validateArchiveWorkbench(defaultArchiveForm('extract'), []))
      .toBe('Select exactly one archive to extract or inspect.');
    expect(validateArchiveWorkbench(defaultArchiveForm('inspect'), ['archive'])).toBe('');
    expect(matchesArchiveAccept({ name: 'bundle.zip', type: 'application/zip' }, '.zip,.tar'))
      .toBe(true);
    expect(matchesArchiveAccept({ name: 'notes.txt', type: 'text/plain' }, '.zip,.tar'))
      .toBe(false);
  });

  it('extracts common listing shapes and renders a semantic bounded tree', () => {
    const entries = extractArchiveEntries({
      entries: [
        { name: 'docs/readme.txt', size: 12 },
        { name: 'src/index.js', size: 24 },
      ],
    });
    const tree = buildArchiveTree(entries);
    expect(countTreeNodes(tree)).toBe(4);
    expect(countTreeNodes(filterArchiveTree(tree, 'readme'))).toBe(2);

    const markup = renderToStaticMarkup(
      <ArchiveTreePanel state={{ status: 'ready', entries }} />,
    );
    expect(markup).toContain('Contents tree');
    expect(markup).toContain('Archive entry tree');
    expect(markup).toContain('readme.txt');
    expect(markup).toContain('index.js');
  });
});
