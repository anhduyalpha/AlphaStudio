import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(root, 'fixtures', 'pdf');
const fixedDate = new Date('2024-01-01T00:00:00.000Z');
const generated = [];

await mkdir(fixtureDir, { recursive: true });

function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const pdfPasswordPadding = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function md5(...buffers) {
  const hash = createHash('md5');
  for (const buffer of buffers) hash.update(buffer);
  return hash.digest();
}

function padPdfPassword(password) {
  const bytes = Buffer.from(password, 'latin1').subarray(0, 32);
  return Buffer.concat([bytes, pdfPasswordPadding.subarray(0, 32 - bytes.length)]);
}

function rc4(key, input) {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = Buffer.alloc(input.length);
  let i = 0;
  j = 0;
  for (let offset = 0; offset < input.length; offset += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[offset] = input[offset] ^ state[(state[i] + state[j]) & 0xff];
  }
  return output;
}

function encryptedPdfFixture(userPassword = 'alphastudio', ownerPassword = 'alphastudio-owner') {
  const fileId = md5(Buffer.from('AlphaStudio deterministic encrypted fixture', 'ascii'));
  const ownerKey = md5(padPdfPassword(ownerPassword)).subarray(0, 5);
  const ownerEntry = rc4(ownerKey, padPdfPassword(userPassword));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const documentKey = md5(padPdfPassword(userPassword), ownerEntry, permissions, fileId).subarray(0, 5);
  const userEntry = rc4(documentKey, pdfPasswordPadding);

  const content = Buffer.from('BT /F1 18 Tf 72 720 Td (Encrypted fixture) Tj ET', 'ascii');
  const objectKeySuffix = Buffer.from([4, 0, 0, 0, 0]);
  const objectKey = md5(documentKey, objectKeySuffix).subarray(0, 10);
  const encryptedContent = rc4(objectKey, content);
  const objects = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'ascii'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'ascii'),
    Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>\nendobj\n', 'ascii'),
    Buffer.concat([
      Buffer.from(`4 0 obj\n<< /Length ${encryptedContent.length} >>\nstream\n`, 'ascii'),
      encryptedContent,
      Buffer.from('\nendstream\nendobj\n', 'ascii'),
    ]),
    Buffer.from(
      `5 0 obj\n<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${ownerEntry.toString('hex').toUpperCase()}> /U <${userEntry.toString('hex').toUpperCase()}> /P -4 >>\nendobj\n`,
      'ascii',
    ),
    Buffer.from('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n', 'ascii'),
  ];
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  const offsets = [0];
  let cursor = header.length;
  for (const object of objects) {
    offsets.push(cursor);
    cursor += object.length;
  }
  const xrefOffset = cursor;
  const xref = Buffer.from(
    `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\n`,
    'ascii',
  );
  const id = fileId.toString('hex').toUpperCase();
  const trailer = Buffer.from(
    `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 5 0 R /ID [<${id}><${id}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    'ascii',
  );
  return Buffer.concat([header, ...objects, xref, trailer]);
}

async function writeFixture(name, bytes, details) {
  const output = path.join(fixtureDir, name);
  await writeFile(output, bytes);
  generated.push({ name, sha256: checksum(bytes), size: bytes.length, ...details });
  return output;
}

function setDeterministicMetadata(doc, title) {
  doc.setTitle(title);
  doc.setAuthor('AlphaStudio deterministic fixtures');
  doc.setSubject('Local browser and PDF pipeline validation');
  doc.setCreator('AlphaStudio fixture generator');
  doc.setProducer('AlphaStudio fixture generator');
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
}

async function makeTextPdf({ title, pages = 1, lines = [] }) {
  const doc = await PDFDocument.create();
  setDeterministicMetadata(doc, title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${title} | page ${index + 1} of ${pages}`, {
      x: 54,
      y: 730,
      size: 18,
      font,
      color: rgb(0.1, 0.15, 0.25),
    });
    lines.forEach((line, lineIndex) => {
      page.drawText(line, { x: 54, y: 690 - lineIndex * 24, size: 12, font });
    });
  }
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const kind = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([length, kind, data, crc]);
}

function makeScannedPng(width = 320, height = 220) {
  const raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const ink =
        x < 4 || y < 4 || x >= width - 4 || y >= height - 4 ||
        ((y > 45 && y < 54) && x > 30 && x < 285) ||
        ((y > 82 && y < 90) && x > 30 && x < 240) ||
        ((y > 119 && y < 127) && x > 30 && x < 275);
      const value = ink ? 25 : 245;
      const offset = row + 1 + x * 3;
      raw[offset] = value;
      raw[offset + 1] = value;
      raw[offset + 2] = value;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const textBytes = await makeTextPdf({
  title: 'AlphaStudio text fixture',
  pages: 2,
  lines: ['Deterministic selectable text.', 'Second line for extraction and inspection.'],
});
await writeFixture('text-basic.pdf', textBytes, { kind: 'text', pages: 2 });

await writeFixture(
  'unicode-ภาษาไทย-报告.pdf',
  await makeTextPdf({ title: 'Unicode filename fixture', pages: 2, lines: ['Filename carries Thai and CJK Unicode.'] }),
  { kind: 'unicode-filename', pages: 2 },
);

await writeFixture(
  'quarterly.report.final.v1.pdf',
  await makeTextPdf({ title: 'Multiple dot filename fixture', lines: ['Stable output naming input.'] }),
  { kind: 'multi-dot-filename', pages: 1 },
);

await writeFixture(
  'organizer-8-pages.pdf',
  await makeTextPdf({ title: 'Organizer fixture', pages: 8, lines: ['Reorder, rotate, extract, delete, duplicate.'] }),
  { kind: 'organizer', pages: 8 },
);

await writeFixture(
  'large-205-pages.pdf',
  await makeTextPdf({ title: 'Large page-count fixture', pages: 205, lines: ['Exceeds the default preview page limit.'] }),
  { kind: 'large', pages: 205 },
);

const scannedDoc = await PDFDocument.create();
setDeterministicMetadata(scannedDoc, 'Image-only scanned fixture');
const scan = await scannedDoc.embedPng(makeScannedPng());
const scanPage = scannedDoc.addPage([612, 792]);
scanPage.drawImage(scan, { x: 36, y: 180, width: 540, height: 371.25 });
await writeFixture(
  'scanned-image-only.pdf',
  await scannedDoc.save({ useObjectStreams: false, addDefaultPage: false }),
  { kind: 'scanned-image-only', pages: 1 },
);

await writeFixture(
  'corrupt-truncated.pdf',
  Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%% deliberately truncated', 'ascii'),
  { kind: 'corrupt', pages: null },
);

await rm(path.join(fixtureDir, 'encrypted-source.pdf'), { force: true });
await rm(path.join(fixtureDir, 'encrypted.UNAVAILABLE.txt'), { force: true });
await writeFixture('encrypted-password-alpha.pdf', encryptedPdfFixture(), {
  kind: 'encrypted',
  pages: 1,
  password: 'alphastudio',
  securityHandler: 'Standard V1/R2 40-bit RC4',
});

generated.sort((a, b) => a.name.localeCompare(b.name, 'en'));
await writeFile(
  path.join(fixtureDir, 'manifest.json'),
  `${JSON.stringify({ schemaVersion: 1, generatedAt: fixedDate.toISOString(), fixtures: generated }, null, 2)}\n`,
  'utf8',
);

console.log(`Generated ${generated.length} deterministic PDF fixture records in ${fixtureDir}`);
