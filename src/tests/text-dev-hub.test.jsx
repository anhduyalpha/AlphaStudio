import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import textDevHub from '../hubs/textdev';
import {
  DEV_OPERATIONS,
  applyEditorCase,
  buildTextWorkbenchJobOptions,
  defaultTextForm,
  textOperationsFor,
  validateTextWorkbench,
} from '../lib/textJobOptions.js';
import {
  MAX_DIFF_LINES,
  boundedDiffLines,
  summarizeDiff,
} from '../lib/textDiff.js';
import ComparePanel from '../workbench/panels/ComparePanel.jsx';
import DiffPanel from '../workbench/panels/DiffPanel.jsx';
import { getPanelLoader, validateHubReferences } from '../workbench/registry.jsx';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/App.jsx', import.meta.url)),
  'utf8',
);
const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/hooks/useTextDevWorkbench.js', import.meta.url)),
  'utf8',
);

describe('E6 Text & Dev config', () => {
  it('publishes the four required modes and exact developer utility parity', () => {
    expect(textDevHub.modes.map((mode) => mode.id)).toEqual(['text', 'editor', 'ocr', 'dev']);
    expect(textDevHub.modes[1]).toMatchObject({
      input: { kind: 'text' },
      panels: ['compare', 'diff'],
      run: { local: { compute: 'computeTextEditor' } },
    });
    expect(textDevHub.modes[2]).toMatchObject({
      capabilityIds: ['text.ocr'],
      run: { job: { jobType: 'text' } },
    });
    expect(DEV_OPERATIONS.map((entry) => entry.label)).toEqual([
      'JSON Formatter',
      'Base64 Encode',
      'Base64 Decode',
      'URL Encode',
      'URL Decode',
      'SHA-256 Hash',
      'Text Cleaner',
      'UUID Generator',
    ]);
  });

  it('resolves config builders, local compute, and editor panels', () => {
    expect(validateHubReferences(textDevHub, {
      hasCapability: () => true,
      hasAcceptList: () => true,
      hasBuilder: (id) => id === 'buildTextJobOptions',
      hasCompute: (id) => id === 'computeTextEditor',
      hasPanel: (id) => ['compare', 'diff'].includes(id),
    })).toEqual([]);
    expect(getPanelLoader('compare', {
      './panels/ComparePanel.jsx': () => Promise.resolve({ default: ComparePanel }),
    })).toBeTypeOf('function');
    expect(getPanelLoader('diff', {
      './panels/DiffPanel.jsx': () => Promise.resolve({ default: DiffPanel }),
    })).toBeTypeOf('function');
  });

  it('mounts the dedicated controller through the next shell', () => {
    expect(APP_SOURCE).toContain("import useTextDevWorkbench from './hooks/useTextDevWorkbench.js'");
    expect(APP_SOURCE).toContain('mode: textDevEnabled ? mode : null');
    expect(CONTROLLER_SOURCE).toContain('buildTextWorkbenchJobOptions');
    expect(CONTROLLER_SOURCE).toContain("rememberActiveJob('text', modeId");
    expect(CONTROLLER_SOURCE).not.toMatch(/\b(fetch|XMLHttpRequest|EventSource)\b/);
  });
});

describe('E6 text job options', () => {
  it('builds server-compatible file and inline utility payloads', () => {
    expect(buildTextWorkbenchJobOptions({
      mode: 'text',
      form: { ...defaultTextForm('text', 'case'), caseMode: 'snake' },
      uploadIds: ['file-1'],
    })).toEqual({
      operation: 'case',
      _mode: 'text',
      _uploadIds: ['file-1'],
      caseMode: 'snake',
    });
    expect(buildTextWorkbenchJobOptions({
      mode: 'dev',
      form: { ...defaultTextForm('dev', 'format-json'), indent: '4', sortKeys: true },
      input: '{"b":2,"a":1}',
    })).toEqual({
      operation: 'format-json',
      _mode: 'dev',
      _uploadIds: [],
      input: '{"b":2,"a":1}',
      indent: 4,
      sortKeys: true,
    });
    expect(buildTextWorkbenchJobOptions({
      mode: 'dev',
      form: { ...defaultTextForm('dev', 'uuid'), uuidCount: '999' },
      input: 'unused',
    })).toEqual({
      operation: 'uuid',
      _mode: 'dev',
      _uploadIds: [],
      count: 100,
    });
  });

  it('validates file cardinality and inline input without inventing server operations', () => {
    expect(textOperationsFor('text').map((entry) => entry.id)).toEqual([
      'cleanup', 'word-count', 'case', 'hash',
    ]);
    expect(validateTextWorkbench({
      mode: 'text',
      form: defaultTextForm('text'),
      uploadIds: [],
    })).toBe('Select one source file.');
    expect(validateTextWorkbench({
      mode: 'dev',
      form: defaultTextForm('dev', 'base64-encode'),
      input: '',
    })).toBe('Enter text for this utility.');
    expect(validateTextWorkbench({
      mode: 'dev',
      form: defaultTextForm('dev', 'uuid'),
      input: '',
    })).toBe('');
  });
});

describe('E6 bounded editor and diff panels', () => {
  it('bounds diff work while preserving a reader-facing truncation signal', () => {
    const left = Array.from({ length: MAX_DIFF_LINES + 20 }, (_, index) => `left ${index}`).join('\n');
    const right = Array.from({ length: MAX_DIFF_LINES + 20 }, (_, index) => `right ${index}`).join('\n');
    const result = boundedDiffLines(left, right);
    expect(result.truncated).toBe(true);
    expect(result.hunks.length).toBeLessThanOrEqual(MAX_DIFF_LINES * 2);
    expect(summarizeDiff(result.hunks)).toMatchObject({ added: MAX_DIFF_LINES, removed: MAX_DIFF_LINES });
  });

  it('renders editor stats/actions and a semantic line diff', () => {
    const compareMarkup = renderToStaticMarkup(
      <ComparePanel state={{
        visible: true,
        input: 'Alpha beta',
        comparison: 'Alpha gamma',
        stats: { words: 2, characters: 10, lines: 1 },
      }} />,
    );
    expect(compareMarkup).toContain('Measure and compare');
    expect(compareMarkup).toContain('Compare against');
    expect(compareMarkup).toContain('2</strong> words');

    const diffMarkup = renderToStaticMarkup(
      <DiffPanel state={{ visible: true, left: 'Alpha\nBeta', right: 'Alpha\nGamma' }} />,
    );
    expect(diffMarkup).toContain('Changes detected');
    expect(diffMarkup).toContain('data-diff-type="remove"');
    expect(diffMarkup).toContain('data-diff-type="add"');
  });

  it('keeps case transforms local and deterministic', () => {
    expect(applyEditorCase('hello WORLD', 'title')).toBe('Hello World');
    expect(applyEditorCase('hello', 'upper')).toBe('HELLO');
  });
});
