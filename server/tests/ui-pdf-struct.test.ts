/**
 * Structural checks for PDF Tools UI (Organize/Convert/Optimize/Analyze).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pdfView = fs.readFileSync(path.join(root, 'src/views/PdfView.jsx'), 'utf8');
const organizer = fs.readFileSync(path.join(root, 'src/components/pdf/PdfPageOrganizer.jsx'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'src/lib/pdfPreview.js'), 'utf8');
const jobCard = fs.readFileSync(path.join(root, 'src/components/JobOutputCard.jsx'), 'utf8');
const filePicker = fs.readFileSync(path.join(root, 'src/components/FilePicker.jsx'), 'utf8');

describe('PdfView structure', () => {
  it('groups Organize / Convert / Optimize / Analyze', () => {
    assert.match(pdfView, /Organize/);
    assert.match(pdfView, /Convert/);
    assert.match(pdfView, /Optimize/);
    assert.match(pdfView, /Analyze/);
  });

  it('exposes text, OCR, inspect, delete, duplicate, compress modes', () => {
    assert.match(pdfView, /to-text/);
    assert.match(pdfView, /ocr/);
    assert.match(pdfView, /inspect/);
    assert.match(pdfView, /delete-pages/);
    assert.match(pdfView, /duplicate-pages/);
    assert.match(pdfView, /compress-structural/);
    assert.match(pdfView, /compress-advanced/);
    assert.match(pdfView, /repair/);
  });

  it('does not hardcode sole engine pdf-lib for every op', () => {
    // Should show dynamic engineLabel, not only a static pdf-lib string for all ops
    assert.match(pdfView, /engineLabel/);
    assert.ok(!/Engine<\/span><strong>pdf-lib<\/strong>/.test(pdfView.replace(/\s+/g, '')));
  });

  it('capability-gates optional operations', () => {
    assert.match(pdfView, /isAvailable/);
    assert.match(pdfView, /pdf\.compress\.advanced|compress-advanced/);
    assert.match(pdfView, /pdf\.ocr/);
    assert.match(pdfView, /GATED_OP_IDS|unavailable/);
  });

  it('includes inspect result card fields', () => {
    assert.match(pdfView, /inspectData/);
    assert.match(pdfView, /pageCount/);
    assert.match(pdfView, /checksum/);
  });

  it('clears stale lastOutput when starting a new job', () => {
    assert.match(pdfView, /setLastOutput\(null\)/);
    assert.match(pdfView, /busy \? job : job \|\| lastOutput|busy \? job/);
  });

  it('handles job completion once per job id (no re-wipe on operation change)', () => {
    assert.match(pdfView, /handledCompleteIdRef/);
    assert.match(pdfView, /handledCompleteIdRef\.current === job\.id/);
    // Must not list bare `operation` as a completion-effect dependency that re-clears files
    const completionBlock = pdfView.match(
      /handledCompleteIdRef[\s\S]{0,800}?}, \[([^\]]+)\]/,
    );
    assert.ok(completionBlock, 'completion effect dependency array');
    assert.ok(
      !/\boperation\b/.test(completionBlock[1]),
      `completion deps must not include operation: ${completionBlock[1]}`,
    );
  });

  it('resets form options when operation changes (defaultFormStateForOperation)', () => {
    assert.match(pdfView, /defaultFormStateForOperation/);
    assert.match(pdfView, /setEditPlan\(null\)/);
    assert.match(pdfView, /\}, \[operation\]/);
  });

  it('does not expose password controls for operations that do not consume passwords', () => {
    assert.doesNotMatch(pdfView, /type="password"|type=\{?['"]password['"]\}?/);
    assert.doesNotMatch(pdfView, /PASSWORD_CAPABLE_OPS/);
  });

  it('labels structural optimization honestly (not strong image compression)', () => {
    assert.match(pdfView, /not strong image re-compression|Structural optimization rewrites/i);
  });

  it('uses shared pdfJobOptions builder for requests and validation', () => {
    assert.match(pdfView, /buildPdfJobOptions/);
    assert.match(pdfView, /validatePdfClient|validatePdfClient/);
    assert.match(pdfView, /pdfJobOptions/);
  });

  it('sends orientation and dpi options when relevant', () => {
    assert.match(pdfView, /orientation/);
    assert.match(pdfView, /needsDpi|dpi/);
    assert.match(pdfView, /pageSize/);
  });

  it('validates merge needs two files and delete-all / split ranges', () => {
    // Validation lives in shipped pdfJobOptions used by PdfView
    const opts = fs.readFileSync(path.join(root, 'src/lib/pdfJobOptions.js'), 'utf8');
    assert.match(opts, /Merge requires at least two/);
    assert.match(opts, /Cannot delete all pages/);
    assert.match(opts, /splitMode === 'ranges'/);
  });

  it('does not expose decrypt as a runnable UI operation', () => {
    assert.ok(!/\bid:\s*['"]decrypt['"]/.test(pdfView));
  });

  it('builds options from capability-aligned operation ids', () => {
    for (const id of [
      'merge',
      'split',
      'rotate',
      'reorder',
      'extract',
      'delete-pages',
      'duplicate-pages',
      'from-images',
      'to-images',
      'to-text',
      'ocr',
      'compress-structural',
      'compress-advanced',
      'inspect',
      'repair',
    ]) {
      assert.match(pdfView, new RegExp(`id:\\s*'${id}'`));
    }
  });

  it('consumes authoritative backend PDF operation descriptors', () => {
    assert.match(pdfView, /caps\?\.pdf\?\.operations/);
    assert.match(pdfView, /contract\.capability/);
    assert.match(pdfView, /contract\.cardinality/);
    assert.match(pdfView, /contract\.outputKinds/);
    assert.match(pdfView, /contract\.enginePolicy/);
    assert.match(pdfView, /new Set\(contract\.options/);
  });
});

describe('JobOutputCard meta', () => {
  it('surfaces engine and page metadata via describeJobMeta', () => {
    assert.match(jobCard, /describeJobMeta/);
    assert.match(jobCard, /outputMime|kindHint/);
    assert.match(jobCard, /Download/);
  });
});

describe('FilePicker reorder', () => {
  it('supports reorderable multi-file queue for merge order', () => {
    assert.match(filePicker, /reorderable/);
    assert.match(filePicker, /Move .* up|move\(/);
  });
});

describe('PdfPageOrganizer', () => {
  it('avoids full-PDF base64 upload and enforces configurable byte/page limits', () => {
    assert.match(organizer, /PDF_PREVIEW_BYTE_LIMIT/);
    assert.match(organizer, /PDF_PREVIEW_PAGE_LIMIT/);
    assert.match(organizer, /No full-PDF base64/i);
    assert.match(preview, /VITE_PDF_PREVIEW_MAX_BYTES/);
    assert.match(preview, /VITE_PDF_PREVIEW_MAX_PAGES/);
    assert.ok(
      organizer.indexOf('file.size > PDF_PREVIEW_BYTE_LIMIT') < organizer.indexOf('file.arrayBuffer()'),
      'byte-limit check must happen before reading the browser File',
    );
  });

  it('publishes pageCount in edit plan for validation', () => {
    assert.match(organizer, /pageCount/);
  });

  it('uses one bundled same-origin PDF.js worker initializer', () => {
    assert.match(preview, /pdf\.worker\.min\.mjs\?url/);
    assert.match(preview, /worker\.origin !== window\.location\.origin/);
    assert.match(preview, /GlobalWorkerOptions\.workerSrc/);
    assert.match(organizer, /getPdfJs/);
  });

  it('invalidates loading and render tasks on file, operation, and unmount cleanup', () => {
    assert.match(organizer, /loadGenerationRef|generation/i);
    assert.match(organizer, /destroy/);
    assert.match(organizer, /renderTasksRef/);
    assert.match(organizer, /task\?\.cancel|cancelTask/);
    assert.match(organizer, /fileIdentity|lastModified/);
    assert.match(organizer, /file, identity, onPlanChange, operation/);
  });

  it('does not trust PDF token scanning as a page-count fallback', () => {
    assert.doesNotMatch(organizer, /\/Type\s*\\s\*\/Page|TextDecoder\(['"]latin1/);
  });

  it('bounds rendering, concurrency, and DOM with paginated page windows', () => {
    assert.match(organizer, /PDF_PREVIEW_WINDOW_SIZE/);
    assert.match(organizer, /PDF_PREVIEW_RENDER_CONCURRENCY/);
    assert.match(organizer, /Previous pages/);
    assert.match(organizer, /Next pages/);
    assert.match(organizer, /\.slice\(windowStart, windowStart \+ PDF_PREVIEW_WINDOW_SIZE\)/);
  });

  it('keeps manual page text authoritative and exposes keyboard reorder controls', () => {
    assert.match(organizer, /The text field is authoritative/);
    assert.match(organizer, /String\(pages \|\| ''\)\.trim/);
    assert.match(organizer, /aria-pressed/);
    assert.match(organizer, /Move page .* earlier/);
    assert.match(organizer, /Move page .* later/);
    assert.doesNotMatch(organizer, /setRotations|rotations\[/);
  });
});

describe('Activity history delete UI', () => {
  it('exposes per-entry delete wired to api.deleteActivity', () => {
    const activity = fs.readFileSync(path.join(root, 'src/views/ActivityView.jsx'), 'utf8');
    assert.match(activity, /deleteActivity/);
    assert.match(activity, /Delete/);
    assert.match(activity, /confirm/i);
    const client = fs.readFileSync(path.join(root, 'src/api/client.js'), 'utf8');
    assert.match(client, /deleteJob/);
    assert.match(client, /deleteActivity/);
  });
});
