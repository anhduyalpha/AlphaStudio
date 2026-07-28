/**
 * Build media/audio job options with mode-honest fields.
 * Trim defaults to stream-copy (no format); re-encode is opt-in.
 */
import { buildCropJobOptions } from './imageCrop.js';

export const AUDIO_QUALITY_TABLE = {
  fast: { sampleRate: 44100, channels: 2, bitrate: '128k', label: 'Fast' },
  balanced: { sampleRate: 48000, channels: 2, bitrate: '160k', label: 'Balanced' },
  high: { sampleRate: 48000, channels: 2, bitrate: '256k', label: 'High' },
};

export const MEDIA_MODE_OPERATIONS = Object.freeze({
  video: Object.freeze([
    { id: 'trim', label: 'Trim', capability: 'media.trim' },
    { id: 'transcode', label: 'Transcode', capability: 'media.transcode' },
    { id: 'extract-audio', label: 'Extract audio', capability: 'media.extract-audio' },
    { id: 'inspect', label: 'Inspect', capability: 'media.inspect' },
  ]),
  audio: Object.freeze([
    { id: 'convert', label: 'Convert', capability: 'audio.convert' },
    { id: 'trim', label: 'Trim', capability: 'audio.trim' },
    { id: 'normalize', label: 'Normalize', capability: 'audio.normalize' },
    { id: 'inspect', label: 'Inspect', capability: 'media.inspect' },
  ]),
  image: Object.freeze([
    { id: 'optimize', label: 'Optimize', capability: 'image.compress' },
    { id: 'resize', label: 'Resize', capability: 'image.resize' },
    { id: 'crop', label: 'Crop', capability: 'image.crop' },
    { id: 'rotate', label: 'Rotate', capability: 'image.rotate' },
    { id: 'convert', label: 'Convert', capability: 'image.convert' },
    { id: 'compress', label: 'Compress', capability: 'image.compress' },
    { id: 'strip-metadata', label: 'Strip metadata', capability: 'image.strip-metadata' },
  ]),
});

export const MEDIA_FORMATS = Object.freeze({
  video: Object.freeze(['mp4', 'webm', 'mkv']),
  audio: Object.freeze(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']),
  image: Object.freeze(['webp', 'png', 'jpeg', 'avif']),
});

export function mediaOperationsFor(mode) {
  return MEDIA_MODE_OPERATIONS[mode] || [];
}

export function defaultMediaForm(mode, operation) {
  const defaultOperation = operation || mediaOperationsFor(mode)[0]?.id || '';
  return {
    operation: defaultOperation,
    format: mode === 'image' ? 'webp' : mode === 'audio' ? 'mp3' : 'mp4',
    quality: mode === 'image' ? '80' : 'balanced',
    start: '0',
    duration: '10',
    reencodeOnTrim: false,
    targetLoudness: '-16',
    width: '1280',
    height: '',
    angle: '90',
    stripMeta: false,
    crop: null,
  };
}

export function mediaOperationCapability(mode, operation) {
  return mediaOperationsFor(mode).find((entry) => entry.id === operation)?.capability || '';
}

export function describeAudioQuality(quality = 'balanced') {
  return AUDIO_QUALITY_TABLE[quality] || AUDIO_QUALITY_TABLE.balanced;
}

/**
 * @param {object} p
 * @param {string} p.operation - convert|trim|normalize|inspect|transcode|extract-audio
 * @param {string} [p.family] - audio when from AudioView
 * @param {string} [p.format]
 * @param {string} [p.quality]
 * @param {number|string} [p.start]
 * @param {number|string} [p.duration]
 * @param {boolean} [p.reencodeOnTrim]
 * @param {string} [p.targetLoudness]
 * @param {number|string} [p.channels] - 1|2 optional override via quality only for now
 */
export function buildMediaJobOptions({
  operation,
  family,
  format,
  quality = 'balanced',
  start,
  duration,
  reencodeOnTrim = false,
  targetLoudness = '-16',
  channels,
} = {}) {
  const op = String(operation || 'inspect');
  const options = { operation: op };
  if (family) options.family = family;

  if (op === 'inspect') {
    return options;
  }

  if (op === 'trim') {
    options.start = String(start ?? 0);
    options.duration = String(Math.max(0.05, Number(duration) || 0.05));
    if (reencodeOnTrim && format) {
      options.forceReencode = true;
      options.reencode = true;
      options.format = format;
      options.quality = quality;
    }
    // Stream-copy trim: intentionally omit format so backend keeps input container
    return options;
  }

  if (op === 'normalize') {
    options.format = format || 'mp3';
    options.quality = quality;
    options.targetLoudness = String(targetLoudness || '-16');
    return options;
  }

  if (op === 'convert' || op === 'transcode' || op === 'extract-audio') {
    options.format = format || (op === 'extract-audio' || family === 'audio' ? 'mp3' : 'mp4');
    options.quality = quality;
    if (channels === 1 || channels === '1' || channels === 2 || channels === '2') {
      // Hint only until processor accepts override; quality preset still drives encoder table
      options.channels = Number(channels);
    }
    return options;
  }

  return options;
}

export function buildMediaWorkbenchJobOptions(mode, form = {}) {
  if (mode === 'image') {
    const operation = String(form.operation || 'optimize');
    return buildCropJobOptions({
      operation,
      format: operation === 'strip-metadata' ? undefined : form.format,
      quality: form.quality,
      angle: form.angle,
      stripMeta: form.stripMeta,
      width: form.width,
      height: form.height,
      crop: operation === 'crop' ? form.crop : null,
    });
  }
  return buildMediaJobOptions({
    operation: form.operation,
    family: mode === 'audio' ? 'audio' : undefined,
    format: form.format,
    quality: form.quality,
    start: form.start,
    duration: form.duration,
    reencodeOnTrim: form.reencodeOnTrim,
    targetLoudness: form.targetLoudness,
  });
}

export function validateMediaWorkbench(mode, form = {}, file) {
  if (!file) return 'Select one compatible file to run.';
  const operation = String(form.operation || '');
  if (!mediaOperationsFor(mode).some((entry) => entry.id === operation)) {
    return 'Choose a published media operation.';
  }
  if (operation === 'trim') {
    const start = Number(form.start);
    const duration = Number(form.duration);
    if (!Number.isFinite(start) || start < 0) return 'Trim start must be zero or greater.';
    if (!Number.isFinite(duration) || duration < 0.05) return 'Trim duration must be at least 0.05 seconds.';
  }
  if (mode === 'image' && operation === 'resize') {
    const width = Number(form.width);
    const height = Number(form.height);
    if ((!Number.isFinite(width) || width <= 0) && (!Number.isFinite(height) || height <= 0)) {
      return 'Enter a positive width or height.';
    }
  }
  if (mode === 'image' && operation === 'crop') {
    if (!form.crop || Number(form.crop.width) < 1 || Number(form.crop.height) < 1) {
      return 'Set a valid crop region before running.';
    }
  }
  return '';
}

/** Whether the format select should appear for a mode */
export function showsFormatControl(operation, { reencodeOnTrim = false } = {}) {
  const op = String(operation || '');
  if (op === 'inspect') return false;
  if (op === 'trim') return Boolean(reencodeOnTrim);
  return true;
}

/** Whether quality / encode preset should appear */
export function showsQualityControl(operation, { reencodeOnTrim = false } = {}) {
  const op = String(operation || '');
  if (op === 'inspect') return false;
  if (op === 'trim') return Boolean(reencodeOnTrim);
  return true;
}
