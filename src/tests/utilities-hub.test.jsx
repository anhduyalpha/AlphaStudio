import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import utilitiesHub from '../hubs/utilities';
import {
  buildQrJobOptions,
  defaultQrForm,
  extractDecodedQrText,
  validateQrWorkbench,
} from '../lib/qrJobOptions.js';
import {
  buildColorImageJobOptions,
  computeColorLab,
  defaultColorForm,
  extractPaletteFromImageData,
  validateColorImageJob,
} from '../lib/colorPalette.js';
import {
  detectImageMimeFromBytes,
  safeClipboardFilename,
  validateClipboardImageBlob,
} from '../lib/clipboardImage.js';
import ColorLabPanel from '../workbench/panels/ColorLabPanel.jsx';
import QrDesignerPanel from '../workbench/panels/QrDesignerPanel.jsx';
import { getPanelLoader, validateHubReferences } from '../workbench/registry.jsx';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/App.jsx', import.meta.url)),
  'utf8',
);
const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/hooks/useUtilitiesWorkbench.js', import.meta.url)),
  'utf8',
);

describe('E8 Utilities config', () => {
  it('publishes QR and Color with the normative dual local + job shape', () => {
    expect(utilitiesHub.modes.map((mode) => mode.id)).toEqual(['qr', 'color']);
    expect(utilitiesHub.modes[0]).toMatchObject({
      panels: ['qr-designer'],
      run: { job: { jobType: 'qr', buildOptions: 'buildQrJobOptions' } },
    });
    expect(utilitiesHub.modes[1]).toMatchObject({
      panels: ['color-lab'],
      run: {
        local: { compute: 'computeColorLab' },
        job: { jobType: 'image', buildOptions: 'buildColorImageJobOptions' },
      },
    });
  });

  it('resolves every builder, compute, capability, and specialized panel', () => {
    expect(validateHubReferences(utilitiesHub, {
      hasCapability: () => true,
      hasAcceptList: () => true,
      hasBuilder: (id) => ['buildQrJobOptions', 'buildColorImageJobOptions'].includes(id),
      hasCompute: (id) => id === 'computeColorLab',
      hasPanel: (id) => ['qr-designer', 'color-lab'].includes(id),
    })).toEqual([]);
    expect(getPanelLoader('qr-designer', {
      './panels/QrDesignerPanel.jsx': () => Promise.resolve({ default: QrDesignerPanel }),
    })).toBeTypeOf('function');
    expect(getPanelLoader('color-lab', {
      './panels/ColorLabPanel.jsx': () => Promise.resolve({ default: ColorLabPanel }),
    })).toBeTypeOf('function');
  });

  it('mounts one controller through the next shell and keeps panels network-free', () => {
    expect(APP_SOURCE).toContain("import useUtilitiesWorkbench from './hooks/useUtilitiesWorkbench.js'");
    expect(APP_SOURCE).toContain('mode: utilitiesEnabled ? mode : null');
    expect(CONTROLLER_SOURCE).toContain("rememberActiveJob('utilities', modeId");
    expect(CONTROLLER_SOURCE).not.toMatch(/\b(XMLHttpRequest|EventSource)\b/);
  });
});

describe('E8 QR options and paste-decode safety', () => {
  it('builds bounded generate and file-only decode payloads', () => {
    expect(buildQrJobOptions({
      ...defaultQrForm(),
      format: 'svg',
      size: '4096',
      margin: '99',
      content: 'AlphaStudio',
      ecc: 'H',
    })).toEqual({
      operation: 'generate',
      _mode: 'qr',
      _uploadIds: [],
      content: 'AlphaStudio',
      format: 'svg',
      size: 2048,
      dark: '#0f172a',
      light: '#ffffff',
      ecc: 'H',
      margin: 16,
    });
    expect(buildQrJobOptions(defaultQrForm('decode'), ['image-1'])).toEqual({
      operation: 'decode',
      _mode: 'qr',
      _uploadIds: ['image-1'],
    });
  });

  it('validates QR content and decode cardinality', () => {
    expect(validateQrWorkbench({ ...defaultQrForm(), content: '' }, []))
      .toBe('Enter content to encode.');
    expect(validateQrWorkbench(defaultQrForm('decode'), []))
      .toBe('Select exactly one QR image to decode.');
    expect(validateQrWorkbench(defaultQrForm('decode'), ['image'])).toBe('');
    expect(extractDecodedQrText({ text: 'https://example.test' })).toBe('https://example.test');
  });

  it('keeps pasted images bounded and rejects non-images before upload', () => {
    expect(safeClipboardFilename('image/png', new Date('2026-07-28T01:02:03Z')))
      .toBe('clipboard-2026-07-28_01-02-03.png');
    expect(validateClipboardImageBlob(new Blob(['text'], { type: 'text/plain' })))
      .toMatchObject({ ok: false, code: 'NOT_IMAGE' });
    expect(detectImageMimeFromBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47])))
      .toBe('image/png');
  });
});

describe('E8 Color local compute and image job', () => {
  it('computes picker, contrast, gradient, and palette values in the browser', () => {
    const result = computeColorLab({
      ...defaultColorForm(),
      colorMode: 'contrast',
      foreground: '#ffffff',
      background: '#000000',
    });
    expect(result.rgb).toEqual({ r: 155, g: 124, b: 255 });
    expect(result.palette).toHaveLength(5);
    expect(result.contrast.ratio).toBe(21);
    expect(result.contrast.grade).toMatchObject({ aaBody: true, aaaBody: true });
    expect(result.gradient).toBe('linear-gradient(135deg, #9b7cff, #49dbe8)');
  });

  it('samples real pixels and builds optional Sharp job options', () => {
    const palette = extractPaletteFromImageData({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]),
    }, { sampleStep: 1, maxColors: 2, bits: 4 });
    expect(palette).toEqual(['#ff0000', '#0000ff']);
    expect(buildColorImageJobOptions({
      ...defaultColorForm(),
      colorMode: 'image',
      imageOperation: 'optimize',
      quality: '120',
    }, ['image'])).toEqual({
      operation: 'optimize',
      _mode: 'color',
      _uploadIds: ['image'],
      format: 'png',
      quality: 100,
    });
    expect(validateColorImageJob({ colorMode: 'image' }, []))
      .toBe('Select exactly one image for the color workflow.');
  });

  it('renders QR and Color specialized panels with reader-facing state', () => {
    const qrMarkup = renderToStaticMarkup(
      <QrDesignerPanel state={{ form: defaultQrForm(), status: 'idle' }} />,
    );
    expect(qrMarkup).toContain('QR designer');
    expect(qrMarkup).toContain('Ready to generate');
    expect(qrMarkup).toContain('Error correction');

    const colorResult = computeColorLab(defaultColorForm());
    const colorMarkup = renderToStaticMarkup(
      <ColorLabPanel state={{ form: defaultColorForm(), result: colorResult, status: 'idle' }} />,
    );
    expect(colorMarkup).toContain('Browser color lab');
    expect(colorMarkup).toContain('RGB');
    expect(colorMarkup).toContain('155, 124, 255');
  });
});
