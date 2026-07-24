import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function readSrc(...parts: string[]) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

describe('Converter Pro + QR paste structural', () => {
  const converter = readSrc('src/views/ConverterView.jsx');
  const qrModal = readSrc('src/components/QrPasteModal.jsx');
  const qrView = readSrc('src/views/QrView.jsx');
  const clipboard = readSrc('src/lib/clipboardImage.js');
  const styles = readSrc('src/styles.css');
  const qrCombined = `${qrView}\n${qrModal}`;

  describe('ConverterView.jsx', () => {
    it('shows Converted files results section', () => {
      assert.ok(
        /Converted files|Converted Files/.test(converter),
        'expected "Converted files" or "Converted Files" label',
      );
    });

    it('offers Download all for zip export', () => {
      assert.ok(
        /Download all|Download All/.test(converter),
        'expected "Download all" or "Download All" control',
      );
    });

    it('has Apply settings to compatible action', () => {
      assert.match(converter, /Apply settings to compatible/);
    });

    it('supports Batch convert or buildConversionGroups', () => {
      assert.ok(
        /Batch convert|buildConversionGroups|Convert all|Convert group/.test(converter),
        'expected Batch convert label, Convert all/group, or buildConversionGroups import/use',
      );
    });

    it('wires Convert selected, Convert group, and Convert all to real job helpers', () => {
      assert.match(converter, /Convert selected/);
      assert.match(converter, /Convert group/);
      assert.match(converter, /Convert all/);
      assert.match(converter, /startSelectedConvert|buildConvertSelectionPlan/);
      assert.match(converter, /startConvertAll|buildConvertAllPlans/);
      assert.match(converter, /queueConvertJob|createJob/);
      assert.match(converter, /aggregateJobProgress|runProgress/);
    });

    it('persists groupSettings via toolSettings.converter', () => {
      assert.match(converter, /groupSettings/);
      assert.match(converter, /toolSettings\.converter|toolSettings:\s*\{\s*converter/);
      // Debounced autosave nests groupSettings under toolSettings.converter
      assert.match(
        converter,
        /toolSettings:\s*\{[\s\S]*?converter:\s*\{[\s\S]*?groupSettings/,
      );
      // Immediate save path (upload / clear) also writes groupSettings
      assert.match(converter, /saveNow\s*\(/);
      assert.match(converter, /toolSettings:\s*\{\s*converter:\s*\{\s*groupSettings/);
    });

    it('hydrates groupSettings from toolSettings.converter into state', () => {
      // Restore path: read conv.groupSettings from hydrated.toolSettings.converter
      assert.match(converter, /hydrated\.toolSettings\s*\?\.\s*converter/);
      assert.match(converter, /conv\.groupSettings/);
      assert.match(converter, /setGroupSettings\s*\(\s*perGroup\s*\)/);
      // useWorkspace save + saveNow are the persistence hooks
      assert.match(converter, /useWorkspace/);
      assert.match(converter, /\bsave\b/);
      assert.match(converter, /\bsaveNow\b/);
    });

    it('downloads outputs via downloadOutputsZip', () => {
      assert.match(converter, /downloadOutputsZip/);
    });

    it('has no fake setTimeout success mock for conversion', () => {
      // No delayed fake success path in the converter view itself
      assert.ok(
        !/setTimeout\s*\(/.test(converter),
        'ConverterView must not use setTimeout (fake success mock)',
      );
      assert.ok(
        !/fake success|mock delay|simulated conversion|demo mode|frontend demo/i.test(converter),
        'ConverterView must not fake conversion success',
      );
      // Real conversion path: createJob with type converter (or legacy run)
      assert.ok(
        /createJob|run\(['"]converter['"]/.test(converter),
        'expected real createJob/run conversion path',
      );
      assert.match(converter, /type:\s*['"]converter['"]|run\(['"]converter['"]/);
    });
  });

  describe('QrPasteModal.jsx + QrView.jsx', () => {
    it('modal is a dialog with aria-modal', () => {
      assert.match(qrModal, /role="dialog"/);
      assert.match(qrModal, /aria-modal/);
    });

    it('revokes object URLs for previews', () => {
      assert.match(qrCombined, /revokeObjectURL/);
    });

    it('handles Escape to close', () => {
      assert.match(qrModal, /Escape/);
    });

    it('exposes Paste image entry', () => {
      assert.match(qrCombined, /Paste image/);
    });
  });

  describe('clipboardImage.js', () => {
    it('exports MAX_CLIPBOARD_IMAGE_BYTES', () => {
      assert.match(clipboard, /MAX_CLIPBOARD_IMAGE_BYTES/);
    });

    it('exports safeClipboardFilename', () => {
      assert.match(clipboard, /safeClipboardFilename/);
    });
  });

  describe('styles.css', () => {
    it('includes converter-pro, converted-list, or qr-paste-modal styles', () => {
      assert.ok(
        /converter-pro|converted-list|qr-paste-modal/.test(styles),
        'expected converter-pro, converted-list, or qr-paste-modal CSS',
      );
    });
  });
});
