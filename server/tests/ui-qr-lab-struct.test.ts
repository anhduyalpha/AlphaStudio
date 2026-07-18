/**
 * Structural tests for redesigned QR Lab (Generate / Decode).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const view = fs.readFileSync(path.join(root, 'src/views/QrView.jsx'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'src/components/QrPasteModal.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

describe('QR Lab Generate structure', () => {
  it('has Generate and Decode primary tabs', () => {
    assert.match(view, /role="tablist"/);
    assert.match(view, /Generate/);
    assert.match(view, /Decode/);
    assert.match(view, /qr-tab/);
  });

  it('uses three-part generate layout: Content, Appearance, Preview', () => {
    assert.match(view, /1 · Content|Content/);
    assert.match(view, /2 · Appearance|Appearance/);
    assert.match(view, /3 · Preview|Preview \/ export|preview-panel/);
    assert.match(view, /qr-generate-layout/);
  });

  it('collapsible advanced: Colors, Logo, Error correction, Margin/size, Output format', () => {
    assert.match(view, /Colors/);
    assert.match(view, /Logo/);
    assert.match(view, /Error correction/);
    assert.match(view, /Margin \/ size|Margin\/size/);
    assert.match(view, /Output format/);
    assert.match(view, /Collapsible|qr-collapse/);
  });

  it('exposes Reset, Copy, Download PNG, Download SVG wired to handlers', () => {
    assert.match(view, /Reset/);
    assert.match(view, /Download PNG/);
    assert.match(view, /Download SVG/);
    assert.match(view, /downloadBlob\(['"]png['"]\)|downloadBlob\('png'\)/);
    assert.match(view, /downloadBlob\(['"]svg['"]\)|downloadBlob\('svg'\)/);
    assert.match(view, /resetGenerate/);
    assert.match(view, /copyContent|clipboard\.writeText/);
    // real job runner, not fake
    assert.match(view, /run\(['"]qr['"]/);
    assert.ok(!/fake generate|mockGenerate|setTimeout\(\s*\(\)\s*=>\s*setPreview/i.test(view));
  });

  it('sticky preview desktop + mobile order styles', () => {
    assert.match(css, /qr-preview-panel/);
    assert.match(css, /position:\s*sticky/);
    assert.match(css, /@media \(max-width:\s*900px\)/);
    assert.match(css, /order:\s*3/);
  });
});

describe('QR Lab Decode structure', () => {
  it('single input card with paste / upload / drag-drop', () => {
    assert.match(view, /Paste image/);
    assert.match(view, /FilePicker/);
    assert.match(view, /Drop QR image|drag/i);
  });

  it('after input: Decode, Replace, Remove actions', () => {
    assert.match(view, /Decode<\/PrimaryButton>|>Decode</);
    assert.match(view, /Replace/);
    assert.match(view, /Remove/);
    assert.match(view, /removeDecodeImage|setFiles\(\[\]\)/);
    assert.match(view, /onClick=\{\(\) => decode\(\)\}/);
  });

  it('result card: content type, selectable text, Copy, Open link, Retry', () => {
    assert.match(view, /qr-result-card|Decoded content/);
    assert.match(view, /contentType|detectContentType|qr-type-badge/);
    assert.match(view, /qr-decode-text/);
    assert.match(view, /canOpenLink|isSafeHttpUrl|Open link/);
    assert.match(view, /retryDecode|Retry/);
    assert.match(view, /copyDecoded|Copy/);
  });

  it('Open link only after URL validation', () => {
    assert.match(view, /isSafeHttpUrl/);
    assert.match(view, /canOpenLink/);
    // must not always render open without guard
    assert.match(view, /canOpenLink\s*\?/);
  });
});

describe('QR paste modal behaviors', () => {
  it('Ctrl/Cmd+V paste, Escape, focus trap, object URL cleanup', () => {
    assert.match(modal, /addEventListener\(['"]paste['"]/);
    assert.match(modal, /Escape/);
    assert.match(modal, /Tab/);
    assert.match(modal, /revokeObjectURL/);
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-modal/);
  });

  it('permission error path and replace/decode', () => {
    assert.match(modal, /PERMISSION|NotAllowedError|Clipboard permission/);
    assert.match(modal, /Replace/);
    assert.match(modal, /Decode/);
    assert.match(modal, /onDecoded/);
  });
});
