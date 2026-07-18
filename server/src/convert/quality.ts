/**
 * Shared quality presets for image / PDF / media / audio encode paths.
 * Default is always `balanced` — matches settings.defaultQuality in the DB.
 *
 * Canonical keys: fast | balanced | high
 * Legacy aliases: small→fast, max→high
 */

import fs from 'node:fs';
import path from 'node:path';

export type QualityPreset = 'fast' | 'balanced' | 'high';

export const QUALITY_PRESETS: readonly QualityPreset[] = ['fast', 'balanced', 'high'] as const;

export const DEFAULT_QUALITY_PRESET: QualityPreset = 'balanced';

/** Aliases accepted from UI / legacy options → canonical preset */
const PRESET_ALIASES: Record<string, QualityPreset> = {
  fast: 'fast',
  low: 'fast',
  small: 'fast',
  speed: 'fast',
  balanced: 'balanced',
  medium: 'balanced',
  normal: 'balanced',
  default: 'balanced',
  high: 'high',
  max: 'high',
  best: 'high',
  quality: 'high',
};

/**
 * Resolve a quality preset from job options or a raw quality value.
 * Accepts `{ quality: 'fast'|'balanced'|'high'|number|alias }` or a bare value.
 * Numeric quality → structural preset defaults to `balanced` (number applied separately).
 * Also accepts legacy `small` / `max`.
 */
export function resolveQualityPreset(options: unknown): QualityPreset {
  const raw = extractQualityValue(options);
  if (typeof raw === 'string') {
    const key = raw.trim().toLowerCase();
    if (key in PRESET_ALIASES) return PRESET_ALIASES[key]!;
  }
  return DEFAULT_QUALITY_PRESET;
}

/** True when quality is a named preset (or alias), not a numeric encoder quality. */
export function isQualityPresetString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.trim().toLowerCase() in PRESET_ALIASES;
}

/**
 * Optional numeric override (1–100). Used when callers pass `quality: 70`
 * instead of a named preset. Returns undefined when a preset string is used.
 */
export function resolveNumericQuality(options: unknown): number | undefined {
  const raw = extractQualityValue(options);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampInt(raw, 1, 100);
  }
  if (typeof raw === 'string' && raw.trim() !== '' && !isQualityPresetString(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return clampInt(n, 1, 100);
  }
  return undefined;
}

function extractQualityValue(options: unknown): unknown {
  if (options !== null && typeof options === 'object' && 'quality' in (options as object)) {
    return (options as { quality: unknown }).quality;
  }
  return options;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ── Image encode ────────────────────────────────────────────────────────────

/** Sharp-compatible encode knobs returned by imageEncodeOptions. */
export type ImageEncodeOptions = {
  /** Encoder quality 1–100 (JPEG/WebP/AVIF/TIFF). */
  quality: number;
  /** JPEG: use mozjpeg. */
  mozjpeg?: boolean;
  /** JPEG: progressive scan. */
  progressive?: boolean;
  /** JPEG chroma subsampling (e.g. '4:2:0' | '4:4:4'). */
  chromaSubsampling?: string;
  /** PNG zlib compression level 0–9. */
  compressionLevel?: number;
  /** PNG effort / adaptive filtering effort (sharp). */
  effort?: number;
  /** WebP/AVIF CPU effort (higher = slower, better). */
  webpEffort?: number;
  /** AVIF effort 0–9. */
  avifEffort?: number;
  /** Resize kernel name for sharp (lanczos3 preferred for quality). */
  kernel: 'nearest' | 'cubic' | 'lanczos3' | 'mitchell';
  /** Prefer withoutEnlargement when resizing (caller still owns the flag). */
  withoutEnlargementDefault: boolean;
};

const IMAGE_TABLE: Record<QualityPreset, ImageEncodeOptions> = {
  fast: {
    quality: 72,
    mozjpeg: false,
    progressive: false,
    chromaSubsampling: '4:2:0',
    compressionLevel: 3,
    effort: 3,
    webpEffort: 2,
    avifEffort: 2,
    kernel: 'cubic',
    withoutEnlargementDefault: true,
  },
  balanced: {
    quality: 85,
    mozjpeg: true,
    progressive: true,
    chromaSubsampling: '4:2:0',
    compressionLevel: 6,
    effort: 6,
    webpEffort: 4,
    avifEffort: 4,
    kernel: 'lanczos3',
    withoutEnlargementDefault: true,
  },
  high: {
    quality: 95,
    mozjpeg: true,
    progressive: true,
    chromaSubsampling: '4:4:4',
    compressionLevel: 9,
    effort: 9,
    webpEffort: 6,
    avifEffort: 7,
    kernel: 'lanczos3',
    withoutEnlargementDefault: true,
  },
};

/**
 * Per-format sharp encode settings for a quality preset.
 * `format` is normalized (jpeg|jpg|png|webp|avif|tiff|gif|…).
 */
export function imageEncodeOptions(preset: QualityPreset, format: string): ImageEncodeOptions {
  const base = { ...(IMAGE_TABLE[preset] ?? IMAGE_TABLE.balanced) };
  const fmt = format.toLowerCase().replace('jpg', 'jpeg');

  // Format-specific quality tweaks (AVIF quality scale is more aggressive)
  if (fmt === 'avif') {
    const avifQ: Record<QualityPreset, number> = { fast: 45, balanced: 55, high: 72 };
    base.quality = avifQ[preset];
  } else if (fmt === 'webp') {
    const webpQ: Record<QualityPreset, number> = { fast: 72, balanced: 82, high: 92 };
    base.quality = webpQ[preset];
  } else if (fmt === 'png') {
    // PNG is lossless; quality is unused — compression/effort matter
    base.quality = 100;
  } else if (fmt === 'gif') {
    base.quality = 100;
  }

  return base;
}

/**
 * Build sharp `.jpeg() / .png() / .webp() / …` option objects for a preset.
 * Optional numericQuality overrides the preset quality number only.
 */
export function sharpFormatOptions(
  preset: QualityPreset,
  format: string,
  numericQuality?: number,
): Record<string, unknown> {
  const opts = imageEncodeOptions(preset, format);
  const q = numericQuality ?? opts.quality;
  const fmt = format.toLowerCase().replace('jpg', 'jpeg');

  switch (fmt) {
    case 'jpeg':
      return {
        quality: q,
        mozjpeg: opts.mozjpeg ?? true,
        progressive: opts.progressive ?? false,
        chromaSubsampling: opts.chromaSubsampling ?? '4:2:0',
      };
    case 'png':
      return {
        compressionLevel: opts.compressionLevel ?? 6,
        effort: opts.effort ?? 7,
      };
    case 'webp':
      return {
        quality: q,
        effort: opts.webpEffort ?? 4,
      };
    case 'avif':
      return {
        quality: q,
        effort: opts.avifEffort ?? 4,
      };
    case 'tiff':
      return {
        quality: q,
        compression: preset === 'fast' ? 'lzw' : 'jpeg',
      };
    case 'gif':
      return {
        effort: Math.min(10, opts.effort ?? 7),
      };
    default:
      return { quality: q };
  }
}

// ── PDF compress ────────────────────────────────────────────────────────────

/**
 * pdf-lib structural save options only — no image re-encode / rasterization.
 * Page size, fonts, and vectors are preserved via load → save.
 */
export type PdfCompressOptions = {
  /** Use PDF object streams (better structural compression, slightly slower). */
  useObjectStreams: boolean;
  /** pdf-lib objectsPerTick — higher = fewer yields (faster wall time on large docs). */
  objectsPerTick: number;
  /** Always structural-only for the pdf-lib path. */
  structuralOnly: true;
  /** Human-readable note for job meta. */
  note: string;
};

const PDF_TABLE: Record<QualityPreset, PdfCompressOptions> = {
  fast: {
    useObjectStreams: false,
    objectsPerTick: 100,
    structuralOnly: true,
    note: 'Fast structural save (no object streams); vectors/fonts preserved; no image re-encode',
  },
  balanced: {
    useObjectStreams: true,
    objectsPerTick: 50,
    structuralOnly: true,
    note: 'Structural compression with object streams; vectors/fonts preserved; no image re-encode',
  },
  high: {
    useObjectStreams: true,
    objectsPerTick: 25,
    structuralOnly: true,
    note: 'Thorough structural compression with object streams; vectors/fonts preserved; no image re-encode',
  },
};

export function pdfCompressOptions(preset: QualityPreset): PdfCompressOptions {
  return { ...(PDF_TABLE[preset] ?? PDF_TABLE.balanced) };
}

// ── Video encode (ffmpeg) ───────────────────────────────────────────────────

export type VideoEncodeSettings = {
  preset: QualityPreset;
  /** libx264/libx265 speed preset */
  x264Preset: 'ultrafast' | 'medium' | 'slow';
  /** H.264/H.265 CRF (lower = higher quality) */
  crf: number;
  /** VP9 CRF when encoding webm */
  vp9Crf: number;
  /** Always yuv420p for broad player compatibility */
  pixelFormat: 'yuv420p';
  /** Default AAC/Opus audio bitrate for video containers */
  audioBitrate: string;
  audioSampleRate: number;
  channelLayout: 'stereo';
  audioChannels: number;
  /** mp4/m4v movflags */
  mp4MovFlags: '+faststart';
};

const VIDEO_TABLE: Record<QualityPreset, VideoEncodeSettings> = {
  fast: {
    preset: 'fast',
    x264Preset: 'ultrafast',
    crf: 28,
    vp9Crf: 36,
    pixelFormat: 'yuv420p',
    audioBitrate: '128k',
    audioSampleRate: 44100,
    channelLayout: 'stereo',
    audioChannels: 2,
    mp4MovFlags: '+faststart',
  },
  balanced: {
    preset: 'balanced',
    x264Preset: 'medium',
    crf: 23,
    vp9Crf: 32,
    pixelFormat: 'yuv420p',
    audioBitrate: '160k',
    audioSampleRate: 48000,
    channelLayout: 'stereo',
    audioChannels: 2,
    mp4MovFlags: '+faststart',
  },
  high: {
    preset: 'high',
    x264Preset: 'slow',
    crf: 18,
    vp9Crf: 28,
    pixelFormat: 'yuv420p',
    audioBitrate: '256k',
    audioSampleRate: 48000,
    channelLayout: 'stereo',
    audioChannels: 2,
    mp4MovFlags: '+faststart',
  },
};

export function videoEncodeSettings(preset: QualityPreset): VideoEncodeSettings {
  return { ...(VIDEO_TABLE[preset] ?? VIDEO_TABLE.balanced) };
}

// ── Audio encode (ffmpeg) ───────────────────────────────────────────────────

export type AudioEncodeSettings = {
  preset: QualityPreset;
  sampleRate: number;
  channelLayout: 'stereo' | 'mono';
  channels: number;
  /** libmp3lame VBR qscale (0 best … 9 worst) */
  mp3Qscale: number;
  aacBitrate: string;
  opusBitrate: string;
  wmaBitrate: string;
  /** Generic bitrate fallback */
  bitrate: string;
};

const AUDIO_TABLE: Record<QualityPreset, AudioEncodeSettings> = {
  fast: {
    preset: 'fast',
    // 44100 is fine for mp3/aac; opus paths force 48000 in the encoder args
    sampleRate: 44100,
    channelLayout: 'stereo',
    channels: 2,
    mp3Qscale: 6,
    aacBitrate: '128k',
    opusBitrate: '96k',
    wmaBitrate: '96k',
    bitrate: '128k',
  },
  balanced: {
    preset: 'balanced',
    sampleRate: 48000,
    channelLayout: 'stereo',
    channels: 2,
    mp3Qscale: 4,
    aacBitrate: '160k',
    opusBitrate: '128k',
    wmaBitrate: '128k',
    bitrate: '160k',
  },
  high: {
    preset: 'high',
    sampleRate: 48000,
    channelLayout: 'stereo',
    channels: 2,
    mp3Qscale: 2,
    aacBitrate: '256k',
    opusBitrate: '192k',
    wmaBitrate: '192k',
    bitrate: '256k',
  },
};

export function audioEncodeSettings(preset: QualityPreset): AudioEncodeSettings {
  return { ...(AUDIO_TABLE[preset] ?? AUDIO_TABLE.balanced) };
}

// ── Stream-copy safety ──────────────────────────────────────────────────────

/** Codecs safe to mux into a container without re-encode. */
const CONTAINER_CODECS: Record<string, { video: string[] | '*'; audio: string[] | '*' }> = {
  mp4: { video: ['h264', 'hevc', 'h265', 'mpeg4', 'av1'], audio: ['aac', 'mp3', 'ac3', 'alac'] },
  m4v: { video: ['h264', 'hevc', 'h265', 'mpeg4'], audio: ['aac', 'mp3', 'ac3'] },
  mov: { video: ['h264', 'hevc', 'h265', 'prores', 'mjpeg', 'mpeg4'], audio: ['aac', 'mp3', 'pcm_s16le', 'pcm_s24le', 'alac'] },
  mkv: { video: '*', audio: '*' },
  webm: { video: ['vp8', 'vp9', 'av1'], audio: ['vorbis', 'opus'] },
  avi: { video: ['mpeg4', 'msmpeg4v2', 'msmpeg4v3', 'h264'], audio: ['mp3', 'ac3', 'pcm_s16le'] },
  mpeg: { video: ['mpeg1video', 'mpeg2video'], audio: ['mp2', 'mp3', 'ac3'] },
  mpg: { video: ['mpeg1video', 'mpeg2video'], audio: ['mp2', 'mp3', 'ac3'] },
  wmv: { video: ['wmv1', 'wmv2', 'wmv3', 'vc1'], audio: ['wmav1', 'wmav2'] },
  flv: { video: ['flv', 'h264'], audio: ['mp3', 'aac', 'nellymoser'] },
  mp3: { video: [], audio: ['mp3'] },
  m4a: { video: [], audio: ['aac', 'alac'] },
  aac: { video: [], audio: ['aac'] },
  ogg: { video: [], audio: ['vorbis', 'opus', 'flac'] },
  opus: { video: [], audio: ['opus'] },
  wav: { video: [], audio: ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'] },
  flac: { video: [], audio: ['flac'] },
  wma: { video: [], audio: ['wmav1', 'wmav2'] },
};

export type StreamMeta = {
  type?: string;
  codec?: string;
  codec_type?: string;
  codec_name?: string;
};

/**
 * True when all present streams can be remuxed into `outFormat` with `-c copy`.
 * GIF always requires re-encode (palette). Missing codec info → false (safe).
 */
export function canStreamCopy(
  outFormat: string,
  streams: StreamMeta[] | undefined | null,
): boolean {
  const fmt = outFormat.toLowerCase().replace(/^\./, '');
  if (fmt === 'gif') return false;
  const rules = CONTAINER_CODECS[fmt];
  if (!rules || !streams?.length) return false;

  let hasAudioOrVideo = false;
  for (const s of streams) {
    const type = (s.type || s.codec_type || '').toLowerCase();
    const codec = (s.codec || s.codec_name || '').toLowerCase();
    if (!codec) return false;
    if (type === 'video') {
      hasAudioOrVideo = true;
      if (rules.video === '*') continue;
      if (!rules.video.length) return false; // audio-only container
      if (!rules.video.includes(codec) && !(codec === 'h265' && rules.video.includes('hevc'))) {
        return false;
      }
    } else if (type === 'audio') {
      hasAudioOrVideo = true;
      if (rules.audio === '*') continue;
      if (!rules.audio.includes(codec)) return false;
    }
    // ignore subtitles/data for copy decision
  }
  return hasAudioOrVideo;
}

/** Normalize detect-style meta into stream list for canStreamCopy. */
export function streamsFromDetectMeta(meta: unknown): StreamMeta[] | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const m = meta as Record<string, unknown>;
  // full inspect result: { meta: { streams }, ... } or direct streams
  if (Array.isArray(m.streams)) return m.streams as StreamMeta[];
  if (m.meta && typeof m.meta === 'object' && Array.isArray((m.meta as { streams?: unknown }).streams)) {
    return (m.meta as { streams: StreamMeta[] }).streams;
  }
  // synthesize from single codec fields
  const streams: StreamMeta[] = [];
  if (typeof m.codec === 'string') streams.push({ type: 'video', codec: m.codec });
  if (typeof m.audioCodec === 'string') streams.push({ type: 'audio', codec: m.audioCodec });
  return streams.length ? streams : undefined;
}

// ── Output validation ───────────────────────────────────────────────────────

export type AssertValidOutputOptions = {
  label?: string;
  /** Expected extension including dot, e.g. `.mp4` (aliases like .jpg/.jpeg accepted). */
  expectedExt?: string;
  /** Throw AppError-friendly Error message. */
  minBytes?: number;
};

/**
 * Ensure an output path exists, is readable, size > 0 (or minBytes),
 * and optionally matches the expected extension before reporting success.
 * User-facing messages never include absolute paths.
 */
export function assertValidOutput(
  outputPath: string,
  options: string | AssertValidOutputOptions = {},
): void {
  const opts: AssertValidOutputOptions =
    typeof options === 'string' ? { label: options } : options;
  const label = opts.label || 'Output';
  const minBytes = opts.minBytes ?? 1;
  const base = outputPath ? path.basename(outputPath) : '';

  if (!outputPath) {
    throw new Error(`${label} validation failed: empty path`);
  }
  try {
    fs.accessSync(outputPath, fs.constants.R_OK);
  } catch {
    throw new Error(`${label} validation failed: file does not exist or is not readable (${base})`);
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(`${label} validation failed: file does not exist (${base})`);
  }
  const st = fs.statSync(outputPath);
  if (!st.isFile()) {
    throw new Error(`${label} validation failed: not a regular file (${base})`);
  }
  if (st.size < minBytes) {
    throw new Error(
      st.size <= 0
        ? `${label} validation failed: empty file (${base})`
        : `${label} validation failed: file too small (${st.size} < ${minBytes} bytes)`,
    );
  }

  if (opts.expectedExt) {
    const got = path.extname(outputPath).toLowerCase();
    const want = opts.expectedExt.startsWith('.')
      ? opts.expectedExt.toLowerCase()
      : `.${opts.expectedExt.toLowerCase()}`;
    if (!extensionsMatch(got, want)) {
      throw new Error(
        `${label} validation failed: expected extension ${want}, got ${got || '(none)'} (${base})`,
      );
    }
  }
}

function extensionsMatch(got: string, want: string): boolean {
  if (got === want) return true;
  const aliases: Record<string, string[]> = {
    '.jpg': ['.jpg', '.jpeg'],
    '.jpeg': ['.jpg', '.jpeg'],
    '.mpg': ['.mpg', '.mpeg'],
    '.mpeg': ['.mpg', '.mpeg'],
    '.tif': ['.tif', '.tiff'],
    '.tiff': ['.tif', '.tiff'],
    '.htm': ['.htm', '.html'],
    '.html': ['.htm', '.html'],
  };
  const allowed = aliases[want] || [want];
  return allowed.includes(got);
}
