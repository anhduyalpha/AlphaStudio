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
  aliases?: string[];
};

const DEFINITIONS: FormatDefinition[] = [
  { format: 'png', family: 'image', mime: 'image/png' },
  { format: 'jpeg', family: 'image', mime: 'image/jpeg', aliases: ['jpg', 'jpe'] },
  { format: 'webp', family: 'image', mime: 'image/webp' },
  { format: 'avif', family: 'image', mime: 'image/avif' },
  { format: 'gif', family: 'image', mime: 'image/gif' },
  { format: 'tiff', family: 'image', mime: 'image/tiff', aliases: ['tif'] },
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
  { format: 'mpeg', family: 'video', mime: 'video/mpeg', aliases: ['mpg'] },
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
  { format: 'html', family: 'text', mime: 'text/html', aliases: ['htm', 'html5'] },
  { format: 'rst', family: 'text', mime: 'text/x-rst', aliases: ['rest'] },
  { format: 'asciidoc', family: 'text', mime: 'text/asciidoc', aliases: ['adoc'] },
  { format: 'epub', family: 'ebook', mime: 'application/epub+zip' },
  { format: 'mobi', family: 'ebook', mime: 'application/x-mobipocket-ebook' },
  { format: 'azw3', family: 'ebook', mime: 'application/vnd.amazon.ebook', aliases: ['azw'] },
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
  }));
}
