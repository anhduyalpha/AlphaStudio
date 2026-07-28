/**
 * Pure PDF job option builder + client validation for PdfView.
 * Kept free of React so server structural tests and unit tests can import it.
 * Option keys align with server/src/pdf/operation-options.ts normalizePdfOptions.
 */
import { formatBytes } from './formatBytes.js';

export { formatBytes } from './formatBytes.js';

/** Optional external-tool ops — listed in UI, disabled when capability is false */
export const GATED_OP_IDS = new Set(['to-images', 'ocr', 'compress-advanced', 'repair']);

/** Ops that may accept an ephemeral PDF password (never persisted by UI) */
export const PASSWORD_CAPABLE_OPS = new Set();

/**
 * Presentation metadata only. The server remains authoritative for which
 * operations exist, their capability ids, cardinality, option keys, output
 * kinds, and engine policy. Entries absent from the published contract are
 * never rendered.
 */
export const PDF_OPERATION_PRESENTATION = Object.freeze({
  merge: { label: 'Merge PDFs', group: 'organize', groupLabel: 'Organize' },
  split: { label: 'Split PDF', group: 'organize', groupLabel: 'Organize' },
  reorder: { label: 'Reorder pages', group: 'organize', groupLabel: 'Organize' },
  rotate: { label: 'Rotate pages', group: 'organize', groupLabel: 'Organize' },
  extract: { label: 'Extract pages', group: 'organize', groupLabel: 'Organize' },
  'delete-pages': { label: 'Delete pages', group: 'organize', groupLabel: 'Organize' },
  'duplicate-pages': { label: 'Duplicate pages', group: 'organize', groupLabel: 'Organize' },
  'from-images': { label: 'Images to PDF', group: 'convert', groupLabel: 'Convert' },
  'to-images': { label: 'PDF to images', group: 'convert', groupLabel: 'Convert' },
  'to-text': { label: 'PDF to text', group: 'convert', groupLabel: 'Convert' },
  'compress-structural': {
    label: 'Structural optimization',
    group: 'optimize',
    groupLabel: 'Optimize',
  },
  'compress-advanced': {
    label: 'Advanced compression',
    group: 'optimize',
    groupLabel: 'Optimize',
  },
  repair: { label: 'Repair PDF', group: 'optimize', groupLabel: 'Optimize' },
  inspect: { label: 'Inspect document', group: 'analyze', groupLabel: 'Analyze' },
  ocr: { label: 'Extract text with OCR', group: 'analyze', groupLabel: 'Analyze' },
});

export const SUPPORTED_PDF_OPTION_KEYS = Object.freeze(new Set([
  'splitMode',
  'pages',
  'everyN',
  'groups',
  'order',
  'allowDuplicates',
  'angle',
  'insertAt',
  'quality',
  'format',
  'dpi',
  'pageSize',
  'orientation',
  'fit',
  'marginPt',
  'ocrLang',
  'ocrPageLimit',
]));

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse the backend-published PDF operation contract and attach presentation
 * labels. A malformed or unpublished section returns an empty list so the UI
 * fails closed instead of reviving the old client-side operation catalog.
 */
export function publishedPdfOperations(capabilities) {
  const raw = isRecord(capabilities) && isRecord(capabilities.pdf)
    ? capabilities.pdf.operations
    : null;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.capability !== 'string'
      || !isRecord(entry.cardinality)
      || !Array.isArray(entry.options)
      || !entry.options.every((key) => typeof key === 'string')
      || !Array.isArray(entry.outputKinds)
      || !entry.outputKinds.every((kind) => typeof kind === 'string')
      || !isRecord(entry.enginePolicy)
      || !Array.isArray(entry.enginePolicy.engines)
    ) {
      return [];
    }
    const presentation = PDF_OPERATION_PRESENTATION[entry.id];
    if (!presentation) return [];
    const minFiles = Number(entry.cardinality.minFiles);
    const maxFiles = entry.cardinality.maxFiles == null
      ? null
      : Number(entry.cardinality.maxFiles);
    if (
      !Number.isFinite(minFiles)
      || minFiles < 0
      || (maxFiles !== null && (!Number.isFinite(maxFiles) || maxFiles < minFiles))
    ) {
      return [];
    }
    return [{
      id: entry.id,
      capability: entry.capability,
      cardinality: { minFiles, maxFiles },
      options: [...entry.options],
      outputKinds: [...entry.outputKinds],
      enginePolicy: {
        strategy: typeof entry.enginePolicy.strategy === 'string'
          ? entry.enginePolicy.strategy
          : '',
        engines: entry.enginePolicy.engines.map(String),
        fallback: typeof entry.enginePolicy.fallback === 'string'
          ? entry.enginePolicy.fallback
          : '',
      },
      ...presentation,
    }];
  });
}

export function unsupportedPdfOptionKeys(operation) {
  return (operation?.options || []).filter((key) => !SUPPORTED_PDF_OPTION_KEYS.has(key));
}

export function pdfOperationEngineLabel(operation) {
  const engines = operation?.enginePolicy?.engines;
  return Array.isArray(engines) && engines.length ? engines.join(' or ') : 'Engine not published';
}

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
    ocrPageLimit: '50',
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
    operation === 'extract'
    || operation === 'delete-pages'
    || operation === 'duplicate-pages'
  ) {
    if (!effectivePages) return 'Page selection is required for this operation';
  }
  if (operation === 'delete-pages' && isDeleteAllSpec(effectivePages, editPlan?.pageCount)) {
    return 'Cannot delete all pages - the result would be an empty PDF';
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
    ocrPageLimit = '50',
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
    options.ocrPageLimit = Math.max(
      1,
      Math.min(200, Math.round(Number(ocrPageLimit)) || 50),
    );
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

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

/**
 * Build one immutable PDF job attempt. Upload order is intentionally retained
 * in options so retrying merge/from-images preserves the submitted order.
 */
export function buildPdfJobRequest({
  workspaceId,
  uploadIds = [],
  clientRequestId,
  operation,
  form = {},
  opMeta = {},
}) {
  const workspace = requiredText(workspaceId, 'Workspace');
  const requestId = requiredText(clientRequestId, 'Client request id');
  const ids = [...new Set(uploadIds.map(String).filter(Boolean))];
  if (!ids.length) throw new Error('At least one PDF input is required');
  const options = {
    ...buildPdfJobOptions({ ...form, operation, opMeta }),
    _uploadIds: ids,
  };
  return {
    type: 'pdf',
    workspaceId: workspace,
    uploadIds: ids,
    clientRequestId: requestId,
    options,
  };
}

export function buildPdfRetryRequest({ workspaceId, job, clientRequestId }) {
  if (!job || job.type !== 'pdf' || job.status !== 'failed') {
    throw new Error('Only a failed PDF job can be retried');
  }
  const uploadIds = job.options?._uploadIds || job.options?.uploadIds || [];
  return buildPdfJobRequest({
    workspaceId,
    uploadIds,
    clientRequestId,
    operation: job.options?.operation,
    form: job.options,
  });
}

function extensionOf(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

/**
 * Join persisted PDF jobs with workspace outputs for the canonical Results
 * rail. Jobs without an output remain visible for progress and recovery.
 */
export function buildPdfResultRows({ jobs = [], outputs = [], files = [] } = {}) {
  const fileNames = new Map(files.map((file) => [
    String(file.id),
    file.originalName || file.name || String(file.id),
  ]));
  const pdfJobs = jobs.filter((job) => job?.type === 'pdf');
  const jobsById = new Map(pdfJobs.map((job) => [String(job.id), job]));
  const outputRows = outputs.flatMap((output) => {
    const job = jobsById.get(String(output.jobId || ''));
    if (!job) return [];
    const sourceNames = (job.options?._uploadIds || [])
      .map((id) => fileNames.get(String(id)))
      .filter(Boolean);
    const operation = PDF_OPERATION_PRESENTATION[job.options?.operation];
    return [{
      ...output,
      id: String(output.id),
      outputId: String(output.id),
      jobId: String(job.id),
      name: output.name || job.outputName || 'PDF output',
      outputName: output.name || job.outputName || 'PDF output',
      outputFormat: extensionOf(output.name) || extensionOf(job.outputName),
      sourceLabel: sourceNames.join(', ') || operation?.label || 'PDF operation',
      status: job.status === 'completed' ? 'completed' : job.status,
      progress: job.progress,
      options: job.options,
      createdAt: output.createdAt || job.createdAt,
      downloadUrl: output.downloadUrl || job.downloadUrl,
      meta: job.meta,
      detail: describeJobMeta(job).join(' | '),
    }];
  });
  const jobsWithOutputs = new Set(outputRows.map((row) => row.jobId));
  const jobRows = pdfJobs
    .filter((job) => !jobsWithOutputs.has(String(job.id)))
    .map((job) => {
      const sourceNames = (job.options?._uploadIds || [])
        .map((id) => fileNames.get(String(id)))
        .filter(Boolean);
      const operation = PDF_OPERATION_PRESENTATION[job.options?.operation];
      return {
        ...job,
        id: String(job.id),
        jobId: String(job.id),
        name: job.outputName || operation?.label || 'PDF operation',
        outputFormat: extensionOf(job.outputName),
        sourceLabel: sourceNames.join(', ') || operation?.label || 'PDF operation',
        detail: describeJobMeta(job).join(' | '),
      };
    });
  return [...outputRows, ...jobRows].sort((a, b) => (
    Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
  ));
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
