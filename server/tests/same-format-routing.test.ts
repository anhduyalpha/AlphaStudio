import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertPairAllowed, isSameFormat } from '../src/convert/matrix.js';
import { isSameFormatPair } from '../src/convert/office.js';

describe('same-format routing gates', () => {
  it('isSameFormat / isSameFormatPair treat pdf/pdf and jpg/jpeg as same', () => {
    assert.equal(isSameFormat('pdf', 'pdf'), true);
    assert.equal(isSameFormatPair('pdf', 'pdf'), true);
    assert.equal(isSameFormat('jpg', 'jpeg'), true);
    assert.equal(isSameFormatPair('docx', 'pdf'), false);
  });

  it('assertPairAllowed rejects PDF→PDF (never LibreOffice)', () => {
    assert.throws(
      () => assertPairAllowed({
        family: 'pdf',
        format: 'pdf',
        ext: '.pdf',
        mime: 'application/pdf',
      }, 'pdf'),
      /pdf.*pdf|not supported/i,
    );
  });

  it('assertPairAllowed rejects docx→docx as no-op', () => {
    assert.throws(
      () => assertPairAllowed({
        family: 'document',
        format: 'docx',
        ext: '.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }, 'docx'),
      /same-format|no-op|not supported/i,
    );
  });
});
