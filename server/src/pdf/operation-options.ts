/**
 * Explicit typed option normalization for PDF operations.
 * Avoids scattered Record<string, unknown> access inside op handlers.
 */
import { badRequest } from '../lib/errors.js';
import { resolveQualityPreset, type QualityPreset } from '../convert/quality.js';
import type {
  CompressMode,
  PageFitMode,
  PageOrientation,
  PageSizeMode,
  SplitMode,
} from './types.js';
import { ADVANCED_COMPRESS_PRESETS } from './types.js';

export type NormalizedPdfOptions = {
  operation: string;
  pages?: string;
  order?: string;
  angle: number;
  format: 'png' | 'jpeg';
  quality: QualityPreset;
  dpi?: number;
  ocr: boolean;
  ocrLang: string;
  ocrPageLimit: number;
  /** structural | advanced — also inferred from operation name */
  compressMode: CompressMode;
  splitMode: SplitMode;
  everyN: number;
  /** User-defined groups: array of page specs */
  groups?: string[];
  allowDuplicates: boolean;
  /** Insertion index for duplicate-pages (0-based after conversion); null = after each source */
  insertAt: number | null;
  pageSize: PageSizeMode;
  orientation: PageOrientation;
  fit: PageFitMode;
  marginPt: number;
  password?: string;
  searchablePdf: boolean;
  mime?: string;
  contentType?: string;
};

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

function asBool(v: unknown, defaultValue = false): boolean {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return defaultValue;
}

export function normalizePdfOptions(raw: Record<string, unknown>): NormalizedPdfOptions {
  const operation = String(raw.operation || 'merge').toLowerCase().trim();

  let angle = Number(raw.angle ?? 90);
  if (!Number.isFinite(angle)) angle = 90;
  // Normalize negative angles
  angle = ((Math.round(angle) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(angle)) {
    throw badRequest('Angle must be 0, 90, 180, or 270 degrees');
  }

  const formatRaw = String(raw.format || raw.outputFormat || 'png').toLowerCase();
  const format = formatRaw === 'jpg' || formatRaw === 'jpeg' ? 'jpeg' : 'png';

  const quality = resolveQualityPreset(raw);
  const dpiRaw = raw.dpi != null ? Number(raw.dpi) : undefined;
  const dpi =
    dpiRaw != null && Number.isFinite(dpiRaw)
      ? Math.max(36, Math.min(600, Math.round(dpiRaw)))
      : undefined;

  let compressMode: CompressMode = 'structural';
  if (
    operation === 'compress-advanced' ||
    String(raw.compressMode || raw.mode || '').toLowerCase() === 'advanced'
  ) {
    compressMode = 'advanced';
  } else if (
    operation === 'compress-structural' ||
    String(raw.compressMode || raw.mode || '').toLowerCase() === 'structural'
  ) {
    compressMode = 'structural';
  }

  const splitModeRaw = String(raw.splitMode || raw.mode || 'every-page').toLowerCase();
  let splitMode: SplitMode = 'every-page';
  if (splitModeRaw === 'ranges' || splitModeRaw === 'range') splitMode = 'ranges';
  else if (splitModeRaw === 'every-n' || splitModeRaw === 'everyn' || splitModeRaw === 'chunk')
    splitMode = 'every-n';
  else if (splitModeRaw === 'groups' || splitModeRaw === 'group') splitMode = 'groups';
  else if (splitModeRaw === 'every-page' || splitModeRaw === 'pages' || splitModeRaw === 'all')
    splitMode = 'every-page';

  // If pages provided without explicit mode, prefer ranges for split
  if (operation === 'split' && asString(raw.pages) && !raw.splitMode && !raw.mode) {
    splitMode = 'ranges';
  }

  const everyN = Math.max(1, Math.min(500, Math.round(Number(raw.everyN || raw.n || 1)) || 1));

  let groups: string[] | undefined;
  if (Array.isArray(raw.groups)) {
    groups = raw.groups.map((g) => String(g));
  } else if (typeof raw.groups === 'string' && raw.groups.trim()) {
    // semicolon-separated group specs
    groups = raw.groups.split(';').map((g) => g.trim()).filter(Boolean);
  }

  const insertRaw = raw.insertAt ?? raw.insertPosition;
  let insertAt: number | null = null;
  if (insertRaw != null && insertRaw !== '') {
    const n = Number(insertRaw);
    if (Number.isFinite(n) && n >= 0) insertAt = Math.floor(n);
  }

  const pageSizeRaw = String(raw.pageSize || raw.pageMode || 'fit-to-image').toLowerCase();
  let pageSize: PageSizeMode = 'fit-to-image';
  if (pageSizeRaw === 'a4') pageSize = 'a4';
  else if (pageSizeRaw === 'letter') pageSize = 'letter';
  else if (pageSizeRaw === 'original' || pageSizeRaw === 'original-image-size') pageSize = 'original';
  else pageSize = 'fit-to-image';

  const orientRaw = String(raw.orientation || 'auto').toLowerCase();
  let orientation: PageOrientation = 'auto';
  if (orientRaw === 'portrait') orientation = 'portrait';
  else if (orientRaw === 'landscape') orientation = 'landscape';

  const fitRaw = String(raw.fit || raw.fitMode || 'contain').toLowerCase();
  let fit: PageFitMode = 'contain';
  if (fitRaw === 'cover') fit = 'cover';
  else if (fitRaw === 'stretch' || fitRaw === 'fill') fit = 'stretch';

  const marginPt = Math.max(
    0,
    Math.min(144, Number(raw.margin ?? raw.marginPt ?? 0) || 0),
  );

  const password = asString(raw.password) || asString(raw.userPassword) || undefined;

  const ocrPageLimit = Math.max(
    1,
    Math.min(200, Math.round(Number(raw.ocrPageLimit || raw.maxOcrPages || 50)) || 50),
  );

  return {
    operation,
    pages: asString(raw.pages),
    order: asString(raw.order) || asString(raw.pages),
    angle,
    format,
    quality,
    dpi,
    ocr: asBool(raw.ocr) || asBool(raw.useOcr) || asBool(raw.enableOcr),
    ocrLang: asString(raw.ocrLang) || asString(raw.lang) || 'eng',
    ocrPageLimit,
    compressMode,
    splitMode,
    everyN,
    groups,
    allowDuplicates: asBool(raw.allowDuplicates) || asBool(raw.allowDuplicatePages),
    insertAt,
    pageSize,
    orientation,
    fit,
    marginPt,
    password,
    searchablePdf: asBool(raw.searchablePdf) || asBool(raw.searchable),
    mime: asString(raw.mime),
    contentType: asString(raw.contentType),
  };
}

export function advancedCompressSettings(preset: QualityPreset) {
  return ADVANCED_COMPRESS_PRESETS[preset] || ADVANCED_COMPRESS_PRESETS.balanced;
}

/** Keys that must never be persisted to DB / logs / result metadata */
export const SENSITIVE_OPTION_KEYS = [
  'password',
  'userPassword',
  'ownerPassword',
  'pdfPassword',
  'pass',
] as const;

export function redactSensitiveOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...options };
  let redacted = false;
  for (const key of SENSITIVE_OPTION_KEYS) {
    if (key in out) {
      delete out[key];
      redacted = true;
    }
  }
  if (redacted) out.passwordProvided = true;
  return out;
}

export function extractPassword(options: Record<string, unknown>): string | undefined {
  for (const key of SENSITIVE_OPTION_KEYS) {
    const v = options[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
