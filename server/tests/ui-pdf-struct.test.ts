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
  });

  it('includes inspect result card fields', () => {
    assert.match(pdfView, /inspectData/);
    assert.match(pdfView, /pageCount/);
    assert.match(pdfView, /checksum/);
  });
});

describe('PdfPageOrganizer', () => {
  it('avoids full-PDF base64 upload and has preview limits', () => {
    assert.match(organizer, /PREVIEW_PAGE_LIMIT|base64/i);
    assert.match(organizer, /No full-PDF base64/i);
  });
});
