import { resolveAllTools, type ToolEntry } from '../tools/registry.js';
import {
  hasOcrStack,
  hasPdfRasterizer,
  resolveOptionalBinary,
} from '../tools/optional-binaries.js';

export type Family =
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'ebook'
  | 'text'
  | 'pdf'
  | 'unknown';

export type OutputOption = {
  format: string;
  label: string;
  available: boolean;
  reason?: string;
  requires?: string[];
};

export type DetectedKind = {
  family: Family;
  format: string; // normalized e.g. png, docx, mp3
  ext: string; // .png
  mime: string;
};

/** Base conversion graph: input format → candidate outputs (before capability filter) */
const GRAPH: Record<string, string[]> = {
  // images
  png: ['jpeg', 'jpg', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'pdf', 'ico'],
  jpg: ['png', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'pdf', 'ico'],
  jpeg: ['png', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'pdf', 'ico'],
  webp: ['png', 'jpeg', 'jpg', 'avif', 'gif', 'tiff', 'bmp', 'pdf'],
  avif: ['png', 'jpeg', 'webp', 'gif', 'tiff', 'pdf'],
  gif: ['png', 'jpeg', 'webp', 'mp4', 'pdf'],
  tiff: ['png', 'jpeg', 'webp', 'pdf'],
  tif: ['png', 'jpeg', 'webp', 'pdf'],
  bmp: ['png', 'jpeg', 'webp', 'pdf'],
  ico: ['png', 'jpeg', 'webp'],
  svg: ['png', 'jpeg', 'webp', 'pdf'],
  heic: ['png', 'jpeg', 'webp', 'pdf'],
  heif: ['png', 'jpeg', 'webp', 'pdf'],
  // audio
  mp3: ['wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'],
  wav: ['mp3', 'flac', 'aac', 'm4a', 'ogg', 'opus'],
  flac: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus'],
  aac: ['mp3', 'wav', 'flac', 'm4a', 'ogg'],
  m4a: ['mp3', 'wav', 'flac', 'aac', 'ogg'],
  ogg: ['mp3', 'wav', 'flac', 'aac', 'm4a'],
  opus: ['mp3', 'wav', 'ogg', 'm4a'],
  wma: ['mp3', 'wav', 'flac', 'm4a'],
  // video
  mp4: ['webm', 'mkv', 'mov', 'avi', 'gif', 'mp3', 'wav', 'aac', 'm4a'],
  mkv: ['mp4', 'webm', 'mov', 'avi', 'gif', 'mp3', 'wav', 'm4a'],
  webm: ['mp4', 'mkv', 'gif', 'mp3', 'wav', 'ogg'],
  mov: ['mp4', 'webm', 'mkv', 'gif', 'mp3', 'wav', 'm4a'],
  avi: ['mp4', 'webm', 'mkv', 'gif', 'mp3', 'wav'],
  mpeg: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  mpg: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  wmv: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  m4v: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  flv: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  // documents / office
  doc: ['pdf', 'docx', 'odt', 'txt', 'html', 'rtf'],
  docx: ['pdf', 'odt', 'txt', 'html', 'rtf', 'doc'],
  odt: ['pdf', 'docx', 'txt', 'html', 'rtf'],
  rtf: ['pdf', 'docx', 'odt', 'txt', 'html'],
  // spreadsheets
  xls: ['xlsx', 'ods', 'csv', 'pdf'],
  xlsx: ['ods', 'csv', 'pdf', 'xls'],
  ods: ['xlsx', 'csv', 'pdf'],
  csv: ['xlsx', 'ods', 'tsv', 'pdf', 'txt'],
  tsv: ['csv', 'xlsx', 'ods', 'txt'],
  // presentations
  ppt: ['pdf', 'pptx', 'odp', 'png', 'jpeg'],
  pptx: ['pdf', 'odp', 'png', 'jpeg', 'ppt'],
  odp: ['pdf', 'pptx', 'png', 'jpeg'],
  // pdf
  pdf: ['png', 'jpeg', 'txt', 'docx'],
  // text / ebook
  txt: ['pdf', 'html', 'md', 'docx'],
  md: ['pdf', 'html', 'txt', 'docx'],
  html: ['pdf', 'txt', 'md', 'docx'],
  htm: ['pdf', 'txt', 'md', 'docx'],
  epub: ['pdf', 'txt', 'html'],
  // archives
  zip: ['tar', 'gz', '7z'],
  tar: ['zip', 'gz', '7z'],
  gz: ['zip', 'tar'],
  tgz: ['zip', 'tar'],
  bz2: ['zip', 'tar'],
  xz: ['zip', 'tar'],
  '7z': ['zip', 'tar'],
};

const DEFAULTS: Record<Family, string> = {
  image: 'webp',
  audio: 'mp3',
  video: 'mp4',
  document: 'pdf',
  spreadsheet: 'csv',
  presentation: 'pdf',
  archive: 'zip',
  ebook: 'pdf',
  text: 'pdf',
  pdf: 'png',
  unknown: 'zip',
};

function toolForOutput(inputFormat: string, output: string, family: Family): string[] {
  const img = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'tiff', 'tif', 'bmp', 'ico', 'svg', 'heic', 'heif']);
  const aud = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma']);
  const vid = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'mpeg', 'mpg', 'wmv', 'm4v', 'flv', 'gif']);
  const office = new Set(['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']);
  const arch = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z']);

  if (family === 'image' || img.has(inputFormat)) {
    if (output === 'pdf') return ['sharp', 'pdf-lib'];
    if (vid.has(output)) return ['ffmpeg'];
    return ['sharp'];
  }
  if (family === 'audio' || (aud.has(inputFormat) && !vid.has(inputFormat))) {
    return ['ffmpeg', 'ffprobe'];
  }
  if (family === 'video' || vid.has(inputFormat)) {
    return ['ffmpeg', 'ffprobe'];
  }
  if (family === 'archive' || arch.has(inputFormat)) {
    // Pure-JS extract: zip, tar, gz, tgz. bz2/xz/7z need 7-Zip.
    // Pure-JS create: zip, tar, gz. 7z create needs 7-Zip.
    if (['bz2', 'xz', '7z'].includes(inputFormat) || output === '7z') return ['7z'];
    return [];
  }
  // Pure spreadsheet text conversions need no LO
  if (
    family === 'spreadsheet' &&
    ['csv', 'tsv'].includes(inputFormat) &&
    ['csv', 'tsv', 'txt'].includes(output)
  ) {
    return [];
  }
  if (
    family === 'document' ||
    family === 'spreadsheet' ||
    family === 'presentation' ||
    office.has(inputFormat)
  ) {
    return ['libreoffice'];
  }
  // PDF family: NEVER route through LibreOffice for convert pairs.
  // Text → pdftotext/mutool/native; images → rasterizer; docx → unsupported here.
  if (family === 'pdf' || inputFormat === 'pdf') {
    if (['png', 'jpeg', 'jpg'].includes(output)) return ['pdf-rasterizer'];
    if (output === 'txt') return ['pdf-text'];
    if (output === 'docx') return ['pdf-docx-unsupported'];
    return ['pdf-lib'];
  }
  if (family === 'ebook' || inputFormat === 'epub') {
    // Runtime v3.6 sends every EPUB target through the LibreOffice fallback.
    return ['libreoffice'];
  }
  if (family === 'text' || ['txt', 'md', 'html', 'htm'].includes(inputFormat)) {
    if (output === 'pdf') return []; // pure text→pdf via pdf-lib
    if (['txt', 'md', 'html'].includes(output)) return [];
    // DOCX and any future non-native text targets use the runtime LO fallback.
    return ['libreoffice'];
  }
  return [];
}

function labelFor(fmt: string): string {
  return fmt.toUpperCase();
}

/** Cached tool capabilities — resolveAllTools probes binaries; avoid that every detect call */
let toolsSnapshotCache: { at: number; tools: Record<string, ToolEntry> } | null = null;
const TOOLS_SNAPSHOT_TTL_MS = 60_000;

/**
 * Snapshot of tool availability for conversion matrix / detect outputs.
 * Cached in memory; pass force=true after setup/repair to re-resolve.
 */
export function getToolsSnapshot(force = false): Record<string, ToolEntry> {
  const now = Date.now();
  if (
    !force &&
    toolsSnapshotCache &&
    now - toolsSnapshotCache.at < TOOLS_SNAPSHOT_TTL_MS
  ) {
    return toolsSnapshotCache.tools;
  }
  // Shallow-copy so each re-resolve yields a new snapshot reference after invalidate
  const tools = { ...resolveAllTools() };
  toolsSnapshotCache = { at: now, tools };
  return tools;
}

/** Drop cached capabilities (e.g. after npm run setup:tools / repair:tools) */
export function invalidateToolsSnapshot(): void {
  toolsSnapshotCache = null;
}

export function listOutputsFor(
  kind: DetectedKind,
  tools?: Record<string, ToolEntry>,
): OutputOption[] {
  const t = tools || getToolsSnapshot();
  const candidates = GRAPH[kind.format] || GRAPH[kind.ext.replace('.', '')] || [];
  const seen = new Set<string>();
  const options: OutputOption[] = [];

  for (const raw of candidates) {
    const format = raw === 'jpg' ? 'jpeg' : raw;
    if (seen.has(format)) continue;
    seen.add(format);
    const requires = toolForOutput(kind.format, format, kind.family);
    const missing = requires.filter((r) => {
      if (r === 'sharp' || r === 'pdf-lib') return false;
      // Virtual PDF engines — resolved via optional binaries / always-native fallback
      if (r === 'pdf-text') return false; // native always available
      if (r === 'pdf-rasterizer') return !hasPdfRasterizer();
      if (r === 'pdf-docx-unsupported') return true; // always "missing" → unavailable
      return !t[r]?.available;
    });
    // Special cases always available via pure JS
    const pureJs =
      (kind.family === 'image' && ['png', 'jpeg', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'ico'].includes(format) && t.sharp?.available !== false) ||
      (kind.family === 'image' && format === 'pdf') ||
      (['zip', 'tar', 'gz'].includes(format) && kind.family === 'archive') ||
      (kind.family === 'text' && ['txt', 'md', 'html', 'pdf'].includes(format)) ||
      (kind.family === 'spreadsheet' &&
        ['csv', 'tsv'].includes(kind.format) &&
        ['csv', 'tsv', 'txt'].includes(format));

    let available = missing.length === 0;
    let reason: string | undefined;

    if (kind.family === 'image' && ['heic', 'heif'].includes(kind.format)) {
      // sharp may or may not have heif
      available = t.sharp?.available === true;
      if (!available) reason = 'HEIC/HEIF requires libvips with HEIF support';
    }

    if (format === '7z' && !t['7z']?.available) {
      available = false;
      reason = '7z binary not found. Run npm run setup:tools or install 7-Zip.';
    }

    if (['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp'].includes(kind.format)) {
      if (!t.libreoffice?.available) {
        available = false;
        reason = 'LibreOffice (soffice) not found. Run npm run setup:tools or install LibreOffice.';
      }
    }

    // csv/tsv pure pairs stay available without LO even when other sheet targets need LO
    if (
      kind.family === 'spreadsheet' &&
      ['csv', 'tsv'].includes(kind.format) &&
      ['csv', 'tsv', 'txt'].includes(format)
    ) {
      available = true;
      reason = undefined;
    } else if (kind.family === 'spreadsheet' && ['csv', 'tsv'].includes(kind.format) && !t.libreoffice?.available) {
      // pdf/xlsx etc. need LO
      if (!['csv', 'tsv', 'txt'].includes(format)) {
        available = false;
        reason = 'LibreOffice (soffice) not found. Run npm run setup:tools or install LibreOffice.';
      }
    }

    if (kind.family === 'audio' || kind.family === 'video') {
      if (!t.ffmpeg?.available || !t.ffprobe?.available) {
        available = false;
        reason = 'ffmpeg/ffprobe not found. Run npm run setup:tools.';
      }
    }

    // PDF outputs: capability-gate with PDF engines only (never LibreOffice)
    if (kind.format === 'pdf' || kind.family === 'pdf') {
      if (format === 'txt') {
        available = true;
        reason = undefined;
        // Note: scanned PDFs need OCR at runtime when explicitly enabled
      } else if (['png', 'jpeg', 'jpg'].includes(format)) {
        available = hasPdfRasterizer();
        if (!available) {
          reason =
            'PDF to images needs a rasterizer (pdftoppm, mutool, or Ghostscript). LibreOffice is not used for PDF input.';
        }
      } else if (format === 'docx') {
        available = false;
        reason =
          'Unsupported conversion: PDF → DOCX is not offered (use PDF → TXT or an external tool).';
      }
    }

    if (kind.format === 'epub' && !t.libreoffice?.available) {
      available = false;
      reason = 'EPUB conversion needs LibreOffice.';
    }

    // pure JS image/text overrides
    if (pureJs && kind.family === 'image' && format !== 'heic') {
      available = true;
      reason = undefined;
    }
    if (kind.family === 'text' && ['txt', 'md', 'html', 'pdf'].includes(format) && kind.format !== 'epub') {
      available = true;
      reason = undefined;
    }
    // Archive: only force available when BOTH extract and create are pure-JS capable.
    // Never advertise zip/tar for bz2/xz/tgz unless extract is actually implemented.
    if (kind.family === 'archive') {
      const pureExtract = ['zip', 'tar', 'gz', 'gzip', 'tgz'].includes(kind.format);
      const pureCreate = ['zip', 'tar', 'gz'].includes(format);
      if (pureExtract && pureCreate) {
        available = true;
        reason = undefined;
      } else if (['bz2', 'xz', '7z'].includes(kind.format) || format === '7z') {
        available = Boolean(t['7z']?.available);
        if (!available) {
          reason = '7z binary required for this archive format. Run npm run setup:tools or install 7-Zip.';
        }
      } else {
        // e.g. unknown archive pair
        available = missing.length === 0;
      }
    }

    // never list same format as only "convert" unless recompress — still allow for media re-encode
    options.push({
      format,
      label: labelFor(format),
      available,
      reason,
      requires: requires.length ? requires : undefined,
    });
  }

  return options;
}

export function recommendedOutput(kind: DetectedKind, options: OutputOption[]): string | null {
  const pref = DEFAULTS[kind.family];
  const hit = options.find((o) => o.available && (o.format === pref || o.format === 'jpeg' && pref === 'jpg'));
  if (hit) return hit.format;
  const first = options.find((o) => o.available);
  return first?.format || null;
}

export function intersectOutputs(lists: OutputOption[][]): {
  outputs: OutputOption[];
  conflict?: string;
} {
  if (!lists.length) return { outputs: [], conflict: 'No files' };
  if (lists.length === 1) return { outputs: lists[0] };

  const availSets = lists.map(
    (list) => new Set(list.filter((o) => o.available).map((o) => o.format)),
  );
  let inter = [...availSets[0]];
  for (let i = 1; i < availSets.length; i++) {
    inter = inter.filter((f) => availSets[i].has(f));
  }
  if (!inter.length) {
    return {
      outputs: [],
      conflict:
        'Selected files share no common convertible output format. Convert them separately or pick a single family.',
    };
  }
  // merge availability meta from first list
  const byFmt = new Map(lists[0].map((o) => [o.format, o]));
  return {
    outputs: inter.map((f) => byFmt.get(f) || { format: f, label: f.toUpperCase(), available: true }),
  };
}

/** Normalize format tokens for comparison (jpg↔jpeg). */
export function normalizeFormatToken(fmt: string): string {
  const f = String(fmt || '')
    .toLowerCase()
    .replace(/^\./, '');
  if (f === 'jpeg') return 'jpg';
  return f;
}

/** True when input/output formats are identical after normalization. */
export function isSameFormat(inputFormat: string, outputFormat: string): boolean {
  const a = normalizeFormatToken(inputFormat);
  const b = normalizeFormatToken(outputFormat);
  return Boolean(a && b && a === b);
}

/**
 * Families that must never route same-format jobs through LibreOffice.
 * PDF same-format may use safe copy / pdf-lib compress when explicitly selected elsewhere.
 */
export function sameFormatBlockedForLibreOffice(family: string, inputFormat: string): boolean {
  if (family === 'pdf' || normalizeFormatToken(inputFormat) === 'pdf') return true;
  return ['document', 'spreadsheet', 'presentation'].includes(family);
}

/**
 * Capability matrix entry for routing decisions (tests + converter).
 * engine never is 'libreoffice' when input is PDF for forbidden ops.
 */
export type RouteDecision = {
  engine:
    | 'pdf-text'
    | 'pdf-rasterizer'
    | 'pdf-lib'
    | 'sharp+pdf-lib'
    | 'libreoffice'
    | 'ffmpeg'
    | 'pandoc'
    | 'pure'
    | 'unsupported';
  requires: string[];
  libreOfficeAllowed: boolean;
  reason?: string;
};

/**
 * Strict routing for convert pairs. PDF input never returns libreoffice.
 */
export function routeConversion(
  kind: DetectedKind,
  outputFormat: string,
  operation?: string,
): RouteDecision {
  const fmt = outputFormat === 'jpg' ? 'jpeg' : outputFormat.toLowerCase();
  const op = (operation || 'convert').toLowerCase();

  // PDF Studio operations
  if (kind.family === 'pdf' || kind.format === 'pdf') {
    if (['merge', 'split', 'rotate', 'reorder', 'extract', 'compress'].includes(op)) {
      return { engine: 'pdf-lib', requires: ['pdf-lib'], libreOfficeAllowed: false };
    }
    if (op === 'from-images') {
      return { engine: 'sharp+pdf-lib', requires: ['sharp', 'pdf-lib'], libreOfficeAllowed: false };
    }
    if (op === 'to-images' || ['png', 'jpeg'].includes(fmt)) {
      return {
        engine: hasPdfRasterizer() ? 'pdf-rasterizer' : 'unsupported',
        requires: ['pdf-rasterizer'],
        libreOfficeAllowed: false,
        reason: hasPdfRasterizer()
          ? undefined
          : 'PDF to images needs pdftoppm, mutool, or Ghostscript',
      };
    }
    if (fmt === 'txt' || op === 'to-text' || op === 'extract-text') {
      return {
        engine: 'pdf-text',
        requires: ['pdf-text'],
        libreOfficeAllowed: false,
      };
    }
    if (fmt === 'docx') {
      return {
        engine: 'unsupported',
        requires: [],
        libreOfficeAllowed: false,
        reason: 'Unsupported conversion: PDF → DOCX',
      };
    }
    if (isSameFormat(kind.format, fmt)) {
      return {
        engine: 'unsupported',
        requires: [],
        libreOfficeAllowed: false,
        reason: 'PDF → PDF is not a convert pair (use compress)',
      };
    }
    return {
      engine: 'unsupported',
      requires: [],
      libreOfficeAllowed: false,
      reason: `Unsupported conversion: pdf → ${fmt}`,
    };
  }

  if (kind.family === 'image' && fmt === 'pdf') {
    return { engine: 'sharp+pdf-lib', requires: ['sharp', 'pdf-lib'], libreOfficeAllowed: false };
  }

  if (['document', 'spreadsheet', 'presentation'].includes(kind.family)) {
    if (isSameFormat(kind.format, fmt)) {
      return {
        engine: 'unsupported',
        requires: [],
        libreOfficeAllowed: false,
        reason: 'Same-format office conversion is a no-op',
      };
    }
    return { engine: 'libreoffice', requires: ['libreoffice'], libreOfficeAllowed: true };
  }

  const requires = toolForOutput(kind.format, fmt, kind.family);
  if (requires.includes('libreoffice')) {
    return { engine: 'libreoffice', requires, libreOfficeAllowed: true };
  }
  if (requires.includes('ffmpeg')) {
    return { engine: 'ffmpeg', requires, libreOfficeAllowed: false };
  }
  if (requires.includes('pandoc')) {
    return { engine: 'pandoc', requires, libreOfficeAllowed: false };
  }
  if (requires.length === 0) {
    return { engine: 'pure', requires: [], libreOfficeAllowed: false };
  }
  return { engine: 'pure', requires, libreOfficeAllowed: false };
}

/** True when this convert pair must never invoke LibreOffice. */
export function isLibreOfficeForbidden(
  kind: DetectedKind,
  outputFormat: string,
  operation?: string,
): boolean {
  return !routeConversion(kind, outputFormat, operation).libreOfficeAllowed;
}

export function assertPairAllowed(kind: DetectedKind, outputFormat: string): void {
  const opts = listOutputsFor(kind);
  const fmt = outputFormat === 'jpg' ? 'jpeg' : outputFormat.toLowerCase();

  // Defense: PDF must never be asserted as LO-routable
  if ((kind.family === 'pdf' || kind.format === 'pdf') && routeConversion(kind, fmt).libreOfficeAllowed) {
    const err = new Error('Internal routing error: PDF must not use LibreOffice') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 500;
    err.code = 'INTERNAL_ERROR';
    err.name = 'AppError';
    throw err;
  }

  // Identical document/PDF formats are never a LibreOffice convert target
  if (
    isSameFormat(kind.format, fmt) &&
    sameFormatBlockedForLibreOffice(kind.family, kind.format)
  ) {
    // PDF→PDF is not offered as convert; reject as unsupported no-op (use compress job)
    if (kind.family === 'pdf' || kind.format === 'pdf') {
      const err = new Error(
        `Unsupported conversion: pdf → pdf (use PDF compress/optimize or a different format)`,
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      err.name = 'AppError';
      throw err;
    }
    const err = new Error(
      `Same-format conversion ${kind.format} → ${fmt} is not supported (no-op)`,
    ) as Error & { statusCode: number; code: string };
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    err.name = 'AppError';
    throw err;
  }

  const hit = opts.find((o) => o.format === fmt);
  if (!hit) {
    const err = new Error(`Unsupported conversion: ${kind.format} → ${fmt}`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    err.name = 'AppError';
    throw err;
  }
  if (!hit.available) {
    const err = new Error(hit.reason || `Output ${fmt} is unavailable`) as Error & {
      statusCode: number;
      code: string;
      details: unknown;
    };
    err.statusCode = 503;
    err.code = 'UNAVAILABLE';
    err.details = { tool: fmt };
    err.name = 'AppError';
    throw err;
  }
}

/** Capability snapshot for PDF-specific optional engines (for UI / tests). */
export function pdfEngineCapabilities(): {
  text: string;
  rasterizer: boolean;
  ocr: boolean;
  pdftotext: boolean;
  mutool: boolean;
  tesseract: boolean;
} {
  return {
    text: resolveOptionalBinary('pdftotext').available
      ? 'pdftotext'
      : resolveOptionalBinary('mutool').available
        ? 'mutool'
        : 'native',
    rasterizer: hasPdfRasterizer(),
    ocr: hasOcrStack(),
    pdftotext: resolveOptionalBinary('pdftotext').available,
    mutool: resolveOptionalBinary('mutool').available,
    tesseract: resolveOptionalBinary('tesseract').available,
  };
}
