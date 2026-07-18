/**
 * Strict PDF capability routing — PDF input never routes to LibreOffice.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeConversion,
  isLibreOfficeForbidden,
  listOutputsFor,
  assertPairAllowed,
  pdfEngineCapabilities,
  type DetectedKind,
} from '../src/convert/matrix.js';

const pdfKind: DetectedKind = {
  family: 'pdf',
  format: 'pdf',
  ext: '.pdf',
  mime: 'application/pdf',
};

const docxKind: DetectedKind = {
  family: 'document',
  format: 'docx',
  ext: '.docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const pngKind: DetectedKind = {
  family: 'image',
  format: 'png',
  ext: '.png',
  mime: 'image/png',
};

describe('PDF routing matrix', () => {
  it('PDF→TXT uses pdf-text engine, never LibreOffice', () => {
    const r = routeConversion(pdfKind, 'txt');
    assert.equal(r.engine, 'pdf-text');
    assert.equal(r.libreOfficeAllowed, false);
    assert.ok(isLibreOfficeForbidden(pdfKind, 'txt'));
  });

  it('PDF→PNG/JPEG uses rasterizer path, never LibreOffice', () => {
    for (const fmt of ['png', 'jpeg', 'jpg']) {
      const r = routeConversion(pdfKind, fmt);
      assert.notEqual(r.engine, 'libreoffice', fmt);
      assert.equal(r.libreOfficeAllowed, false, fmt);
      assert.ok(['pdf-rasterizer', 'unsupported'].includes(r.engine), fmt);
    }
  });

  it('PDF edit ops use pdf-lib', () => {
    for (const op of ['merge', 'split', 'rotate', 'reorder', 'extract', 'compress']) {
      const r = routeConversion(pdfKind, 'pdf', op);
      assert.equal(r.engine, 'pdf-lib', op);
      assert.equal(r.libreOfficeAllowed, false, op);
    }
  });

  it('Images→PDF uses sharp+pdf-lib, not LibreOffice', () => {
    const r = routeConversion(pngKind, 'pdf');
    assert.equal(r.engine, 'sharp+pdf-lib');
    assert.equal(r.libreOfficeAllowed, false);
  });

  it('DOCX→PDF may use LibreOffice', () => {
    const r = routeConversion(docxKind, 'pdf');
    assert.equal(r.engine, 'libreoffice');
    assert.equal(r.libreOfficeAllowed, true);
  });

  it('PDF→DOCX is unsupported (not LO)', () => {
    const r = routeConversion(pdfKind, 'docx');
    assert.equal(r.engine, 'unsupported');
    assert.equal(r.libreOfficeAllowed, false);
  });

  it('listOutputsFor never requires libreoffice for PDF', () => {
    const opts = listOutputsFor(pdfKind);
    for (const o of opts) {
      const req = o.requires || [];
      assert.ok(!req.includes('libreoffice'), `${o.format} must not require libreoffice`);
    }
    const txt = opts.find((o) => o.format === 'txt');
    assert.ok(txt, 'txt output listed');
    assert.equal(txt!.available, true);
  });

  it('assertPairAllowed accepts PDF→TXT', () => {
    assert.doesNotThrow(() => assertPairAllowed(pdfKind, 'txt'));
  });

  it('assertPairAllowed rejects PDF→PDF', () => {
    assert.throws(() => assertPairAllowed(pdfKind, 'pdf'), /Unsupported conversion|not supported/i);
  });

  it('pdfEngineCapabilities reports engines', () => {
    const caps = pdfEngineCapabilities();
    assert.ok(['pdftotext', 'mutool', 'native'].includes(caps.text));
    assert.equal(typeof caps.rasterizer, 'boolean');
    assert.equal(typeof caps.ocr, 'boolean');
  });
});
