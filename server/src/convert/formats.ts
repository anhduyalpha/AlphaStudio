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

export type FormatDefinition = {
  format: string;
  family: Family;
  mime: string;
  /** Option-value aliases accepted by `normalizeFormat` — not all are filename extensions. */
  aliases?: string[];
  /**
   * Real filename extensions, dot-prefixed. Defaults to `['.' + format]`; set it
   * only where the extensions differ from the canonical token (`.jpg`/`.jpeg`).
   * This is what the published accept lists advertise, so `markdown` (an option
   * alias) never leaks out as a `.markdown` file filter.
   */
  extensions?: string[];
};

const DEFINITIONS: FormatDefinition[] = [
  { format: 'png', family: 'image', mime: 'image/png' },
  { format: 'jpeg', family: 'image', mime: 'image/jpeg', aliases: ['jpg', 'jpe'], extensions: ['.jpg', '.jpeg'] },
  { format: 'webp', family: 'image', mime: 'image/webp' },
  { format: 'avif', family: 'image', mime: 'image/avif' },
  { format: 'gif', family: 'image', mime: 'image/gif' },
  { format: 'tiff', family: 'image', mime: 'image/tiff', aliases: ['tif'], extensions: ['.tif', '.tiff'] },
  { format: 'bmp', family: 'image', mime: 'image/bmp' },
  { format: 'ico', family: 'image', mime: 'image/x-icon' },
  { format: 'svg', family: 'image', mime: 'image/svg+xml' },
  { format: 'heic', family: 'image', mime: 'image/heic' },
  { format: 'heif', family: 'image', mime: 'image/heif' },
  { format: 'mp3', family: 'audio', mime: 'audio/mpeg' },
  { format: 'wav', family: 'audio', mime: 'audio/wav', aliases: ['wave'] },
  { format: 'flac', family: 'audio', mime: 'audio/flac' },
  { format: 'aac', family: 'audio', mime: 'audio/aac' },
  { format: 'm4a', family: 'audio', mime: 'audio/mp4' },
  { format: 'ogg', family: 'audio', mime: 'audio/ogg', aliases: ['oga'] },
  { format: 'opus', family: 'audio', mime: 'audio/opus' },
  { format: 'wma', family: 'audio', mime: 'audio/x-ms-wma' },
  { format: 'mp4', family: 'video', mime: 'video/mp4' },
  { format: 'mkv', family: 'video', mime: 'video/x-matroska', aliases: ['matroska'] },
  { format: 'webm', family: 'video', mime: 'video/webm' },
  { format: 'mov', family: 'video', mime: 'video/quicktime' },
  { format: 'avi', family: 'video', mime: 'video/x-msvideo' },
  { format: 'mpeg', family: 'video', mime: 'video/mpeg', aliases: ['mpg'], extensions: ['.mpeg', '.mpg'] },
  { format: 'wmv', family: 'video', mime: 'video/x-ms-wmv' },
  { format: 'm4v', family: 'video', mime: 'video/mp4' },
  { format: 'flv', family: 'video', mime: 'video/x-flv' },
  { format: 'pdf', family: 'pdf', mime: 'application/pdf' },
  { format: 'doc', family: 'document', mime: 'application/msword' },
  {
    format: 'docx',
    family: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { format: 'odt', family: 'document', mime: 'application/vnd.oasis.opendocument.text' },
  { format: 'rtf', family: 'document', mime: 'application/rtf' },
  { format: 'xls', family: 'spreadsheet', mime: 'application/vnd.ms-excel' },
  {
    format: 'xlsx',
    family: 'spreadsheet',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  { format: 'ods', family: 'spreadsheet', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  { format: 'csv', family: 'spreadsheet', mime: 'text/csv' },
  { format: 'tsv', family: 'spreadsheet', mime: 'text/tab-separated-values' },
  { format: 'parquet', family: 'spreadsheet', mime: 'application/vnd.apache.parquet' },
  { format: 'ppt', family: 'presentation', mime: 'application/vnd.ms-powerpoint' },
  {
    format: 'pptx',
    family: 'presentation',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  { format: 'odp', family: 'presentation', mime: 'application/vnd.oasis.opendocument.presentation' },
  { format: 'zip', family: 'archive', mime: 'application/zip' },
  { format: 'tar', family: 'archive', mime: 'application/x-tar' },
  { format: 'gz', family: 'archive', mime: 'application/gzip', aliases: ['gzip'] },
  { format: 'tgz', family: 'archive', mime: 'application/gzip' },
  { format: 'bz2', family: 'archive', mime: 'application/x-bzip2' },
  { format: 'xz', family: 'archive', mime: 'application/x-xz' },
  { format: '7z', family: 'archive', mime: 'application/x-7z-compressed' },
  { format: 'txt', family: 'text', mime: 'text/plain', aliases: ['text', 'plain'] },
  {
    format: 'md',
    family: 'text',
    mime: 'text/markdown',
    aliases: ['markdown', 'mdown', 'mkd', 'gfm', 'commonmark'],
  },
  { format: 'html', family: 'text', mime: 'text/html', aliases: ['htm', 'html5'], extensions: ['.html', '.htm'] },
  { format: 'rst', family: 'text', mime: 'text/x-rst', aliases: ['rest'] },
  { format: 'asciidoc', family: 'text', mime: 'text/asciidoc', aliases: ['adoc'], extensions: ['.adoc', '.asciidoc'] },
  { format: 'json', family: 'text', mime: 'application/json' },
  { format: 'epub', family: 'ebook', mime: 'application/epub+zip' },
  { format: 'mobi', family: 'ebook', mime: 'application/x-mobipocket-ebook' },
  { format: 'azw3', family: 'ebook', mime: 'application/vnd.amazon.ebook', aliases: ['azw'], extensions: ['.azw', '.azw3'] },
  { format: 'fb2', family: 'ebook', mime: 'application/x-fictionbook+xml' },
  { format: 'htmlz', family: 'ebook', mime: 'application/zip' },
];

const BY_TOKEN = new Map<string, FormatDefinition>();
const BY_MIME = new Map<string, FormatDefinition>();
for (const definition of DEFINITIONS) {
  BY_TOKEN.set(definition.format, definition);
  for (const alias of definition.aliases || []) BY_TOKEN.set(alias, definition);
  if (!BY_MIME.has(definition.mime)) BY_MIME.set(definition.mime, definition);
}

export function normalizeFormat(format: unknown): string {
  const token = String(format || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '');
  return BY_TOKEN.get(token)?.format || token;
}

export function formatDefinition(format: unknown): FormatDefinition | null {
  return BY_TOKEN.get(normalizeFormat(format)) || null;
}

export function formatFromMime(mime: unknown): FormatDefinition | null {
  const token = String(mime || '').trim().toLowerCase().split(';', 1)[0];
  return BY_MIME.get(token) || null;
}

export function formatFamily(format: unknown): Family {
  return formatDefinition(format)?.family || 'unknown';
}

export function formatMime(format: unknown): string {
  return formatDefinition(format)?.mime || 'application/octet-stream';
}

export function formatLabel(format: unknown): string {
  const normalized = normalizeFormat(format);
  if (normalized === 'jpeg') return 'JPEG';
  if (normalized === 'asciidoc') return 'AsciiDoc';
  return normalized.toUpperCase();
}

export function formatAliases(format: unknown): string[] {
  const definition = formatDefinition(format);
  return definition
    ? [definition.format, ...(definition.aliases || [])]
    : [normalizeFormat(format)].filter(Boolean);
}

export function allFormatDefinitions(): FormatDefinition[] {
  return DEFINITIONS.map((definition) => ({
    ...definition,
    aliases: definition.aliases ? [...definition.aliases] : undefined,
    extensions: definition.extensions ? [...definition.extensions] : undefined,
  }));
}

/** Filename extensions for a definition, dot-prefixed. Defaults to the token. */
export function formatExtensions(format: unknown): string[] {
  const definition = formatDefinition(format);
  if (!definition) return [];
  return definition.extensions ? [...definition.extensions] : [`.${definition.format}`];
}

/* ------------------------------------------------------------------ *
 * S2 (SPEC §3.5) — accept lists published via /api/capabilities.
 *
 * Every list is DERIVED from the definitions above: adding a format to the
 * table puts it in its family's list automatically, which is the whole point
 * of collapsing onto one table. The same lists back the job-create gate, so
 * what the client is told it may upload is exactly what the server accepts.
 * ------------------------------------------------------------------ */

export type AcceptList = {
  id: string;
  label: string;
  families: Family[];
  /** Dot-prefixed, lowercase, sorted. */
  extensions: string[];
  /** Sorted, deduped. */
  mimeTypes: string[];
};

/** `null` = this job type/mode places no restriction on input file types. */
export type JobAcceptRule = {
  default: string | null;
  operations: Record<string, string | null>;
};

const ACCEPT_LIST_FAMILIES: { id: string; label: string; families: Family[] }[] = [
  { id: 'image', label: 'Images', families: ['image'] },
  { id: 'audio', label: 'Audio', families: ['audio'] },
  { id: 'video', label: 'Video', families: ['video'] },
  { id: 'media', label: 'Audio and video', families: ['audio', 'video'] },
  { id: 'pdf', label: 'PDF', families: ['pdf'] },
  { id: 'archive', label: 'Archives', families: ['archive'] },
  { id: 'text', label: 'Text and tabular', families: ['text', 'spreadsheet'] },
  { id: 'spreadsheet', label: 'Spreadsheets', families: ['spreadsheet'] },
  { id: 'document', label: 'Documents', families: ['document'] },
  { id: 'presentation', label: 'Presentations', families: ['presentation'] },
  { id: 'ebook', label: 'Ebooks', families: ['ebook'] },
];

/**
 * Which named list each job type accepts, with per-mode overrides. A `null`
 * means the type genuinely takes any input (whole-file hashing, archiving
 * arbitrary files, the converter's own engine matrix gate) — not "unchecked".
 */
const JOB_ACCEPT_RULES: Record<string, JobAcceptRule> = {
  image: { default: 'image', operations: {} },
  qr: { default: 'image', operations: { generate: null } },
  pdf: { default: 'pdf', operations: { 'from-images': 'image' } },
  media: { default: 'media', operations: {} },
  audio: { default: 'audio', operations: {} },
  // `create` packs arbitrary files; only extraction needs a real archive.
  archive: { default: null, operations: { extract: 'archive' } },
  // Text ops normally run on an inline string; an uploaded file may be anything.
  text: { default: null, operations: {} },
  // Inspection/hashing is deliberately format-agnostic.
  security: { default: null, operations: {} },
  // Gated instead by the live engine matrix (gateConverterCreate).
  converter: { default: null, operations: {} },
  pyop: { default: null, operations: {} },
};

function buildAcceptList(spec: { id: string; label: string; families: Family[] }): AcceptList {
  const extensions = new Set<string>();
  const mimeTypes = new Set<string>();
  for (const definition of DEFINITIONS) {
    if (!spec.families.includes(definition.family)) continue;
    for (const ext of definition.extensions || [`.${definition.format}`]) extensions.add(ext);
    mimeTypes.add(definition.mime);
  }
  return {
    id: spec.id,
    label: spec.label,
    families: [...spec.families],
    extensions: [...extensions].sort(),
    mimeTypes: [...mimeTypes].sort(),
  };
}

const ACCEPT_LISTS: Record<string, AcceptList> = Object.fromEntries(
  ACCEPT_LIST_FAMILIES.map((spec) => [spec.id, buildAcceptList(spec)]),
);

export function acceptListById(id: string | null | undefined): AcceptList | null {
  if (!id) return null;
  return ACCEPT_LISTS[id] || null;
}

/** The list id a job type/mode is checked against, or `null` for unrestricted. */
export function acceptListIdForJob(type: unknown, operation: unknown): string | null {
  const rule = JOB_ACCEPT_RULES[String(type || '').toLowerCase()];
  if (!rule) return null;
  const op = String(operation || '')
    .toLowerCase()
    .trim();
  if (op && Object.prototype.hasOwnProperty.call(rule.operations, op)) return rule.operations[op];
  return rule.default;
}

/** True when `filename`'s extension is advertised by the named list. */
export function isFilenameAccepted(listId: string | null | undefined, filename: unknown): boolean {
  const list = acceptListById(listId);
  if (!list) return true;
  const name = String(filename || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return list.extensions.includes(name.slice(dot));
}

/** The serializable §3.5 contract: named lists + the job type/mode mapping. */
export function publishedAcceptLists(): {
  lists: Record<string, AcceptList>;
  jobTypes: Record<string, JobAcceptRule>;
} {
  return {
    lists: Object.fromEntries(
      Object.entries(ACCEPT_LISTS).map(([id, list]) => [
        id,
        { ...list, families: [...list.families], extensions: [...list.extensions], mimeTypes: [...list.mimeTypes] },
      ]),
    ),
    jobTypes: Object.fromEntries(
      Object.entries(JOB_ACCEPT_RULES).map(([type, rule]) => [
        type,
        { default: rule.default, operations: { ...rule.operations } },
      ]),
    ),
  };
}
