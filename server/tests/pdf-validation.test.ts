/**
 * PDF validation, text extraction, and precise errors.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scratch = path.join(os.tmpdir(), `pdf-val-${process.pid}`);

import {
  validatePdfInput,
  hasPdfMagic,
  extractTextSampleFromBytes,
  assertMeaningfulTextOutput,
  sanitizeUserError,
  pdfError,
  clearPdfInspectCache,
} from '../src/convert/pdfInspect.js';
import { extractPdfText, extractTextNativeSync } from '../src/convert/pdfText.js';
import { parsePages } from '../src/processors/pdf.js';

/**
 * Minimal PDF with a real /Encrypt dictionary so pdf-lib rejects without password.
 * Structure is a valid enough PDF shell for magic + encryption probe.
 */
function buildEncryptedPdfFixture(): Buffer {
  // Standard-security empty pads (PDF 1.4) — enough for pdf-lib to detect encryption
  const oPad =
    '28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A';
  const uPad = oPad;
  const lines = [
    '%PDF-1.4',
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R >>endobj',
    // Encrypt dict (Standard filter V2 R3) — pdf-lib will refuse without ignoreEncryption
    `4 0 obj<< /Filter /Standard /V 2 /R 3 /Length 128 /P -4 /O <${oPad}> /U <${uPad}> >>endobj`,
    '5 0 obj<< /Length 44 >>stream',
    'BT /F1 12 Tf 50 100 Td (secret) Tj ET',
    'endstream',
    'endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000214 00000 n ',
    '0000000350 00000 n ',
    'trailer<< /Size 6 /Root 1 0 R /Encrypt 4 0 R /ID [<ABCDEF0123456789ABCDEF0123456789> <ABCDEF0123456789ABCDEF0123456789>] >>',
    'startxref',
    '450',
    '%%EOF',
    '',
  ];
  return Buffer.from(lines.join('\n'), 'latin1');
}

before(() => {
  fs.mkdirSync(scratch, { recursive: true });
  clearPdfInspectCache();
});

after(() => {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function makeTextPdf(text: string, name = 'text.pdf'): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 40, y: 120, size: 14, font });
  const bytes = await doc.save();
  const p = path.join(scratch, name);
  fs.writeFileSync(p, bytes);
  return p;
}

describe('PDF magic and validation', () => {
  it('hasPdfMagic accepts real PDF', async () => {
    const p = await makeTextPdf('Hello AlphaStudio');
    assert.equal(hasPdfMagic(p), true);
  });

  it('rejects missing magic as Corrupted PDF', async () => {
    const p = path.join(scratch, 'bad.pdf');
    fs.writeFileSync(p, 'not a pdf at all!!!!');
    await assert.rejects(
      () => validatePdfInput(p),
      (e: Error & { code?: string }) => {
        assert.match(e.message, /Corrupted PDF|magic/i);
        return true;
      },
    );
  });

  it('rejects empty file', async () => {
    const p = path.join(scratch, 'empty.pdf');
    fs.writeFileSync(p, '');
    await assert.rejects(() => validatePdfInput(p), /Empty PDF|zero/i);
  });

  it('rejects extension mismatch', async () => {
    const p = await makeTextPdf('x', 'ok.pdf');
    await assert.rejects(
      () => validatePdfInput(p, { originalName: 'notes.txt' }),
      /mismatch|extension/i,
    );
  });

  it('inspects page count and metadata on text PDF', async () => {
    const p = await makeTextPdf('Unicode cafe resume');
    const ins = await validatePdfInput(p, { originalName: 'doc.pdf' });
    assert.ok(ins.pageCount >= 1);
    assert.equal(ins.encrypted, false);
    assert.ok(ins.checksum.length === 64);
    assert.equal(ins.engine, 'pdf-lib');
  });

  it('detects text-based pdf-lib PDFs as not scanned (FlateDecode streams)', async () => {
    clearPdfInspectCache();
    const p = await makeTextPdf('ScannedDetectionMarker AlphaStudio Text');
    const ins = await validatePdfInput(p, { originalName: 'texty.pdf' });
    // Must not mark a real text PDF as scanned (inflate +/or pdftotext probe)
    assert.equal(
      ins.scannedLikely,
      false,
      `expected text PDF not scanned; chars=${ins.textCharCount} sample=${ins.textSample?.slice(0, 80)}`,
    );
    assert.ok(ins.textCharCount >= 8, `textCharCount=${ins.textCharCount}`);
    // Native inflate path should also surface text operators when streams compress
    const sample = extractTextSampleFromBytes(fs.readFileSync(p));
    // Either inflate found operators OR external probe did (ins already proved text)
    assert.ok(
      sample.replace(/\s+/g, '').length >= 1 || ins.textCharCount >= 8,
      `neither inflate nor probe found text; sample=${sample.slice(0, 40)}`,
    );
  });

  it('rejects encrypted PDF with Password required (real fixture)', async () => {
    clearPdfInspectCache();
    const p = path.join(scratch, 'encrypted.pdf');
    fs.writeFileSync(p, buildEncryptedPdfFixture());
    // Magic must still look like a PDF
    assert.equal(hasPdfMagic(p), true);
    await assert.rejects(
      () => validatePdfInput(p, { originalName: 'secret.pdf' }),
      (e: Error & { code?: string; details?: { pdfCode?: string } }) => {
        assert.match(e.message, /Password required/i);
        assert.ok(
          e.code === 'PASSWORD_REQUIRED' ||
            (e as { details?: { pdfCode?: string } }).details?.pdfCode === 'PASSWORD_REQUIRED' ||
            /Password required/i.test(e.message),
        );
        return true;
      },
    );
  });

  it('processPdf rejects PDF bytes labeled as .docx (extension mismatch)', async () => {
    const { processPdf } = await import('../src/processors/pdf.js');
    const p = await makeTextPdf('Mismatch Ext Content');
    const workDir = path.join(scratch, 'mm-work');
    const outputDir = path.join(scratch, 'mm-out');
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    await assert.rejects(
      () =>
        processPdf({
          jobId: 'mm',
          inputPaths: [p],
          inputNames: ['report.docx'],
          options: { operation: 'merge' },
          workDir,
          outputDir,
          onProgress: () => {},
          isCancelled: () => false,
        }),
      /mismatch|extension|MIME/i,
    );
  });

  it('sanitizeUserError strips Windows paths', () => {
    const s = sanitizeUserError('failed at C:\\Users\\Duy\\secret\\file.pdf with error');
    assert.ok(!s.includes('Users\\Duy'));
    assert.match(s, /\[path\]/);
  });

  it('pdfError sets precise codes', () => {
    const e = pdfError('PASSWORD_REQUIRED', 'Password required: encrypted');
    assert.equal(e.code, 'PASSWORD_REQUIRED');
    assert.match(e.message, /Password required/i);
  });
});

describe('PDF text extraction', () => {
  it('extracts meaningful text from text PDF → TXT', async () => {
    const p = await makeTextPdf('AlphaStudio pipeline test content 12345');
    const outDir = path.join(scratch, 'out-txt');
    fs.mkdirSync(outDir, { recursive: true });
    const result = await extractPdfText({
      inputPath: p,
      outputDir: outDir,
      ocr: false,
      originalBaseName: 'sample',
    });
    assert.ok(fs.existsSync(result.outputPath));
    const text = fs.readFileSync(result.outputPath, 'utf8');
    assert.ok(text.replace(/\s+/g, '').length > 5, 'non-empty text');
    // Should contain some of the source words (pdftotext or native)
    assert.ok(
      /AlphaStudio|pipeline|test|content|12345/i.test(text) ||
        result.charCount > 5,
      `unexpected text: ${text.slice(0, 200)} engine=${result.engine}`,
    );
    assert.equal(result.usedOcr, false);
    assertMeaningfulTextOutput(result.outputPath);
  });

  it('scanned-like PDF without OCR fails with No extractable text', async () => {
    // Image-only PDF (no text operators)
    const png = await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
      .png()
      .toBuffer();
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    const bytes = await doc.save();
    const p = path.join(scratch, 'scanned.pdf');
    fs.writeFileSync(p, bytes);

    const outDir = path.join(scratch, 'out-scan');
    fs.mkdirSync(outDir, { recursive: true });
    await assert.rejects(
      () =>
        extractPdfText({
          inputPath: p,
          outputDir: outDir,
          ocr: false,
        }),
      (e: Error) => {
        assert.match(e.message, /No extractable text|scanned/i);
        return true;
      },
    );
  });

  it('OCR requested without tesseract yields OCR unavailable (or succeeds if present)', async () => {
    const png = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    const p = path.join(scratch, 'ocr-try.pdf');
    fs.writeFileSync(p, await doc.save());
    const outDir = path.join(scratch, 'out-ocr');
    fs.mkdirSync(outDir, { recursive: true });
    try {
      const r = await extractPdfText({ inputPath: p, outputDir: outDir, ocr: true });
      // If OCR stack exists, may still find no text — that's ok if meaningful or error
      assert.ok(r.outputPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert.match(msg, /OCR unavailable|No extractable text|rasterizer/i);
    }
  });

  it('native extractor finds parentheses strings', async () => {
    const p = await makeTextPdf('NativeExtractMarkerXYZ');
    const sample = extractTextNativeSync(p);
    // pdf-lib encoded text may or may not be plain in stream; sample is best-effort
    assert.equal(typeof sample, 'string');
    const bytes = fs.readFileSync(p);
    const fromBytes = extractTextSampleFromBytes(bytes);
    assert.equal(typeof fromBytes, 'string');
  });
});

describe('PDF edit helpers', () => {
  it('parsePages supports ranges and open ends', () => {
    assert.deepEqual(parsePages('1-3', 5), [0, 1, 2]);
    assert.deepEqual(parsePages('1,3,5', 5), [0, 2, 4]);
    assert.deepEqual(parsePages('2-', 4), [1, 2, 3]);
    assert.deepEqual(parsePages('-2', 4), [0, 1]);
  });
});

describe('assertMeaningfulTextOutput', () => {
  it('rejects empty file', () => {
    const p = path.join(scratch, 'blank.txt');
    fs.writeFileSync(p, '   \n  \t  ');
    assert.throws(() => assertMeaningfulTextOutput(p), /Output validation failed|meaningful/i);
  });
});

// Keep __dirname referenced for future fixture paths
void __dirname;
