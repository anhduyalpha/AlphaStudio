/**
 * LibreOffice isolation: same-format gate, path normalization, install completeness,
 * output enumeration, convertWithLibreOffice defense-in-depth, optional live DOCX→PDF.
 * Does NOT use LibreOffice for PDF input tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const {
  isSameFormatPair,
  pickLoOutput,
  convertWithLibreOffice,
} = await import('../src/convert/office.js');
const {
  normalizeLibreOfficePath,
  isLibreOfficeInstallComplete,
  resolveTool,
  clearToolsCache,
} = await import('../src/tools/registry.js');

/** Shipped portable LO path (when present). */
const SHIPPED_LO_COM = path.join(
  repoRoot,
  '.runtime',
  'tools',
  'win32-x64',
  'libreoffice',
  'program',
  'soffice.com',
);
const SHIPPED_LO_EXE = path.join(
  repoRoot,
  '.runtime',
  'tools',
  'win32-x64',
  'libreoffice',
  'program',
  'soffice.exe',
);
const SHIPPED_LO_PROGRAM = path.dirname(SHIPPED_LO_COM);

function loAvailable(): boolean {
  clearToolsCache();
  const t = resolveTool('libreoffice');
  return Boolean(t.available && t.path && isLibreOfficeInstallComplete(normalizeLibreOfficePath(t.path)));
}

/** Minimal OOXML DOCX (ZIP with required parts) for optional live conversion. */
async function writeMinimalDocx(dest: string): Promise<void> {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>AlphaStudio LO isolation fixture</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    out.on('error', reject);
    out.on('close', () => resolve());
    archive.pipe(out);
    archive.append(contentTypes, { name: '[Content_Types].xml' });
    archive.append(rels, { name: '_rels/.rels' });
    archive.append(document, { name: 'word/document.xml' });
    void archive.finalize();
  });
}

function assertNoRawAbsolutePaths(message: string): void {
  // Windows drive paths and common POSIX absolute user/home paths
  assert.ok(
    !/[A-Za-z]:\\[^\s)'"`]+/.test(message),
    `user error must not leak Windows absolute path: ${message}`,
  );
  assert.ok(
    !/\/(?:Users|home|tmp|var|opt|usr)\/[^\s)'"`]+/.test(message),
    `user error must not leak POSIX absolute path: ${message}`,
  );
}

describe('isSameFormatPair (isolation gate)', () => {
  it('blocks pdf→pdf', () => {
    assert.equal(isSameFormatPair('pdf', 'pdf'), true);
    assert.equal(isSameFormatPair('PDF', 'pdf'), true);
  });

  it('allows docx→pdf and treats jpg/jpeg as same', () => {
    assert.equal(isSameFormatPair('docx', 'pdf'), false);
    assert.equal(isSameFormatPair('jpg', 'jpeg'), true);
    assert.equal(isSameFormatPair('xlsx', 'csv'), false);
  });
});

describe('normalizeLibreOfficePath', () => {
  it('prefers .com on win32 when sibling exists (shipped runtime)', () => {
    if (process.platform !== 'win32') {
      // Non-Windows: passthrough
      const p = normalizeLibreOfficePath('/opt/libreoffice/program/soffice');
      assert.equal(p, '/opt/libreoffice/program/soffice');
      return;
    }
    if (!fs.existsSync(SHIPPED_LO_COM) || !fs.existsSync(SHIPPED_LO_EXE)) {
      // Still verify: missing .com sibling leaves .exe unchanged
      const fakeExe = path.join(os.tmpdir(), 'no-such-lo-program', 'soffice.exe');
      assert.equal(normalizeLibreOfficePath(fakeExe), fakeExe);
      return;
    }
    const normalized = normalizeLibreOfficePath(SHIPPED_LO_EXE);
    assert.equal(path.basename(normalized).toLowerCase(), 'soffice.com');
    assert.ok(fs.existsSync(normalized));
    // Already .com stays .com
    assert.equal(
      path.normalize(normalizeLibreOfficePath(SHIPPED_LO_COM)).toLowerCase(),
      path.normalize(SHIPPED_LO_COM).toLowerCase(),
    );
  });
});

describe('isLibreOfficeInstallComplete', () => {
  it('returns false for a fake bare path', () => {
    const bare = path.join(os.tmpdir(), `lo-bare-${process.pid}`, 'soffice.exe');
    assert.equal(isLibreOfficeInstallComplete(bare), false);
    assert.equal(isLibreOfficeInstallComplete(''), false);
    assert.equal(isLibreOfficeInstallComplete(path.join(os.tmpdir(), 'nope')), false);
  });

  it('returns false for bare single-file copy under program/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-incomplete-'));
    try {
      const program = path.join(dir, 'program');
      fs.mkdirSync(program, { recursive: true });
      const fake = path.join(program, process.platform === 'win32' ? 'soffice.exe' : 'soffice');
      fs.writeFileSync(fake, 'not real lo');
      // No soffice.bin, no markers → incomplete
      assert.equal(isLibreOfficeInstallComplete(fake), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns true for real LO program dir if present', () => {
    if (!fs.existsSync(SHIPPED_LO_COM) && !fs.existsSync(SHIPPED_LO_EXE)) {
      // Capability skip — no assertion of true without install
      assert.ok(true, 'shipped LO not present; completeness true-path skipped');
      return;
    }
    const exec = fs.existsSync(SHIPPED_LO_COM) ? SHIPPED_LO_COM : SHIPPED_LO_EXE;
    assert.equal(isLibreOfficeInstallComplete(exec), true);
    assert.ok(/program$/i.test(SHIPPED_LO_PROGRAM));
  });
});

describe('pickLoOutput enumeration', () => {
  it('picks exact basename+ext; ignores input copy and lo-profile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-enum-'));
    try {
      fs.mkdirSync(path.join(dir, 'lo-profile'));
      fs.writeFileSync(path.join(dir, 'report.docx'), 'PK input');
      fs.writeFileSync(path.join(dir, 'leftover.pdf'), '%PDF-1.4 old');
      fs.writeFileSync(path.join(dir, 'report.pdf'), '%PDF-1.4 good');
      assert.equal(pickLoOutput(dir, 'report.docx', '.pdf'), 'report.pdf');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when empty or only input present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-enum-empty-'));
    try {
      assert.equal(pickLoOutput(dir, 'x.docx', '.pdf'), null);
      fs.writeFileSync(path.join(dir, 'x.docx'), 'PK');
      assert.equal(pickLoOutput(dir, 'x.docx', '.pdf'), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers matching ext among multiple candidates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-enum-multi-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.txt'), 't');
      fs.writeFileSync(path.join(dir, 'only.pdf'), '%PDF-1.4 x');
      assert.equal(pickLoOutput(dir, 'input.docx', '.pdf'), 'only.pdf');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('convertWithLibreOffice same-format defense', () => {
  it('rejects pdf→pdf without spawning LibreOffice', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-samefmt-'));
    const pdfPath = path.join(dir, 'sample.pdf');
    // Not a real conversion — only extension is used for the gate
    fs.writeFileSync(pdfPath, '%PDF-1.4\n% gate-only\n');
    const t0 = Date.now();
    await assert.rejects(
      () =>
        convertWithLibreOffice({
          inputPath: pdfPath,
          outputDir: dir,
          outFormat: 'pdf',
          jobId: 'samefmt-pdf',
          timeoutMs: 5_000,
        }),
      (err: unknown) => {
        const e = err as Error & { statusCode?: number; code?: string };
        assert.match(e.message, /Same-format/i);
        assert.match(e.message, /must not use LibreOffice/i);
        assert.equal(e.statusCode, 400);
        assert.equal(e.code, 'BAD_REQUEST');
        assertNoRawAbsolutePaths(e.message);
        return true;
      },
    );
    // Gate runs before requireTool / spawn — must be near-instant
    assert.ok(Date.now() - t0 < 2_000, 'same-format reject should not wait on LO');
    // No isolated outdir pollution expected when gate fires first
    const kids = fs.readdirSync(dir);
    assert.ok(
      !kids.some((k) => k.startsWith('lo-out-')),
      'must not create lo-out dir when same-format blocked',
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects docx→docx same-format', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-same-docx-'));
    const docx = path.join(dir, 'note.docx');
    fs.writeFileSync(docx, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    await assert.rejects(
      () =>
        convertWithLibreOffice({
          inputPath: docx,
          outputDir: dir,
          outFormat: 'docx',
          jobId: 'samefmt-docx',
        }),
      /Same-format/i,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('convertWithLibreOffice user-facing errors', () => {
  it('sanitizes absolute paths on failure when LO is available', async (t) => {
    if (!loAvailable()) {
      t.skip('LibreOffice not available — path-sanitization via live fail skipped');
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-err-sanitize-'));
    try {
      // Corrupt OOXML-looking zip: LO should fail or produce nothing useful
      const bad = path.join(dir, 'broken.docx');
      fs.writeFileSync(bad, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff]));
      await assert.rejects(
        () =>
          convertWithLibreOffice({
            inputPath: bad,
            outputDir: dir,
            outFormat: 'pdf',
            jobId: 'sanitize-fail',
            timeoutMs: 90_000,
          }),
        (err: unknown) => {
          const e = err as Error & { statusCode?: number };
          assert.ok(e.message, 'expected error message');
          // 400 conversion failure or 503 incomplete — both user-facing
          assert.ok(
            e.statusCode === 400 || e.statusCode === 503,
            `unexpected status ${e.statusCode}: ${e.message}`,
          );
          assertNoRawAbsolutePaths(e.message);
          return true;
        },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('same-format user message has no absolute paths', async () => {
    const abs = path.join(os.tmpdir(), `secret-abs-${process.pid}`, 'x.pdf');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '%PDF-1.4\n');
    try {
      await assert.rejects(
        () =>
          convertWithLibreOffice({
            inputPath: abs,
            outputDir: path.dirname(abs),
            outFormat: 'pdf',
          }),
        (err: unknown) => {
          assertNoRawAbsolutePaths((err as Error).message);
          return true;
        },
      );
    } finally {
      fs.rmSync(path.dirname(abs), { recursive: true, force: true });
    }
  });
});

describe('optional live DOCX→PDF via LibreOffice', () => {
  it('converts minimal generated DOCX to PDF when LO available', async (t) => {
    if (!loAvailable()) {
      t.skip('LibreOffice unavailable — optional conversion skipped');
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-live-docx-'));
    const docxPath = path.join(dir, 'tiny.docx');
    try {
      await writeMinimalDocx(docxPath);
      // Confirm ZIP/PK magic before convert
      const head = Buffer.alloc(4);
      const fd = fs.openSync(docxPath, 'r');
      fs.readSync(fd, head, 0, 4, 0);
      fs.closeSync(fd);
      assert.equal(head[0], 0x50);
      assert.equal(head[1], 0x4b);

      const result = await convertWithLibreOffice({
        inputPath: docxPath,
        outputDir: dir,
        outFormat: 'pdf',
        jobId: 'live-docx-pdf',
        originalBaseName: 'tiny',
        timeoutMs: 180_000,
      });

      assert.ok(fs.existsSync(result.outputPath), 'output file exists');
      assert.match(result.outputName, /\.pdf$/i);
      assert.equal(path.extname(result.outputPath).toLowerCase(), '.pdf');
      const magic = Buffer.alloc(5);
      const ofd = fs.openSync(result.outputPath, 'r');
      fs.readSync(ofd, magic, 0, 5, 0);
      fs.closeSync(ofd);
      assert.equal(magic.toString('ascii'), '%PDF-');
      // Isolation marker directory left for observability
      assert.ok(
        fs.existsSync(path.join(dir, 'lo-profile')),
        'lo-profile marker should exist under outputDir',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
