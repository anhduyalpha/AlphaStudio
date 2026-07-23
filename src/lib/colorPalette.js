/**
 * Browser-side color helpers: hex/rgb, contrast, and image palette extraction.
 */

export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b };
  }
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function relLuminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a, b) {
  const L1 = relLuminance(a);
  const L2 = relLuminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastGrade(ratio) {
  if (ratio == null || Number.isNaN(ratio)) {
    return { aaBody: false, aaLarge: false, aaaBody: false, aaaLarge: false };
  }
  return {
    aaBody: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaBody: ratio >= 7,
    aaaLarge: ratio >= 4.5,
  };
}

/** Synthetic shade ladder from a seed hex (picker/palette modes without image). */
export function paletteFromHex(hex, count = 5) {
  const rgb = hexToRgb(hex) || { r: 155, g: 124, b: 255 };
  const steps = count <= 1 ? [1] : Array.from({ length: count }, (_, i) => (i + 1) / count);
  return steps.map((t) => rgbToHex(
    Math.round(rgb.r * t + 255 * (1 - t) * 0.12),
    Math.round(rgb.g * t + 255 * (1 - t) * 0.12),
    Math.round(rgb.b * t + 255 * (1 - t) * 0.12),
  ));
}

/**
 * Quantize ImageData pixels into dominant colors by bucket frequency.
 * Pure enough for tests with synthetic ImageData-like { data, width, height }.
 * @param {{ data: Uint8ClampedArray|number[], width: number, height: number }} imageData
 * @param {{ maxColors?: number, sampleStep?: number, bits?: number }} [opts]
 * @returns {string[]} hex colors, most frequent first
 */
export function extractPaletteFromImageData(imageData, opts = {}) {
  const maxColors = Math.max(1, Math.min(16, Number(opts.maxColors) || 6));
  const sampleStep = Math.max(1, Number(opts.sampleStep) || 4);
  const bits = Math.max(2, Math.min(6, Number(opts.bits) || 4)); // 4 => 16 levels/channel
  const shift = 8 - bits;
  const data = imageData?.data;
  if (!data || !data.length) return [];

  const counts = new Map();
  for (let i = 0; i < data.length; i += 4 * sampleStep) {
    const a = data[i + 3];
    if (a != null && a < 128) continue; // skip transparent
    const r = data[i] >> shift;
    const g = data[i + 1] >> shift;
    const b = data[i + 2] >> shift;
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const out = [];
  const scale = 255 / ((1 << bits) - 1);
  for (const [key] of sorted) {
    if (out.length >= maxColors) break;
    const r = Math.round(((key >> 16) & 0xff) * scale);
    const g = Math.round(((key >> 8) & 0xff) * scale);
    const b = Math.round((key & 0xff) * scale);
    const hex = rgbToHex(r, g, b);
    if (!out.includes(hex)) out.push(hex);
  }
  return out;
}

/**
 * Load a File/Blob into canvas and extract palette.
 * @param {File|Blob} file
 * @param {{ maxColors?: number }} [opts]
 */
export async function extractPaletteFromFile(file, opts = {}) {
  if (!file) throw new Error('Image file required');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const maxEdge = 160;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height, 1));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas unsupported');
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    return extractPaletteFromImageData(imageData, opts);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}

export function paletteToCssVars(colors, prefix = 'swatch') {
  return colors.map((hex, i) => `  --${prefix}-${i + 1}: ${hex};`).join('\n');
}

export function paletteToJson(colors, meta = {}) {
  return JSON.stringify({ colors, ...meta, generatedAt: new Date().toISOString() }, null, 2);
}

export function paletteToSvg(colors, { width = 320, height = 64 } = {}) {
  const n = Math.max(colors.length, 1);
  const cell = width / n;
  const rects = colors.map((hex, i) => (
    `<rect x="${(i * cell).toFixed(2)}" y="0" width="${cell.toFixed(2)}" height="${height}" fill="${hex}"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>\n`;
}

export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
