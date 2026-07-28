import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PdfOrganizerPanel, {
  movePdfPage,
  pdfOrganizerFileIdentity,
  selectedPageSpec,
} from '../workbench/panels/PdfOrganizerPanel.jsx';
import { getPanelLoader } from '../workbench/registry.jsx';

const PANEL_SOURCE = readFileSync(
  fileURLToPath(new URL('../workbench/panels/PdfOrganizerPanel.jsx', import.meta.url)),
  'utf8',
);
const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/hooks/usePdfWorkbench.js', import.meta.url)),
  'utf8',
);
const API_SOURCE = readFileSync(
  fileURLToPath(new URL('../api/client.js', import.meta.url)),
  'utf8',
);

const operations = [
  { value: 'reorder', label: 'Reorder pages' },
  { value: 'rotate', label: 'Rotate pages' },
  { value: 'extract', label: 'Extract pages' },
  { value: 'delete-pages', label: 'Delete pages' },
  { value: 'duplicate-pages', label: 'Duplicate pages' },
];

const renderPanel = (state = {}) => renderToStaticMarkup(
  <PdfOrganizerPanel
    state={{
      operations,
      operation: 'reorder',
      pages: '',
      angle: '90',
      ...state,
    }}
    dispatch={() => {}}
  />,
);

describe('E3 PDF organizer helpers', () => {
  it('builds stable file identities and 1-based sorted page selections', () => {
    expect(pdfOrganizerFileIdentity({
      name: 'document.pdf',
      size: 42,
      lastModified: 7,
    })).toBe('document.pdf|42|7');
    expect(selectedPageSpec(new Set([4, 0, 2]))).toBe('1,3,5');
  });

  it('moves pages immutably and rejects out-of-range moves', () => {
    const order = [0, 1, 2, 3];
    expect(movePdfPage(order, 3, 1)).toEqual([0, 3, 1, 2]);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(movePdfPage(order, -1, 2)).toBe(order);
    expect(movePdfPage(order, 1, 1)).toBe(order);
  });
});

describe('E3 PDF organizer states and contracts', () => {
  it('resolves the registered panel module', () => {
    const loader = () => Promise.resolve({ default: PdfOrganizerPanel });
    expect(getPanelLoader('pdf-organizer', {
      './panels/PdfOrganizerPanel.jsx': loader,
    })).toBe(loader);
  });

  it('renders the empty state with manual controls and every supported operation', () => {
    const html = renderPanel();
    expect(html).toContain('Select one PDF');
    expect(html).toContain('Page operation');
    for (const operation of operations) expect(html).toContain(operation.label);
    expect(html).toContain('Page order');
  });

  it('renders loading, error, and bounded manual-preview states explicitly', () => {
    const file = { originalName: 'large.pdf' };
    const loading = renderPanel({ file, previewStatus: 'loading' });
    const error = renderPanel({
      file,
      previewStatus: 'error',
      previewError: 'Read failed',
    });
    const limited = renderPanel({
      file,
      previewStatus: 'limited',
      previewError: 'Preview limit reached.',
    });

    expect(loading).toContain('Loading preview');
    expect(loading).toContain('Loading PDF page preview');
    expect(error).toContain('Could not load the PDF preview');
    expect(error).toContain('Retry preview');
    expect(error).toContain('enter pages manually');
    expect(limited).toContain('Manual mode');
    expect(limited).toContain('Preview limit reached.');
  });

  it('shows the global angle only for rotate and keeps disabled state wired', () => {
    const rotate = renderPanel({
      operation: 'rotate',
      pages: '1,3',
      angle: '180',
      disabled: true,
    });
    const extract = renderPanel({ operation: 'extract' });
    expect(rotate).toContain('Clockwise angle');
    expect(rotate).toContain('value="180"');
    expect(rotate).toContain('disabled=""');
    expect(extract).not.toContain('Clockwise angle');
  });

  it('keeps network and workspace ownership outside the lazy panel', () => {
    expect(PANEL_SOURCE).not.toMatch(/from ['"].*(api|protocol|store)/);
    expect(PANEL_SOURCE).not.toMatch(/\bfetch\s*\(/);
    expect(CONTROLLER_SOURCE).toContain('api.fetchFileBlob(organizerFile.id');
    expect(CONTROLLER_SOURCE).toContain("action.type === 'set-operation'");
    expect(CONTROLLER_SOURCE).toContain("action.type === 'retry-preview'");
    expect(API_SOURCE).toContain('async fetchFileBlob(fileId, { signal } = {})');
  });

  it('retains every preview bound and cleanup path in the implementation', () => {
    expect(PANEL_SOURCE).toContain('PDF_PREVIEW_PAGE_LIMIT');
    expect(PANEL_SOURCE).toContain('PDF_PREVIEW_WINDOW_SIZE');
    expect(PANEL_SOURCE).toContain('PDF_PREVIEW_RENDER_CONCURRENCY');
    expect(PANEL_SOURCE).toContain('task?.cancel?.()');
    expect(PANEL_SOURCE).toContain('destroyDocument()');
    expect(PANEL_SOURCE).not.toContain('btoa(');
  });
});
