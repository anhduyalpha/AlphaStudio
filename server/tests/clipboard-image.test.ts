/**
 * Pure unit tests for clipboard image helpers (QR decode paste validation).
 * Source: src/lib/clipboardImage.js (ESM, no DOM required for these APIs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeClipboardFilename,
  validateClipboardImageBlob,
  detectImageMimeFromBytes,
  validateImageMagic,
  MAX_CLIPBOARD_IMAGE_BYTES,
  extFromMime,
} from '../../src/lib/clipboardImage.js';

describe('safeClipboardFilename', () => {
  it('ends with .png for image/png', () => {
    const when = new Date('2024-03-15T12:30:45.000Z');
    const name = safeClipboardFilename('image/png', when);
    assert.ok(name.endsWith('.png'), `expected .png suffix, got ${name}`);
    assert.match(name, /^clipboard-/);
  });

  it('uses jpg extension for jpeg mime', () => {
    assert.ok(safeClipboardFilename('image/jpeg').endsWith('.jpg'));
    assert.equal(extFromMime('image/webp'), 'webp');
  });
});

describe('validateClipboardImageBlob', () => {
  it('rejects empty', () => {
    assert.equal(validateClipboardImageBlob(null).ok, false);
    assert.equal(validateClipboardImageBlob(null).code, 'EMPTY');

    const empty = { size: 0, type: 'image/png' };
    const r = validateClipboardImageBlob(empty as Blob);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EMPTY');
  });

  it('rejects oversized', () => {
    const big = { size: MAX_CLIPBOARD_IMAGE_BYTES + 1, type: 'image/png' };
    const r = validateClipboardImageBlob(big as Blob);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'TOO_LARGE');
  });

  it('rejects non-image', () => {
    const text = { size: 100, type: 'text/plain' };
    const r = validateClipboardImageBlob(text as Blob);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NOT_IMAGE');

    const app = { size: 100, type: 'application/octet-stream' };
    const a = validateClipboardImageBlob(app as Blob);
    assert.equal(a.ok, false);
    assert.equal(a.code, 'NOT_IMAGE');
  });

  it('accepts valid image blob', () => {
    const ok = validateClipboardImageBlob({ size: 2048, type: 'image/png' } as Blob);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.mime, 'image/png');
      assert.equal(ok.size, 2048);
    }
  });
});

describe('detectImageMimeFromBytes', () => {
  it('recognizes PNG magic', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert.equal(detectImageMimeFromBytes(png), 'image/png');
  });

  it('recognizes JPEG and GIF magic', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    assert.equal(detectImageMimeFromBytes(jpeg), 'image/jpeg');

    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
    assert.equal(detectImageMimeFromBytes(gif), 'image/gif');
  });

  it('returns null for short or unknown buffers', () => {
    assert.equal(detectImageMimeFromBytes(new Uint8Array([1, 2, 3])), null);
    assert.equal(detectImageMimeFromBytes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), null);
  });
});

describe('validateImageMagic', () => {
  it('rejects random bytes', () => {
    const random = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]);
    const r = validateImageMagic(random);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CORRUPT');
  });

  it('accepts PNG magic bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = validateImageMagic(png, 'image/png');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.mime, 'image/png');
      assert.equal(r.magic, 'image/png');
    }
  });

  it('allows declared image mime when magic unknown', () => {
    const random = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const r = validateImageMagic(random, 'image/png');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.mime, 'image/png');
      assert.equal(r.magic, null);
    }
  });
});
