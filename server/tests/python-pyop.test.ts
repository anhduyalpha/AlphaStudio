import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PYTHON_OPERATIONS,
  pythonOperationStatus,
  listPythonSpecializedCapabilities,
} from '../src/convert/engines/index.js';
import type { ProbeRunner } from '../src/convert/engines/probe.js';

// Reports a valid interpreter for --version and a JSON module map for --selfcheck.
const selfcheckRunner =
  (modules: Record<string, boolean>): ProbeRunner =>
  (_exe, args) =>
    args.includes('--selfcheck')
      ? {
          ok: true,
          stdout: JSON.stringify({ protocol: 1, python: '3.12.4', modules, operations: [] }),
          stderr: '',
          timedOut: false,
        }
      : { ok: true, stdout: 'Python 3.12.4\n', stderr: '', timedOut: false };

const allModules = selfcheckRunner({ ocrmypdf: true, cv2: true, camelot: true });
const noModules = selfcheckRunner({});

describe('python specialized operations (pyop)', () => {
  it('registers the Phase 3 specialized operations', () => {
    const ops = PYTHON_OPERATIONS.map((spec) => spec.operation);
    for (const op of ['pdf.ocr-searchable', 'image.deskew', 'image.autocrop', 'pdf.extract-tables']) {
      assert.ok(ops.includes(op), op);
    }
  });

  it('reports available when the required modules are present', () => {
    assert.equal(pythonOperationStatus('pdf.ocr-searchable', allModules).available, true);
    assert.equal(pythonOperationStatus('image.deskew', allModules).available, true);
    assert.equal(pythonOperationStatus('image.autocrop', allModules).available, true);
    assert.equal(pythonOperationStatus('pdf.extract-tables', allModules).available, true);
  });

  it('reports unavailable with an install hint when modules are missing', () => {
    assert.match(String(pythonOperationStatus('pdf.ocr-searchable', noModules).reason), /ocr profile/);
    assert.match(String(pythonOperationStatus('image.deskew', noModules).reason), /vision profile/);
    assert.match(String(pythonOperationStatus('pdf.extract-tables', noModules).reason), /documents profile/);
  });

  it('rejects an unknown operation', () => {
    const status = pythonOperationStatus('does.not-exist', allModules);
    assert.equal(status.available, false);
    assert.match(String(status.reason), /Unknown Python operation/);
  });

  it('surfaces capability rows gated by module presence', () => {
    const present = listPythonSpecializedCapabilities(allModules);
    assert.equal(present.find((cap) => cap.operation === 'image.deskew')?.available, true);
    assert.equal(present.find((cap) => cap.operation === 'pdf.ocr-searchable')?.available, true);

    const absent = listPythonSpecializedCapabilities(noModules);
    assert.equal(absent.find((cap) => cap.operation === 'image.deskew')?.available, false);
    assert.match(String(absent.find((cap) => cap.operation === 'image.deskew')?.reason), /vision profile/);
  });

  it('assertJobCapable gates pyop by real module availability', async () => {
    const { assertJobCapable } = await import('../src/processors/index.js');
    // Heavy vision modules are not installed in the validation environment.
    assert.throws(
      () => assertJobCapable('pyop', { operation: 'image.deskew' }),
      /vision profile|not installed/,
    );
    assert.throws(
      () => assertJobCapable('pyop', { operation: 'totally.unknown' }),
      /Unknown Python operation/,
    );
  });

  it('registers the Phase 4 operations and gates them by ai/vision profile', () => {
    const ops = PYTHON_OPERATIONS.map((spec) => spec.operation);
    assert.ok(ops.includes('media.transcribe'));
    assert.ok(ops.includes('image.background-removal'));

    assert.equal(pythonOperationStatus('media.transcribe', selfcheckRunner({ faster_whisper: true })).available, true);
    assert.match(String(pythonOperationStatus('media.transcribe', noModules).reason), /ai profile/);

    assert.equal(pythonOperationStatus('image.background-removal', selfcheckRunner({ rembg: true })).available, true);
    assert.match(String(pythonOperationStatus('image.background-removal', noModules).reason), /vision profile/);
  });

  it('registers the Phase 5 summarizer and gates it by ai profile', () => {
    assert.ok(PYTHON_OPERATIONS.map((spec) => spec.operation).includes('doc.summarize'));
    assert.equal(pythonOperationStatus('doc.summarize', selfcheckRunner({ llama_cpp: true })).available, true);
    assert.match(String(pythonOperationStatus('doc.summarize', noModules).reason), /ai profile/);
  });
});
