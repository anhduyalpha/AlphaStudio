import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import pdfHub from '../hubs/pdf';
import {
  buildPdfJobRequest,
  buildPdfResultRows,
  buildPdfRetryRequest,
  publishedPdfOperations,
  unsupportedPdfOptionKeys,
  validatePdfClient,
} from '../lib/pdfJobOptions.js';
import Workbench from '../workbench/Workbench.jsx';
import { validateHubReferences } from '../workbench/registry.jsx';

const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/hooks/usePdfWorkbench.js', import.meta.url)),
  'utf8',
);
const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/App.jsx', import.meta.url)),
  'utf8',
);
const WORKBENCH_CSS = readFileSync(
  fileURLToPath(new URL('../styles/workbench.css', import.meta.url)),
  'utf8',
);

const published = (...operations) => ({
  pdf: { operations },
});

const descriptor = (id = 'merge', options = []) => ({
  id,
  capability: `pdf.${id}`,
  cardinality: { minFiles: id === 'merge' ? 2 : 1, maxFiles: id === 'merge' ? 20 : 1 },
  options,
  outputKinds: ['pdf'],
  enginePolicy: {
    strategy: 'bundled',
    engines: ['pdf-lib'],
    fallback: 'none',
  },
});

describe('E2 PDF hub config', () => {
  it('declares operational, organizer, and export mode contracts', () => {
    expect(pdfHub.modes.map((mode) => mode.id)).toEqual([
      'operations',
      'organize',
      'export',
    ]);
    expect(pdfHub.modes[0]).toMatchObject({
      input: {
        kind: 'files',
        acceptFromJob: 'pdf',
        selectable: true,
        reorderable: true,
      },
      run: {
        job: { jobType: 'pdf', buildOptions: 'buildPdfJobOptions' },
      },
      results: { kind: 'files', history: true },
    });
    expect(pdfHub.modes[1].panels).toEqual(['pdf-organizer']);
    expect(pdfHub.modes[2]).toMatchObject({
      input: { kind: 'none' },
      run: { action: 'downloadPdfOutputs' },
      results: { history: true },
    });
  });

  it('resolves every config reference through the canonical registry', () => {
    expect(validateHubReferences(pdfHub, {
      hasCapability: () => false,
      hasAcceptList: () => false,
      hasBuilder: (id) => id === 'buildPdfJobOptions',
      hasCompute: () => false,
      hasPanel: (id) => id === 'pdf-organizer',
    })).toEqual([]);
  });

  it('uses protocol contracts and the upload orchestrator without parallel HTTP', () => {
    expect(CONTROLLER_SOURCE).toContain('publishedPdfOperations(contract.contract.raw)');
    expect(CONTROLLER_SOURCE).toContain('gatedOperation(operation.capability)');
    expect(CONTROLLER_SOURCE).toContain("acceptAttributeFor('pdf', operation.id)");
    expect(CONTROLLER_SOURCE).toContain('createUploadTask(file');
    expect(CONTROLLER_SOURCE).not.toMatch(/\b(fetch|XMLHttpRequest|EventSource)\b/);
  });

  it('isolates each controller from mode schemas owned by other hubs', () => {
    expect(APP_SOURCE).toContain('mode: convertEnabled ? mode : null');
    expect(APP_SOURCE).toContain('mode: pdfEnabled ? mode : null');
  });

  it('keeps input filenames readable when file actions are present', () => {
    expect(WORKBENCH_CSS).toMatch(
      /\.workbench__input \.file-row[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/,
    );
    expect(WORKBENCH_CSS).toMatch(
      /\.workbench__input \.file-row__actions[\s\S]*grid-column: 1 \/ -1/,
    );
  });
});

describe('E2 published PDF operation contract', () => {
  it('fails closed when the PDF section is missing or malformed', () => {
    expect(publishedPdfOperations({})).toEqual([]);
    expect(publishedPdfOperations(published({
      id: 'merge',
      capability: 'pdf.merge',
      cardinality: {},
      options: 'not-an-array',
    }))).toEqual([]);
  });

  it('keeps backend execution metadata and attaches presentation labels only', () => {
    expect(publishedPdfOperations(published(
      descriptor('merge'),
      descriptor('rotate', ['pages', 'angle']),
    ))).toEqual([
      expect.objectContaining({
        id: 'merge',
        capability: 'pdf.merge',
        label: 'Merge PDFs',
        group: 'organize',
        cardinality: { minFiles: 2, maxFiles: 20 },
      }),
      expect.objectContaining({
        id: 'rotate',
        capability: 'pdf.rotate',
        options: ['pages', 'angle'],
      }),
    ]);
  });

  it('blocks forward option keys instead of silently dropping them', () => {
    expect(unsupportedPdfOptionKeys({ options: ['pages', 'futureOption'] }))
      .toEqual(['futureOption']);
  });
});

describe('E2 immutable PDF attempts and export rows', () => {
  it('preserves upload order in the canonical request', () => {
    expect(buildPdfJobRequest({
      workspaceId: 'ws',
      uploadIds: ['second', 'first', 'second'],
      clientRequestId: 'attempt-1',
      operation: 'merge',
    })).toEqual({
      type: 'pdf',
      workspaceId: 'ws',
      uploadIds: ['second', 'first'],
      clientRequestId: 'attempt-1',
      options: {
        operation: 'merge',
        _uploadIds: ['second', 'first'],
      },
    });
  });

  it('validates required page input from the operation id and sends the OCR limit', () => {
    expect(validatePdfClient({
      operation: 'extract',
      files: [{ name: 'source.pdf', type: 'application/pdf' }],
      opMeta: descriptor('extract', ['pages']),
    })).toMatch(/page selection is required/i);
    expect(buildPdfJobRequest({
      workspaceId: 'ws',
      uploadIds: ['source'],
      clientRequestId: 'attempt-ocr',
      operation: 'ocr',
      form: { ocrLang: 'vie', ocrPageLimit: '240' },
    }).options).toMatchObject({
      operation: 'ocr',
      ocr: true,
      ocrLang: 'vie',
      ocrPageLimit: 200,
    });
  });

  it('retries a failed PDF job as a new immutable attempt', () => {
    const retry = buildPdfRetryRequest({
      workspaceId: 'ws',
      clientRequestId: 'attempt-2',
      job: {
        id: 'failed-1',
        type: 'pdf',
        status: 'failed',
        options: {
          operation: 'merge',
          _uploadIds: ['second', 'first'],
        },
      },
    });
    expect(retry.clientRequestId).toBe('attempt-2');
    expect(retry.uploadIds).toEqual(['second', 'first']);
    expect(() => buildPdfRetryRequest({
      workspaceId: 'ws',
      clientRequestId: 'attempt-3',
      job: { type: 'pdf', status: 'completed', options: {} },
    })).toThrow(/failed PDF job/i);
  });

  it('joins output history to PDF attempts and leaves failed rows recoverable', () => {
    const rows = buildPdfResultRows({
      files: [{ id: 'source', originalName: 'source.pdf' }],
      jobs: [
        {
          id: 'done',
          type: 'pdf',
          status: 'completed',
          progress: 100,
          options: { operation: 'split', _uploadIds: ['source'] },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'failed',
          type: 'pdf',
          status: 'failed',
          progress: 20,
          error: 'Bad page range',
          options: { operation: 'extract', _uploadIds: ['source'] },
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      outputs: [{
        id: 'output',
        jobId: 'done',
        name: 'parts.zip',
        downloadUrl: '/api/outputs/output/download',
      }],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'failed',
        jobId: 'failed',
        status: 'failed',
        sourceLabel: 'source.pdf',
      }),
      expect.objectContaining({
        id: 'output',
        jobId: 'done',
        outputFormat: 'zip',
        status: 'completed',
      }),
    ]);
  });

  it('renders export history and a meaningful run action in the shared Workbench', () => {
    const mode = pdfHub.modes[2];
    const html = renderToStaticMarkup(
      <Workbench
        hub={pdfHub}
        mode={mode}
        onRun={() => {}}
        resultRows={[{
          id: 'out',
          jobId: 'job',
          name: 'document.pdf',
          status: 'completed',
          outputFormat: 'pdf',
        }]}
      />,
    );
    expect(html).toContain('Download all PDF outputs');
    expect(html).toContain('document.pdf');
    expect(html).not.toContain('This mode is not implemented yet.');
  });
});
