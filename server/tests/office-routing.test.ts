/**
 * LibreOffice isolation helpers + magic validation + same-format safety.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  pickLoOutput,
  assertMagicForFormat,
  isSameFormatPair,
} from '../src/convert/office.js';

describe('LibreOffice output enumeration', () => {
  it('picks exact basename+ext over leftover files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-pick-'));
    try {
      fs.writeFileSync(path.join(dir, 'old.pdf'), '%PDF-1.4 leftover');
      fs.writeFileSync(path.join(dir, 'input.docx'), 'PK fake input');
      fs.writeFileSync(path.join(dir, 'input.pdf'), '%PDF-1.4 good');
      const found = pickLoOutput(dir, 'input.docx', '.pdf');
      assert.equal(found, 'input.pdf');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores lo-profile marker and input copy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-pick2-'));
    try {
      fs.mkdirSync(path.join(dir, 'lo-profile'));
      fs.writeFileSync(path.join(dir, 'doc.docx'), 'PK');
      fs.writeFileSync(path.join(dir, 'doc.pdf'), '%PDF-1.4 x');
      const found = pickLoOutput(dir, 'doc.docx', '.pdf');
      assert.equal(found, 'doc.pdf');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-pick3-'));
    try {
      assert.equal(pickLoOutput(dir, 'x.docx', '.pdf'), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('magic validation', () => {
  it('accepts PDF magic', () => {
    const p = path.join(os.tmpdir(), `magic-${process.pid}.pdf`);
    fs.writeFileSync(p, '%PDF-1.7\n% content');
    try {
      assert.doesNotThrow(() => assertMagicForFormat(p, '.pdf'));
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('rejects non-PDF with .pdf ext', () => {
    const p = path.join(os.tmpdir(), `magic-bad-${process.pid}.pdf`);
    fs.writeFileSync(p, 'NOT A PDF FILE!!!!');
    try {
      assert.throws(() => assertMagicForFormat(p, '.pdf'), /PDF magic/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('accepts ZIP magic for docx', () => {
    const p = path.join(os.tmpdir(), `magic-${process.pid}.docx`);
    fs.writeFileSync(p, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    try {
      assert.doesNotThrow(() => assertMagicForFormat(p, '.docx'));
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('same-format helper', () => {
  it('pdf→pdf is same; docx→pdf is not', () => {
    assert.equal(isSameFormatPair('pdf', 'pdf'), true);
    assert.equal(isSameFormatPair('docx', 'pdf'), false);
    assert.equal(isSameFormatPair('jpg', 'jpeg'), true);
  });
});
