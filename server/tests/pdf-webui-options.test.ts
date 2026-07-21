/**
 * Unit tests for shipped WebUI PDF option builder + client validation.
 * Imports the real frontend module used by PdfView (not a reimplementation).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modUrl = pathToFileURL(path.join(root, 'src/lib/pdfJobOptions.js')).href;
const {
  buildPdfJobOptions,
  validatePdfClient,
  isDeleteAllSpec,
  GATED_OP_IDS,
  PASSWORD_CAPABLE_OPS,
  defaultFormStateForOperation,
  describeJobMeta,
  formatBytes,
} = await import(modUrl);

describe('pdfJobOptions (shipped WebUI)', () => {
  it('exports gated op ids for optional tools', () => {
    assert.ok(GATED_OP_IDS.has('to-images'));
    assert.ok(GATED_OP_IDS.has('ocr'));
    assert.ok(GATED_OP_IDS.has('compress-advanced'));
    assert.ok(GATED_OP_IDS.has('repair'));
  });

  it('buildPdfJobOptions sends only op-relevant backend keys', () => {
    const extract = buildPdfJobOptions({
      operation: 'extract',
      pages: '1-2',
      opMeta: { needsPages: true },
    });
    assert.equal(extract.operation, 'extract');
    assert.equal(extract.pages, '1-2');
    assert.equal(extract.angle, undefined);
    assert.equal(extract.format, undefined);

    const merge = buildPdfJobOptions({ operation: 'merge', pages: '1-9', angle: '180' });
    assert.equal(merge.operation, 'merge');
    assert.equal(merge.pages, undefined);
    assert.equal(merge.angle, undefined);

    const rotate = buildPdfJobOptions({
      operation: 'rotate',
      pages: 'all',
      angle: '180',
      opMeta: { needsAngle: true },
    });
    assert.equal(rotate.angle, 180);
    assert.equal(rotate.pages, 'all');

    const split = buildPdfJobOptions({
      operation: 'split',
      splitMode: 'groups',
      splitGroups: '1-2;3-4',
      pages: 'should-not-send',
    });
    assert.equal(split.splitMode, 'groups');
    assert.equal(split.groups, '1-2;3-4');
    assert.equal(split.pages, undefined);

    const splitRanges = buildPdfJobOptions({
      operation: 'split',
      splitMode: 'ranges',
      pages: '1-2',
    });
    assert.equal(splitRanges.pages, '1-2');

    const everyN = buildPdfJobOptions({
      operation: 'split',
      splitMode: 'every-n',
      everyN: '3',
    });
    assert.equal(everyN.everyN, 3);

    const imgs = buildPdfJobOptions({
      operation: 'from-images',
      pageSize: 'a4',
      orientation: 'portrait',
      fit: 'cover',
      margin: '12',
      opMeta: { images: true, needsPageMode: true },
    });
    assert.equal(imgs.pageSize, 'a4');
    assert.equal(imgs.orientation, 'portrait');
    assert.equal(imgs.fit, 'cover');
    assert.equal(imgs.margin, 12);

    const toImg = buildPdfJobOptions({
      operation: 'to-images',
      format: 'jpeg',
      quality: 'high',
      dpi: '200',
      pages: '1',
    });
    assert.equal(toImg.format, 'jpeg');
    assert.equal(toImg.dpi, 200);
    assert.equal(toImg.quality, 'high');

    const adv = buildPdfJobOptions({
      operation: 'compress-advanced',
      quality: 'fast',
    });
    assert.equal(adv.compressMode, 'advanced');
    assert.equal(adv.quality, 'fast');

    const structural = buildPdfJobOptions({
      operation: 'compress-structural',
      quality: 'balanced',
    });
    assert.equal(structural.compressMode, 'structural');

    const ocr = buildPdfJobOptions({
      operation: 'ocr',
      ocrLang: 'vie',
      pages: '1-3',
    });
    assert.equal(ocr.ocr, true);
    assert.equal(ocr.ocrLang, 'vie');
    assert.equal(ocr.pages, '1-3');

    const text = buildPdfJobOptions({
      operation: 'to-text',
      ocr: true,
      ocrLang: 'eng',
    });
    assert.equal(text.ocr, true);
    assert.equal(text.ocrLang, 'eng');
  });

  it('includes password only when non-empty and omits empty strings', () => {
    assert.ok(PASSWORD_CAPABLE_OPS.has('inspect'));
    const withPwd = buildPdfJobOptions({
      operation: 'inspect',
      password: 'secret',
    });
    assert.equal(withPwd.password, 'secret');
    const noPwd = buildPdfJobOptions({ operation: 'inspect', password: '' });
    assert.equal(noPwd.password, undefined);
  });

  it('validatePdfClient enforces merge ≥2, pages, delete-all, split modes', () => {
    const pdf = { name: 'a.pdf', type: 'application/pdf' };
    const img = { name: 'a.png', type: 'image/png' };

    assert.match(
      String(validatePdfClient({ operation: 'merge', files: [pdf], opMeta: { multi: true } })),
      /at least two/i,
    );
    assert.equal(
      validatePdfClient({ operation: 'merge', files: [pdf, pdf], opMeta: { multi: true } }),
      null,
    );

    assert.match(
      String(
        validatePdfClient({
          operation: 'extract',
          files: [pdf],
          pages: '',
          opMeta: { needsPages: true },
        }),
      ),
      /Page selection is required/i,
    );

    assert.match(
      String(
        validatePdfClient({
          operation: 'delete-pages',
          files: [pdf],
          pages: 'all',
          opMeta: { needsPages: true },
        }),
      ),
      /Cannot delete all pages/i,
    );
    assert.ok(isDeleteAllSpec('1-4', 4));

    assert.match(
      String(
        validatePdfClient({
          operation: 'split',
          files: [pdf],
          splitMode: 'ranges',
          pages: '',
          opMeta: { needsSplitMode: true },
        }),
      ),
      /page ranges/i,
    );

    assert.match(
      String(
        validatePdfClient({
          operation: 'from-images',
          files: [pdf],
          opMeta: { images: true },
        }),
      ),
      /image files/i,
    );
    assert.equal(
      validatePdfClient({
        operation: 'from-images',
        files: [img],
        opMeta: { images: true },
      }),
      null,
    );
  });

  it('editPlan pages override text field for options when present', () => {
    const opts = buildPdfJobOptions({
      operation: 'extract',
      pages: '9',
      editPlan: { pages: '2,3', pageCount: 4 },
      opMeta: { needsPages: true },
    });
    assert.equal(opts.pages, '2,3');
  });

  it('typed pages field is used when editPlan is null (after op switch)', () => {
    const opts = buildPdfJobOptions({
      operation: 'extract',
      pages: '1',
      editPlan: null,
      opMeta: { needsPages: true },
    });
    assert.equal(opts.pages, '1');
  });

  it('defaultFormStateForOperation clears password and pages', () => {
    const d = defaultFormStateForOperation('merge');
    assert.equal(d.pages, '');
    assert.equal(d.password, '');
    assert.equal(d.editPlan, null);
  });

  it('describeJobMeta surfaces compression and OCR fields without assuming PDF mime', () => {
    const lines = describeJobMeta({
      outputMime: 'application/zip',
      meta: {
        engine: 'pdf-lib',
        originalSize: 10000,
        compressedSize: 8000,
        reductionPercent: 20,
        charCount: 42,
        ocrStatus: 'applied',
      },
    });
    const joined = lines.join(' ');
    assert.match(joined, /engine: pdf-lib/);
    assert.match(joined, /20%/);
    assert.match(joined, /chars: 42/);
    assert.match(joined, /OCR: applied/);
    assert.ok(formatBytes(2048));
  });
});
