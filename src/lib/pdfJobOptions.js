/**
 * Pure PDF job option builder + client validation for PdfView.
 * Kept free of React so server structural tests and unit tests can import it.
 * Option keys align with server/src/pdf/operation-options.ts normalizePdfOptions.
 */

/** Optional external-tool ops — listed in UI, disabled when capability is false */
export const GATED_OP_IDS = new Set(['to-images', 'ocr', 'compress-advanced', 'repair']);

/** Ops that may accept an ephemeral PDF password (never persisted by UI) */
export const PASSWORD_CAPABLE_OPS = new Set();

/** Best-effort: does a page spec clearly mean every page of a known document? */
export function isDeleteAllSpec(pagesStr, pageCount) {
  const s = String(pagesStr || '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'all' || s === '*') return true;
  if (pageCount && Number.isFinite(pageCount) && pageCount > 0) {
    if (s === `1-${pageCount}` || s === `1–${pageCount}`) return true;
  }
  return false;
}

/**
 * Default form state after switching operation (prevents stale option leakage).
 */
export function defaultFormStateForOperation(operation) {
  return {
    pages: '',
    angle: '90',
    format: 'png',
    quality: 'balanced',
    dpi: '150',
    splitMode: 'every-page',
    everyN: '2',
    splitGroups: '1-2;3-4',
    ocr: false,
    ocrLang: 'eng',
    pageSize: 'fit-to-image',
    orientation: 'auto',
    fit: 'contain',
    margin: '0',
    allowDuplicates: false,
    insertAt: '',
    password: '',
    editPlan: null,
  };
}

/**
 * @param {object} p
 * @param {string} p.operation
 * @param {File[]|Array} p.files
 * @param {object} p.opMeta
 */
export function validatePdfClient(p) {
  const {
    operation,
    files = [],
    opMeta = {},
    pages = '',
    editPlan = null,
    splitMode = 'every-page',
    splitGroups = '',
    everyN = '2',
  } = p;

  const effectivePages = String(pages || editPlan?.pages || '').trim();
  const effectiveOrder = String(pages || editPlan?.order || '').trim();

  if (!files.length) return 'Choose PDF or image files first';
  const cardinality = opMeta.cardinality || opMeta.contract?.cardinality;
  if (cardinality?.minFiles && files.length < cardinality.minFiles) {
    return `${opMeta.label || operation} requires at least ${cardinality.minFiles} files`;
  }
  if (cardinality?.maxFiles != null && files.length > cardinality.maxFiles) {
    return `${opMeta.label || operation} accepts at most ${cardinality.maxFiles} files`;
  }
  if (opMeta.images) {
    const bad = files.find(
      (f) =>
        f.type &&
        !String(f.type).startsWith('image/') &&
        !/\.(png|jpe?g|webp|tiff?|gif|bmp)$/i.test(f.name || ''),
    );
    if (bad) return 'Images → PDF requires image files';
  } else if (operation !== 'from-images') {
    const bad = files.find((f) => {
      if (f.type === 'application/pdf') return false;
      if (f.name && /\.pdf$/i.test(f.name)) return false;
      if (!f.type) return false;
      return f.type !== 'application/pdf';
    });
    if (bad) return 'This operation requires PDF files';
  }
  if (operation === 'merge' && files.length < 2) {
    return 'Merge requires at least two PDF files (reorder them in the list if needed)';
  }
  if (
    opMeta.needsPages &&
    (operation === 'extract' || operation === 'delete-pages' || operation === 'duplicate-pages')
  ) {
    if (!effectivePages) return 'Page selection is required for this operation';
  }
  if (operation === 'delete-pages' && isDeleteAllSpec(effectivePages, editPlan?.pageCount)) {
    return 'Cannot delete all pages — the result would be an empty PDF';
  }
  if (operation === 'reorder' && !effectiveOrder) {
    return 'Page order is required (e.g. 3,1,2)';
  }
  if (operation === 'split' && splitMode === 'ranges' && !effectivePages) {
    return 'Enter page ranges to split (e.g. 1-3,5)';
  }
  if (operation === 'split' && splitMode === 'groups' && !String(splitGroups).trim()) {
    return 'Enter custom groups (semicolon-separated page specs, e.g. 1-2;3;4-5)';
  }
  if (operation === 'split' && splitMode === 'every-n') {
    const n = Number(everyN);
    if (!Number.isFinite(n) || n < 1) return 'Pages per part (N) must be a positive number';
  }
  return null;
}

/**
 * Build POST /api/jobs options for type=pdf matching server normalizePdfOptions keys.
 * Only operation-relevant keys are included. Password is ephemeral (caller must clear UI state).
 */
export function buildPdfJobOptions(p) {
  const {
    operation,
    pages = '',
    editPlan = null,
    angle = '90',
    format = 'png',
    quality = 'balanced',
    dpi = '150',
    splitMode = 'every-page',
    everyN = '2',
    splitGroups = '',
    ocr = false,
    ocrLang = 'eng',
    pageSize = 'fit-to-image',
    orientation = 'auto',
    fit = 'contain',
    margin = '0',
    allowDuplicates = false,
    insertAt = '',
    password = '',
    opMeta = {},
  } = p;

  const pageSpec = pages || editPlan?.pages || undefined;
  const orderSpec = pages || editPlan?.order || undefined;

  /** @type {Record<string, unknown>} */
  const options = { operation };

  // Page / order fields only when the op uses them
  if (
    operation === 'extract' ||
    operation === 'delete-pages' ||
    operation === 'duplicate-pages' ||
    operation === 'rotate' ||
    operation === 'to-images' ||
    operation === 'ocr' ||
    (operation === 'split' && splitMode === 'ranges')
  ) {
    if (pageSpec) options.pages = pageSpec;
  }
  if (operation === 'reorder') {
    if (orderSpec) {
      options.order = orderSpec;
      options.pages = orderSpec;
    }
    options.allowDuplicates = Boolean(allowDuplicates);
  }

  if (operation === 'rotate') {
    options.angle = Number(angle) || 90;
    if (!options.pages) options.pages = pageSpec || undefined;
  }

  if (operation === 'split') {
    options.splitMode = splitMode;
    if (splitMode === 'every-n') options.everyN = Number(everyN) || 2;
    if (splitMode === 'groups') options.groups = splitGroups;
    if (splitMode === 'ranges' && pageSpec) options.pages = pageSpec;
  }

  if (operation === 'duplicate-pages') {
    if (pageSpec) options.pages = pageSpec;
    if (insertAt !== '' && Number.isFinite(Number(insertAt))) {
      options.insertAt = Number(insertAt);
    }
  }

  if (operation === 'to-images') {
    options.format = format === 'jpg' || format === 'jpeg' ? 'jpeg' : 'png';
    options.quality = quality;
    if (dpi !== '' && Number.isFinite(Number(dpi))) {
      options.dpi = Math.max(36, Math.min(600, Math.round(Number(dpi))));
    }
    if (pageSpec) options.pages = pageSpec;
  }

  if (operation === 'from-images') {
    options.pageSize = pageSize;
    options.orientation = orientation;
    options.fit = fit;
    options.marginPt = Number(margin) || 0;
  }

  if (operation === 'ocr') {
    options.ocr = true;
    options.ocrLang = ocrLang || 'eng';
    if (pageSpec) options.pages = pageSpec;
  }

  if (operation === 'compress-structural') {
    options.compressMode = 'structural';
    options.quality = quality;
  }
  if (operation === 'compress-advanced') {
    options.compressMode = 'advanced';
    options.quality = quality;
  }

  // Ephemeral password — only when non-empty; backend redacts before DB/logs
  if (password && String(password).length > 0 && PASSWORD_CAPABLE_OPS.has(operation)) {
    options.password = String(password);
  }

  // Drop undefined / empty-string junk
  Object.keys(options).forEach((k) => {
    if (options[k] === undefined || options[k] === '') delete options[k];
  });
  return options;
}

/** Format bytes for result cards */
export function formatBytes(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Build human-readable meta lines from a completed job for JobOutputCard.
 * Does not assume every PDF job returns a PDF file.
 */
export function describeJobMeta(job) {
  if (!job || typeof job !== 'object') return [];
  const meta = job.meta && typeof job.meta === 'object' ? job.meta : {};
  const bits = [];
  const mime = job.outputMime || job.mime || meta.mime || null;
  if (mime) bits.push(String(mime));
  if (meta.engine) bits.push(`engine: ${meta.engine}`);
  const pageCount = meta.pageCount ?? meta.pages ?? meta.remainingPages ?? null;
  if (pageCount != null && pageCount !== '') bits.push(`pages: ${pageCount}`);
  if (meta.files != null) bits.push(`files: ${meta.files}`);
  if (meta.splitMode) bits.push(`split: ${meta.splitMode}`);
  if (meta.angle != null) bits.push(`${meta.angle}°`);
  if (meta.charCount != null) bits.push(`chars: ${meta.charCount}`);
  if (meta.ocrStatus) bits.push(`OCR: ${meta.ocrStatus}`);
  if (meta.ocrLang) bits.push(`lang: ${meta.ocrLang}`);
  if (meta.originalSize != null && meta.compressedSize != null) {
    const o = formatBytes(meta.originalSize);
    const c = formatBytes(meta.compressedSize);
    bits.push(`${o} → ${c}`);
    if (meta.reductionPercent != null) bits.push(`${meta.reductionPercent}%`);
    if (meta.reductionBytes != null) bits.push(`Δ ${formatBytes(meta.reductionBytes)}`);
  } else if (meta.originalSize != null) {
    bits.push(`size: ${formatBytes(meta.originalSize)}`);
  }
  if (meta.structuralOnly || meta.compressMode === 'structural') {
    bits.push('structural only');
  }
  if (meta.cacheHit) bits.push('cache hit');
  if (meta.warning) bits.push(String(meta.warning));
  if (Array.isArray(meta.warnings) && meta.warnings.length) {
    bits.push(meta.warnings.slice(0, 2).join('; '));
  }
  return bits;
}
