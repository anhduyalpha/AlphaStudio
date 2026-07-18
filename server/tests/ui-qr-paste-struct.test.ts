import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

describe('QR paste modal structural', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/QrView.jsx'), 'utf8');
  const modal = fs.readFileSync(path.join(root, 'src/components/QrPasteModal.jsx'), 'utf8');
  const combined = `${view}\n${modal}`;

  it('exposes Paste image entry in QrView decode mode', () => {
    assert.match(view, /Paste image/);
    assert.match(view, /QrPasteModal/);
    assert.match(view, /setPasteOpen/);
  });

  it('wires real decode job for pasted file', () => {
    assert.match(view, /run\('qr'/);
    assert.match(view, /operation:\s*['"]decode['"]/);
    assert.match(view, /autoDownload:\s*false/);
    assert.ok(!/setTimeout|mock delay|fake decode|simulated/i.test(view));
  });

  it('modal has Escape/close handlers and dialog a11y', () => {
    assert.match(modal, /Escape/);
    assert.match(modal, /onClose/);
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-modal/);
    assert.match(modal, /aria-labelledby/);
  });

  it('revokes object URLs for previews', () => {
    assert.match(modal, /revokeObjectURL/);
  });

  it('uses clipboardImage helpers', () => {
    assert.ok(
      /prepareClipboardImage|clipboardImage/.test(combined),
      'expected prepareClipboardImage or clipboardImage import',
    );
    assert.match(modal, /prepareClipboardImage|from ['"].*clipboardImage/);
  });

  it('supports paste, drop, and file fallback', () => {
    assert.match(modal, /addEventListener\(['"]paste['"]/);
    assert.match(modal, /onDrop|dataTransfer/);
    assert.match(modal, /type="file"/);
    assert.match(modal, /accept="image\/\*"/);
  });
});
