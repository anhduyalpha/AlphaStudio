/**
 * PDF → images page selection: filterRasterPagesByIndices + processPdf when rasterizer present.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { filterRasterPagesByIndices } from '../src/convert/pdfRender.js';
import { processPdf } from '../src/processors/pdf.js';
import { hasPdfRasterizer } from '../src/tools/optional-binaries.js';
import type { ProcessContext } from '../src/processors/types.js';

const root = path.join(os.tmpdir(), `pdf-img-sel-${process.pid}`);

function ctx(partial: Partial<ProcessContext> & { inputPaths: string[]; options: Record<string, unknown> }): ProcessContext {
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

async function multiPdf(n: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`P${i + 1}`, { x: 40, y: 100, size: 20, font });
  }
  fs.mkdirSync(root, { recursive: true });
  const p = path.join(root, `sel-${n}.pdf`);
  fs.writeFileSync(p, await doc.save());
  return p;
}

before(() => fs.mkdirSync(root, { recursive: true }));
after(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('filterRasterPagesByIndices (shipped helper)', () => {
  it('preserves order and selects only requested zero-based indices', () => {
    const pages = [
      { name: 'p1' },
      { name: 'p2' },
      { name: 'p3' },
      { name: 'p4' },
    ];
    // pages='2,4' → zero-based [1, 3]
    const selected = filterRasterPagesByIndices(pages, [1, 3]);
    assert.equal(selected.length, 2);
    assert.deepEqual(
      selected.map((p) => p.name),
      ['p2', 'p4'],
    );
  });

  it('returns all pages when indices omitted', () => {
    const pages = [{ name: 'a' }, { name: 'b' }];
    assert.equal(filterRasterPagesByIndices(pages, undefined).length, 2);
  });

  it('throws when index exceeds rasterized set', () => {
    assert.throws(
      () => filterRasterPagesByIndices([{ name: 'a' }], [1]),
      /out of range/i,
    );
  });
});

describe('processPdf to-images page selection', () => {
  it('pages=2,4 yields only those pages (when rasterizer available)', async () => {
    if (!hasPdfRasterizer()) {
      // Without a rasterizer the op is capability-gated; selection helper is still covered above.
      // Still call processPdf to prove the shipped path rejects cleanly.
      const p = await multiPdf(4);
      await assert.rejects(
        () =>
          processPdf(
            ctx({
              inputPaths: [p],
              inputNames: ['doc.pdf'],
              options: { operation: 'to-images', pages: '2,4', format: 'png' },
            }),
          ),
        (e: { code?: string }) =>
          e.code === 'RASTERIZER_UNAVAILABLE' || /rasterizer/i.test(String(e)),
      );
      return;
    }

    const p = await multiPdf(4);
    const result = await processPdf(
      ctx({
        inputPaths: [p],
        inputNames: ['doc.pdf'],
        options: { operation: 'to-images', pages: '2,4', format: 'png' },
      }),
    );
    assert.ok(fs.existsSync(result.outputPath));
    const selected = result.meta?.selectedPages as number[] | undefined;
    assert.deepEqual(selected, [2, 4]);
    assert.equal(result.meta?.pages, 2);
    assert.equal(result.meta?.pageCount, 2);
    assert.equal(result.meta?.outputKind, 'zip');
    // Two pages → zip
    assert.equal(result.outputMime, 'application/zip');
  });
});
