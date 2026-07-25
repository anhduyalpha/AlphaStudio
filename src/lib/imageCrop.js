/**
 * Map crop rectangle between display CSS pixels and natural image pixels.
 */

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * @param {{ left: number, top: number, width: number, height: number }} rect natural px
 * @param {{ naturalWidth: number, naturalHeight: number }} dims
 */
export function clampCropRect(rect, dims) {
  const nw = Math.max(1, Number(dims.naturalWidth) || 1);
  const nh = Math.max(1, Number(dims.naturalHeight) || 1);
  let width = Math.max(1, Math.round(Number(rect.width) || 1));
  let height = Math.max(1, Math.round(Number(rect.height) || 1));
  width = Math.min(width, nw);
  height = Math.min(height, nh);
  let left = Math.round(Number(rect.left) || 0);
  let top = Math.round(Number(rect.top) || 0);
  left = clamp(left, 0, nw - width);
  top = clamp(top, 0, nh - height);
  return { left, top, width, height };
}

/**
 * Default crop: centered 50% of the image (not top-left).
 */
export function defaultCropRect(dims) {
  const nw = Math.max(1, Number(dims.naturalWidth) || 1);
  const nh = Math.max(1, Number(dims.naturalHeight) || 1);
  const width = Math.max(1, Math.round(nw * 0.5));
  const height = Math.max(1, Math.round(nh * 0.5));
  const left = Math.round((nw - width) / 2);
  const top = Math.round((nh - height) / 2);
  return clampCropRect({ left, top, width, height }, { naturalWidth: nw, naturalHeight: nh });
}

/**
 * Convert client pointer position inside the image element to natural coords.
 * @param {DOMRect} bound displayed image getBoundingClientRect()
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ naturalWidth: number, naturalHeight: number }} dims
 */
export function clientToNatural(bound, clientX, clientY, dims) {
  const nw = Math.max(1, Number(dims.naturalWidth) || 1);
  const nh = Math.max(1, Number(dims.naturalHeight) || 1);
  const bx = bound.width || 1;
  const by = bound.height || 1;
  const x = ((clientX - bound.left) / bx) * nw;
  const y = ((clientY - bound.top) / by) * nh;
  return {
    x: clamp(x, 0, nw),
    y: clamp(y, 0, nh),
  };
}

export function naturalToDisplayPercent(rect, dims) {
  const nw = Math.max(1, Number(dims.naturalWidth) || 1);
  const nh = Math.max(1, Number(dims.naturalHeight) || 1);
  return {
    left: (rect.left / nw) * 100,
    top: (rect.top / nh) * 100,
    width: (rect.width / nw) * 100,
    height: (rect.height / nh) * 100,
  };
}

export function buildCropJobOptions({ operation, format, quality, angle, stripMeta, width, height, crop }) {
  const options = {
    operation,
    format,
    quality: Number(quality) || 80,
    angle: Number(angle) || 90,
    stripMetadata: stripMeta || operation === 'strip-metadata',
  };
  if (operation === 'resize') {
    options.width = width ? Number(width) : undefined;
    options.height = height ? Number(height) : undefined;
  }
  if (operation === 'crop' && crop) {
    options.left = crop.left;
    options.top = crop.top;
    options.width = crop.width;
    options.height = crop.height;
  }
  return options;
}
