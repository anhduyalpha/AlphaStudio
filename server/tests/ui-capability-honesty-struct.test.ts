/**
 * Structural honesty for Text OCR + Color Studio UI configs (shipped source).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const extra = fs.readFileSync(path.join(root, 'src/views/extraToolConfigs.js'), 'utf8');
const modular = fs.readFileSync(path.join(root, 'src/views/ModularWorkspaceView.jsx'), 'utf8');
const pdfView = fs.readFileSync(path.join(root, 'src/views/PdfView.jsx'), 'utf8');

describe('Text OCR UI honesty', () => {
  it('does not hard-block OCR with bundled-engine message', () => {
    assert.doesNotMatch(modular, /no OCR engine is bundled/);
  });

  it('text OCR features use text.ocr capability without clientOnly false success', () => {
    assert.match(extra, /capability:\s*['"]text\.ocr['"]/);
    // Not clientOnly for OCR entries — capability gate must apply
    const ocrBlock = extra.slice(extra.indexOf('Image OCR'), extra.indexOf('Text cleaner'));
    assert.doesNotMatch(ocrBlock, /clientOnly:\s*true/);
  });
});

describe('Color Studio UI honesty', () => {
  it('labels stubs explicitly and maps image job to optimize not fake palette', () => {
    assert.match(extra, /Color picker \(stub\)/);
    assert.match(extra, /Palette generator \(stub\)/);
    assert.match(extra, /Gradient builder \(stub\)/);
    assert.match(extra, /Contrast checker \(stub\)/);
    assert.match(extra, /Optimize image/);
    assert.match(extra, /UI stub/);
    assert.match(extra, /operation:\s*['"]optimize['"]/);
    assert.doesNotMatch(extra, /title:\s*['"]Image palette['"]/);
  });
});

describe('PdfView searchable OCR dual id', () => {
  it('checks both pdf.ocr.searchable and pdf.ocr-searchable', () => {
    assert.match(pdfView, /pdf\.ocr\.searchable/);
    assert.match(pdfView, /pdf\.ocr-searchable/);
  });
});
