/**
 * Build media/audio job options with mode-honest fields.
 * Trim defaults to stream-copy (no format); re-encode is opt-in.
 */

export const AUDIO_QUALITY_TABLE = {
  fast: { sampleRate: 44100, channels: 2, bitrate: '128k', label: 'Fast' },
  balanced: { sampleRate: 48000, channels: 2, bitrate: '160k', label: 'Balanced' },
  high: { sampleRate: 48000, channels: 2, bitrate: '256k', label: 'High' },
};

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
