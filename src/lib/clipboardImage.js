/**
 * Pure helpers for QR Decode clipboard paste validation.
 * Safe to unit-test without DOM or network.
 */

/** Default max clipboard image size (10 MiB). */
export const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME = /^(image\/(png|jpe?g|webp|gif|bmp|avif|x-icon|vnd\.microsoft\.icon))$/i;

/** Magic-byte signatures for common image types (first bytes). */
const MAGIC = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], webp: true }, // RIFF....WEBP
  { mime: 'image/bmp', bytes: [0x42, 0x4d] },
];

/**
 * Generate a safe upload filename for a clipboard blob.
 * Never trusts clipboard-supplied names.
 */
export function safeClipboardFilename(mime = 'image/png', when = new Date()) {
  const ext = extFromMime(mime);
  const stamp = when.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `clipboard-${stamp}.${ext}`;
}

export function extFromMime(mime = '') {
  const m = String(mime).toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('bmp')) return 'bmp';
  if (m.includes('avif')) return 'avif';
  if (m.includes('svg')) return 'svg';
  return 'png';
}

/**
 * Detect MIME from magic bytes when possible.
 * @param {ArrayBuffer|Uint8Array|Buffer} buf
 * @returns {string|null}
 */
export function detectImageMimeFromBytes(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 4) return null;
  for (const sig of MAGIC) {
    if (sig.bytes.every((b, i) => u8[i] === b)) {
      if (sig.webp) {
        // RIFF....WEBP at offset 8
        if (u8.length >= 12 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) {
          return 'image/webp';
        }
        continue;
      }
      return sig.mime;
    }
  }
  return null;
}

/**
 * Validate a Blob/File as a clipboard image for QR decode.
 * @returns {{ ok: true, mime: string, size: number } | { ok: false, reason: string, code: string }}
 */
export function validateClipboardImageBlob(blob, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_CLIPBOARD_IMAGE_BYTES;
  if (!blob || typeof blob.size !== 'number') {
    return { ok: false, reason: 'No image data found in clipboard.', code: 'EMPTY' };
  }
  if (blob.size <= 0) {
    return { ok: false, reason: 'Clipboard image is empty.', code: 'EMPTY' };
  }
  if (blob.size > maxBytes) {
    return {
      ok: false,
      reason: `Image is too large (${formatBytes(blob.size)}). Maximum is ${formatBytes(maxBytes)}.`,
      code: 'TOO_LARGE',
    };
  }
  const declared = (blob.type || '').toLowerCase();
  // SVG is not accepted for QR decode (unsafe / not raster)
  if (declared.includes('svg')) {
    return {
      ok: false,
      reason: 'SVG images cannot be decoded as QR. Paste a PNG or JPEG.',
      code: 'UNSUPPORTED',
    };
  }
  if (declared && !IMAGE_MIME.test(declared)) {
    return {
      ok: false,
      reason: `Clipboard item is not an image (${declared || 'unknown type'}).`,
      code: 'NOT_IMAGE',
    };
  }
  return { ok: true, mime: declared || 'image/png', size: blob.size };
}

/**
 * Validate magic bytes of an ArrayBuffer already loaded from a blob.
 */
export function validateImageMagic(bytes, declaredMime) {
  const magic = detectImageMimeFromBytes(bytes);
  if (!magic) {
    // Allow when declared image/* and small buffer edge cases
    if (declaredMime && IMAGE_MIME.test(declaredMime)) {
      return { ok: true, mime: declaredMime, magic: null };
    }
    return {
      ok: false,
      reason: 'Image data is corrupted or not a supported image format.',
      code: 'CORRUPT',
    };
  }
  return { ok: true, mime: magic, magic };
}

/**
 * Read image dimensions from a blob via createImageBitmap or HTMLImageElement.
 * Returns { width, height } or null.
 */
export async function readImageDimensions(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      const dims = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return dims;
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Full async validation: type, size, magic, optional dimensions.
 * @returns {Promise<{ ok: true, file: File, previewUrl: string, meta: object } | { ok: false, reason: string, code: string }>}
 */
export async function prepareClipboardImage(blob, opts = {}) {
  const basic = validateClipboardImageBlob(blob, opts);
  if (!basic.ok) return basic;

  let head;
  try {
    head = await blob.slice(0, 16).arrayBuffer();
  } catch {
    return { ok: false, reason: 'Could not read clipboard image data.', code: 'READ_ERROR' };
  }
  const magic = validateImageMagic(head, basic.mime);
  if (!magic.ok) return magic;

  const mime = magic.mime || basic.mime;
  const name = opts.filename || safeClipboardFilename(mime);
  const file = new File([blob], name, { type: mime, lastModified: Date.now() });

  let previewUrl = null;
  try {
    previewUrl = URL.createObjectURL(file);
  } catch {
    return { ok: false, reason: 'Could not create image preview.', code: 'PREVIEW' };
  }

  const dims = await readImageDimensions(file);
  if (!dims || !dims.width || !dims.height) {
    URL.revokeObjectURL(previewUrl);
    return {
      ok: false,
      reason: 'Image could not be decoded (corrupted or unsupported).',
      code: 'CORRUPT',
    };
  }

  return {
    ok: true,
    file,
    previewUrl,
    meta: {
      name: file.name,
      type: mime,
      size: file.size,
      width: dims.width,
      height: dims.height,
    },
  };
}

/** Extract image Blob from a ClipboardEvent or ClipboardItem list. */
export async function imageBlobFromClipboardEvent(event) {
  const items = event?.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
  }
  // Clipboard API (async)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
    try {
      const list = await navigator.clipboard.read();
      for (const item of list) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return await item.getType(type);
      }
    } catch (err) {
      const msg = err?.name === 'NotAllowedError' || /denied|permission/i.test(String(err?.message || err))
        ? 'Clipboard permission denied. Use Ctrl+V in this dialog, drag-and-drop, or choose a file.'
        : err?.message || 'Could not read clipboard.';
      const e = new Error(msg);
      e.code = err?.name === 'NotAllowedError' ? 'PERMISSION' : 'CLIPBOARD';
      throw e;
    }
  }
  return null;
}

export function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
