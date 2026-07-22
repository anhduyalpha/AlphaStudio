/**
 * Integration: PDF processor ops + converter PDF path (no LibreOffice).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { processPdf } from '../src/processors/pdf.js';
import { processConverter } from '../src/processors/converter.js';
import { routeConversion } from '../src/convert/matrix.js';
import { textToPdf } from '../src/convert/textPdf.js';
import type { ProcessContext } from '../src/processors/types.js';

const root = path.join(os.tmpdir(), `pdf-pipe-${process.pid}`);

function ctx(
  partial: Partial<ProcessContext> & {
    inputPaths: string[];
    options: Record<string, unknown>;
  },
): ProcessContext {
  const workDir = path.join(root, 'work', String(Math.random()).slice(2));
  const outputDir = path.join(root, 'out', String(Math.random()).slice(2));
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const stages: string[] = [];
  return {
    jobId: 'test-job',
    inputPaths: partial.inputPaths,
    inputNames: partial.inputNames || partial.inputPaths.map((p) => path.basename(p)),
    options: partial.options,
    workDir,
    outputDir,
    onProgress: (_p, msg) => {
      if (msg) stages.push(msg);
    },
    isCancelled: () => false,
    ...partial,
    // re-apply so stages capture works
    onProgress: (p, msg) => {
      if (msg) stages.push(String(msg));
      partial.onProgress?.(p, msg);
    },
  } as ProcessContext & { _stages?: string[] };
}

async function textPdf(label: string): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(label, { x: 30, y: 100, size: 16, font });
  const p = path.join(root, `${label.replace(/\W+/g, '_')}.pdf`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(p, await doc.save());
  return p;
}

before(() => {
  fs.mkdirSync(root, { recursive: true });
});

after(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('Unicode text PDF', () => {
  it('renders Vietnamese text without WinAnsi failures', async () => {
    const outputDir = path.join(root, 'unicode-output');
    fs.mkdirSync(outputDir, { recursive: true });
    const result = await textToPdf({
      text: 'Hướng dẫn build và chạy AlphaStudio trên Windows và Linux.',
      outputDir,
      title: 'huong-dan',
    });
    const bytes = fs.readFileSync(result.outputPath);
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
    const parsed = await PDFDocument.load(bytes);
    assert.equal(parsed.getPageCount(), 1);
  });
});

describe('PDF processor operations', () => {
  it('merge two PDFs', async () => {
    const a = await textPdf('PageA');
    const b = await textPdf('PageB');
    const c = ctx({
      inputPaths: [a, b],
      options: { operation: 'merge' },
    });
    const result = await processPdf(c);
    assert.ok(fs.existsSync(result.outputPath));
    assert.ok(fs.statSync(result.outputPath).size > 0);
    const doc = await PDFDocument.load(fs.readFileSync(result.outputPath));
    assert.equal(doc.getPageCount(), 2);
  });

  it('rejects merge with fewer than two PDFs', async () => {
    const only = await textPdf('OnlyOne');
    await assert.rejects(
      () => processPdf(ctx({ inputPaths: [only], options: { operation: 'merge' } })),
      /at least 2 file/i,
    );
  });

  it('rotate PDF', async () => {
    const a = await textPdf('RotateMe');
    const c = ctx({
      inputPaths: [a],
      options: { operation: 'rotate', angle: 90 },
    });
    const result = await processPdf(c);
    assert.ok(fs.existsSync(result.outputPath));
    assert.match(result.outputName, /rotated/i);
  });

  it('enforces one-file cardinality and rejects undocumented aliases', async () => {
    const a = await textPdf('CardinalityA');
    const b = await textPdf('CardinalityB');
    await assert.rejects(
      () => processPdf(ctx({ inputPaths: [a, b], options: { operation: 'rotate' } })),
      /at most 1 file/i,
    );
    await assert.rejects(
      () => processPdf(ctx({ inputPaths: [a], options: { operation: 'compress' } })),
      /Unknown PDF operation: compress/i,
    );
    await assert.rejects(
      () => processPdf(ctx({ inputPaths: [a], options: { operation: 'extract-text' } })),
      /Unknown PDF operation: extract-text/i,
    );
  });

  it('split PDF produces zip', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const p = path.join(root, 'two-page.pdf');
    fs.writeFileSync(p, await doc.save());
    const c = ctx({
      inputPaths: [p],
      options: { operation: 'split' },
    });
    const result = await processPdf(c);
    assert.equal(result.outputMime, 'application/zip');
    assert.ok(fs.statSync(result.outputPath).size > 20);
  });

  it('reorder PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    doc.addPage();
    const p = path.join(root, 'three.pdf');
    fs.writeFileSync(p, await doc.save());
    const c = ctx({
      inputPaths: [p],
      options: { operation: 'reorder', order: '3,1,2' },
    });
    const result = await processPdf(c);
    const out = await PDFDocument.load(fs.readFileSync(result.outputPath));
    assert.equal(out.getPageCount(), 3);
  });

  it('extract pages', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    doc.addPage();
    const p = path.join(root, 'extract-src.pdf');
    fs.writeFileSync(p, await doc.save());
    const c = ctx({
      inputPaths: [p],
      options: { operation: 'extract', pages: '1-2' },
    });
    const result = await processPdf(c);
    const out = await PDFDocument.load(fs.readFileSync(result.outputPath));
    assert.equal(out.getPageCount(), 2);
  });

  it('compress structural', async () => {
    const a = await textPdf('CompressMe');
    const c = ctx({
      inputPaths: [a],
      options: { operation: 'compress-structural', quality: 'balanced' },
    });
    const result = await processPdf(c);
    assert.ok(result.meta?.structuralOnly);
    assert.ok(fs.statSync(result.outputPath).size > 0);
  });

  it('PDF text extraction uses the authoritative text name and metadata', async () => {
    const source = await textPdf('Named PDF text extraction');
    const result = await processPdf(
      ctx({
        inputPaths: [source],
        inputNames: ['report.final.pdf'],
        options: { operation: 'to-text' },
      }),
    );
    assert.equal(result.outputName, 'report.final-text.txt');
    assert.equal(result.meta?.outputKind, 'text');
    assert.equal(typeof result.meta?.pageCount, 'number');
    assert.equal(typeof result.meta?.characterCount, 'number');
  });

  it('images → PDF', async () => {
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 0, g: 100, b: 200 } },
    })
      .png()
      .toBuffer();
    const imgPath = path.join(root, 'img.png');
    fs.writeFileSync(imgPath, png);
    const c = ctx({
      inputPaths: [imgPath],
      inputNames: ['img.png'],
      options: { operation: 'from-images' },
    });
    const result = await processPdf(c);
    const head = Buffer.alloc(5);
    const fd = fs.openSync(result.outputPath, 'r');
    fs.readSync(fd, head, 0, 5, 0);
    fs.closeSync(fd);
    assert.equal(head.toString('ascii'), '%PDF-');
  });

  it('rejects corrupted PDF before merge', async () => {
    const bad = path.join(root, 'corrupt.pdf');
    fs.writeFileSync(bad, '%%%NOTPDF%%%');
    const c = ctx({
      inputPaths: [bad],
      options: { operation: 'rotate', angle: 90 },
    });
    await assert.rejects(() => processPdf(c), /Corrupted PDF|magic|Invalid/i);
  });

  it('passes a damaged PDF-signature file through to the repair engine', async () => {
    const damaged = path.join(root, 'damaged-repair.pdf');
    fs.writeFileSync(damaged, '%PDF-1.7\nthis is intentionally not parseable');
    await assert.rejects(
      () => processPdf(ctx({ inputPaths: [damaged], options: { operation: 'repair' } })),
      (error: unknown) => {
        const code = error && typeof error === 'object' ? (error as { code?: string }).code : '';
        return code === 'REPAIR_UNAVAILABLE' || code === 'CORRUPTED_PDF';
      },
    );
  });
});

describe('Converter PDF path', () => {
  it('PDF→TXT via processConverter never needs LO route', async () => {
    const a = await textPdf('Converter Text Path Content Marker');
    assert.equal(routeConversion({ family: 'pdf', format: 'pdf', ext: '.pdf', mime: 'application/pdf' }, 'txt').libreOfficeAllowed, false);
    const c = ctx({
      inputPaths: [a],
      inputNames: ['doc.pdf'],
      options: { format: 'txt', operation: 'convert' },
    });
    const result = await processConverter(c);
    assert.ok(result.outputPath.endsWith('.txt') || result.outputName.endsWith('.txt'));
    const text = fs.readFileSync(result.outputPath, 'utf8');
    assert.ok(text.replace(/\s+/g, '').length > 0);
    assert.notEqual(result.meta?.engine, 'libreoffice');
  });

  it('Unicode filename with spaces works for PDF→TXT', async () => {
    const src = await textPdf('Unicode Spaces Content Here');
    const weird = path.join(root, 'tài liệu test.pdf');
    fs.copyFileSync(src, weird);
    const c = ctx({
      inputPaths: [weird],
      inputNames: ['tài liệu test.pdf'],
      options: { format: 'txt' },
    });
    const result = await processConverter(c);
    assert.ok(fs.statSync(result.outputPath).size > 0);
  });
});
