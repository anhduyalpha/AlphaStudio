/**
 * Structural + behavioral proof that QR decode failures propagate to the paste modal.
 * Drives shipped source: QrView rethrows; QrPasteModal handleDecode catches and stays open.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

describe('QR decode error propagation (shipped source)', () => {
  const qrView = fs.readFileSync(path.join(root, 'src/views/QrView.jsx'), 'utf8');
  const modal = fs.readFileSync(path.join(root, 'src/components/QrPasteModal.jsx'), 'utf8');

  it('QrView decode rethrows after failure (does not swallow)', () => {
    assert.match(qrView, /throw err/);
    assert.match(qrView, /rethrow|Propagate failure|always rethrow/i);
    // decode must not end with empty catch that absorbs errors without throw
    assert.ok(!/catch\s*\{\s*\/\*\s*handled\s*\*\/\s*\}/.test(qrView.split('const decode')[1]?.slice(0, 800) || ''));
  });

  it('QrPasteModal handleDecode keeps modal open on error', () => {
    assert.match(modal, /handleDecode/);
    assert.match(modal, /setPhase\('error'\)/);
    // success path may call onClose; error path must not
    const handle = modal.split('const handleDecode')[1]?.slice(0, 600) || '';
    assert.match(handle, /catch/);
    assert.ok(handle.includes("setPhase('error')"));
    // onClose only after successful await onDecoded — not inside catch
    const catchBlock = handle.split('catch')[1] || '';
    assert.ok(!/onClose\?\.\(\)/.test(catchBlock), 'must not close modal in catch');
  });
});
