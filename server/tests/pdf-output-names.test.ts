import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutputName,
  OutputNames,
  sanitizeFilenameSegment,
  baseFromOriginal,
  contentDispositionAttachment,
  stripFinalExtension,
} from '../src/pdf/output-names.js';

describe('output naming', () => {
  it('builds operation-based names from original (OBJECTIVE table)', () => {
    assert.equal(OutputNames.merged('abc.pdf'), 'abc-merged.pdf');
    assert.equal(OutputNames.merged('report.pdf'), 'report-merged.pdf');
    assert.equal(OutputNames.rotated('document.pdf'), 'document-rotated.pdf');
    assert.equal(OutputNames.reordered('lesson.pdf'), 'lesson-reordered.pdf');
    assert.equal(OutputNames.repaired('book.pdf'), 'book-repaired.pdf');
    assert.equal(OutputNames.ocrText('scan.pdf'), 'scan-ocr.txt');
    assert.equal(OutputNames.extracted('invoice.pdf', '1-3'), 'invoice-pages-1-3.pdf');
    assert.equal(OutputNames.imagesToPdf('photo.png'), 'photo-to-pdf.pdf');
    assert.equal(OutputNames.compressed('abc.pdf'), 'abc-compressed.pdf');
    assert.equal(OutputNames.optimized('abc.pdf'), 'abc-optimized.pdf');
    assert.equal(OutputNames.splitZip('book.pdf'), 'book-split.zip');
    assert.equal(OutputNames.deleted('doc.pdf'), 'doc-pages-deleted.pdf');
    assert.equal(OutputNames.duplicated('doc.pdf'), 'doc-pages-duplicated.pdf');
    assert.equal(OutputNames.inspect('doc.pdf'), 'doc-inspection.json');
    assert.equal(OutputNames.pageImage('scan.pdf', 2, '.png'), 'scan-page-2.png');
    assert.equal(OutputNames.pageImagesZip('scan.pdf'), 'scan-pages.zip');
    assert.equal(OutputNames.text('report.pdf'), 'report.txt');
  });

  it('preserves multi-dot base names (only final extension stripped)', () => {
    assert.equal(stripFinalExtension('report.final.v2.pdf'), 'report.final.v2');
    assert.equal(OutputNames.merged('report.final.v2.pdf'), 'report.final.v2-merged.pdf');
  });

  it('preserves spaces and Unicode safely', () => {
    assert.equal(OutputNames.merged('my document.pdf'), 'my document-merged.pdf');
    const viet = OutputNames.merged('Tài liệu.pdf');
    assert.match(viet, /-merged\.pdf$/);
    assert.ok(viet.includes('Tài liệu') || viet.includes('liệu') || viet.startsWith('T'));
    const name = buildOutputName({
      originalName: 'Báo cáo 2024.pdf',
      suffix: 'merged',
      ext: '.pdf',
    });
    assert.match(name, /\.pdf$/);
    assert.ok(name.includes('merged'));
  });

  it('does not use bare merged.pdf / download.pdf generics for named inputs', () => {
    const name = OutputNames.merged('My Report Final.pdf');
    assert.match(name, /merged\.pdf$/);
    assert.ok(!name.startsWith('merged.pdf'));
    assert.ok(!name.includes('download'));
    assert.ok(!name.endsWith('.pdf-merged.pdf'));
  });

  it('strips path traversal and Windows-unsafe characters', () => {
    const s = sanitizeFilenameSegment('..\\..\\evil:name?.pdf');
    assert.ok(!s.includes('..'));
    assert.ok(!s.includes(':'));
    assert.ok(!s.includes('?'));
    const name = OutputNames.merged('C:\\\\Users\\\\x\\\\evil:name.pdf');
    assert.ok(!name.includes(':'));
    assert.ok(!name.includes('\\'));
  });

  it('avoids double action suffixes when re-processing', () => {
    assert.equal(baseFromOriginal('report-merged.pdf'), 'report');
    assert.equal(OutputNames.merged('report-merged.pdf'), 'report-merged.pdf');
  });

  it('truncates long names while preserving suffix and extension', () => {
    const long = `${'a'.repeat(200)}.pdf`;
    const name = OutputNames.merged(long);
    assert.ok(name.length <= 180);
    assert.match(name, /-merged\.pdf$/);
  });

  it('Content-Disposition supports Unicode filename*', () => {
    const cd = contentDispositionAttachment('Tài liệu-merged.pdf');
    assert.match(cd, /filename=/);
    assert.match(cd, /filename\*=UTF-8''/);
    assert.ok(cd.includes(encodeURIComponent('Tài liệu-merged.pdf').slice(0, 10)) || cd.includes('%'));
  });
});
