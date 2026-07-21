import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOutputName, OutputNames, sanitizeFilenameSegment } from '../src/pdf/output-names.js';

describe('output naming', () => {
  it('builds operation-based names from original', () => {
    assert.equal(OutputNames.merged('report.pdf'), 'report-merged.pdf');
    assert.equal(OutputNames.rotated('report.pdf'), 'report-rotated.pdf');
    assert.equal(OutputNames.reordered('report.pdf'), 'report-reordered.pdf');
    assert.equal(OutputNames.extracted('report.pdf', '1-5'), 'report-pages-1-5.pdf');
    assert.equal(OutputNames.compressed('report.pdf'), 'report-compressed.pdf');
    assert.equal(OutputNames.repaired('report.pdf'), 'report-repaired.pdf');
    assert.equal(OutputNames.text('report.pdf'), 'report.txt');
    assert.equal(OutputNames.splitZip('report.pdf'), 'report-pages.zip');
    assert.equal(OutputNames.imagesToPdf(), 'images-to-pdf.pdf');
  });

  it('does not use bare merged.pdf / download.pdf generics for named inputs', () => {
    const name = OutputNames.merged('My Report Final.pdf');
    assert.match(name, /merged\.pdf$/);
    assert.ok(!name.startsWith('merged.pdf'));
    assert.ok(!name.includes('download'));
  });

  it('strips path traversal and Windows-unsafe characters', () => {
    const s = sanitizeFilenameSegment('..\\..\\evil:name?.pdf');
    assert.ok(!s.includes('..'));
    assert.ok(!s.includes(':'));
    assert.ok(!s.includes('?'));
  });

  it('handles unicode and spaces safely', () => {
    const name = buildOutputName({
      originalName: 'Báo cáo 2024.pdf',
      suffix: 'merged',
      ext: '.pdf',
    });
    assert.match(name, /\.pdf$/);
    assert.ok(name.includes('merged'));
  });
});
