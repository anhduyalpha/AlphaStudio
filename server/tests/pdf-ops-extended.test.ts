/**
 * Extended PDF ops: delete, duplicate, inspect, naming, compress structural meta.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { processPdf } from '../src/processors/pdf.js';
import type { ProcessContext } from '../src/processors/types.js';
import { resolveOptionalBinary } from '../src/tools/optional-binaries.js';

const root = path.join(os.tmpdir(), `pdf-ops-ext-${process.pid}`);

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
  return {
    jobId: 'test-job',
    inputPaths: partial.inputPaths,
    inputNames: partial.inputNames || partial.inputPaths.map((p) => path.basename(p)),
    options: partial.options,
    workDir,
    outputDir,
    onProgress: () => {},
    isCancelled: () => false,
    ...partial,
  };
}

async function multiPagePdf(pages: number, label = 'Doc'): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 200]);
    page.drawText(`${label} p${i + 1}`, { x: 20, y: 100, size: 14, font });
  }
  const p = path.join(root, `${label}-${pages}.pdf`);
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

describe('delete-pages', () => {
  it('removes selected pages and keeps remaining', async () => {
    const p = await multiPagePdf(4, 'Del');
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['report.pdf'],
        options: { operation: 'delete-pages', pages: '2,4' },
      }),
    );
    assert.ok(fs.existsSync(result.outputPath));
    const out = await PDFDocument.load(fs.readFileSync(result.outputPath));
    assert.equal(out.getPageCount(), 2);
    assert.equal(result.meta?.remainingPages, 2);
    assert.match(result.outputName, /deleted/i);
  });

  it('rejects deleting all pages', async () => {
    const p = await multiPagePdf(2, 'AllDel');
    await assert.rejects(
      () =>
        processPdf(
          ctx({
            inputPaths: [p],
            options: { operation: 'delete-pages', pages: '1-2' },
          }),
        ),
      /empty PDF|delete all/i,
    );
  });
});

describe('duplicate-pages', () => {
  it('duplicates selected pages after originals', async () => {
    const p = await multiPagePdf(3, 'Dup');
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['report.pdf'],
        options: { operation: 'duplicate-pages', pages: '1,3' },
      }),
    );
    const out = await PDFDocument.load(fs.readFileSync(result.outputPath));
    // 3 original + 2 dups = 5
    assert.equal(out.getPageCount(), 5);
    assert.match(result.outputName, /duplicated/i);
  });

  it('inserts duplicates at non-default insertAt position', async () => {
    const p = await multiPagePdf(3, 'DupIns');
    // Duplicate page 2 (index 1), insert both copies at position 0 (start)
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['report.pdf'],
        options: { operation: 'duplicate-pages', pages: '2', insertAt: 0 },
      }),
    );
    const out = await PDFDocument.load(fs.readFileSync(result.outputPath));
    // original 3 + 1 copy = 4; copy of page 2 placed at start
    assert.equal(out.getPageCount(), 4);
    assert.equal(result.meta?.duplicated, 1);
  });
});

describe('split groups mode', () => {
  it('splits into user-defined groups via semicolon specs', async () => {
    const p = await multiPagePdf(4, 'Groups');
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['report.pdf'],
        options: { operation: 'split', splitMode: 'groups', groups: '1-2;3-4' },
      }),
    );
    assert.equal(result.outputMime, 'application/zip');
    assert.equal(result.meta?.parts, 2);
  });
});

describe('inspect', () => {
  it('writes JSON inspection report', async () => {
    const p = await multiPagePdf(2, 'Inspect');
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['report.pdf'],
        options: { operation: 'inspect' },
      }),
    );
    assert.equal(result.outputMime, 'application/json');
    const json = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));
    assert.equal(json.pageCount, 2);
    assert.ok(json.checksum);
    assert.equal(json.engine, 'pdf-lib');
    assert.match(result.outputName, /inspection\.json$/);
  });
});

describe('merge naming', () => {
  it('names output from first document', async () => {
    const a = await multiPagePdf(1, 'FirstDoc');
    const b = await multiPagePdf(1, 'SecondDoc');
    const result = await processPdf(
      ctx({
        inputPaths: [a, b],
        inputNames: ['quarterly-report.pdf', 'appendix.pdf'],
        options: { operation: 'merge' },
      }),
    );
    assert.equal(result.outputName, 'quarterly-report-merged.pdf');
    assert.ok(fs.readFileSync(result.outputPath).subarray(0, 5).equals(Buffer.from('%PDF-')));
  });
});

describe('extract naming', () => {
  it('includes page range in output name', async () => {
    const p = await multiPagePdf(5, 'Extract');
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['report.pdf'],
        options: { operation: 'extract', pages: '1-3' },
      }),
    );
    assert.match(result.outputName, /report-pages-1-3\.pdf/);
  });
});

describe('split modes', () => {
  it('every-n produces multi-part zip', async () => {
    const p = await multiPagePdf(4, 'SplitN');
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['report.pdf'],
        options: { operation: 'split', splitMode: 'every-n', everyN: 2 },
      }),
    );
    assert.equal(result.outputMime, 'application/zip');
    assert.match(result.outputName, /split\.zip$/);
    assert.equal(result.meta?.parts, 2);
  });
});

describe('structural compress meta', () => {
  it('reports structuralOnly and size fields', async () => {
    const p = await multiPagePdf(2, 'Comp');
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['report.pdf'],
        options: { operation: 'compress-structural', quality: 'balanced' },
      }),
    );
    assert.equal(result.meta?.structuralOnly, true);
    assert.equal(result.meta?.engine, 'pdf-lib');
    assert.ok(typeof result.meta?.originalSize === 'number');
    assert.ok(typeof result.meta?.compressedSize === 'number');
    assert.ok(typeof result.meta?.reductionPercent === 'number');
    assert.match(result.outputName, /optimized|compressed/i);
  });
});

describe('repair capability', () => {
  it('fails clearly when no repair engine', async () => {
    const qpdf = resolveOptionalBinary('qpdf');
    const gs = resolveOptionalBinary('ghostscript');
    if (qpdf.available || gs.available) {
      // Engine present — run repair and expect success on a valid PDF
      const p = await multiPagePdf(1, 'RepairOk');
      const result = await processPdf(
        ctx({
          inputPaths: [p],
          inputNames: ['report.pdf'],
          options: { operation: 'repair' },
        }),
      );
      assert.ok(fs.existsSync(result.outputPath));
      assert.ok(['qpdf', 'ghostscript'].includes(String(result.meta?.engine)));
      return;
    }
    const p = await multiPagePdf(1, 'RepairFail');
    await assert.rejects(
      () =>
        processPdf(
          ctx({
            inputPaths: [p],
            options: { operation: 'repair' },
          }),
        ),
      (e: { code?: string }) => e.code === 'REPAIR_UNAVAILABLE' || /repair/i.test(String(e)),
    );
  });
});

describe('invalid page range', () => {
  it('rejects out-of-range pages', async () => {
    const p = await multiPagePdf(2, 'Range');
    await assert.rejects(
      () =>
        processPdf(
          ctx({
            inputPaths: [p],
            options: { operation: 'extract', pages: '9' },
          }),
        ),
      (e: { code?: string }) => e.code === 'PAGE_OUT_OF_RANGE' || /out of range/i.test(String(e)),
    );
  });
});
