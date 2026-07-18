import fs from 'node:fs';
import path from 'node:path';
import { detectCapabilities } from '../capabilities.js';
import { badRequest, unavailable } from '../lib/errors.js';
import { randomServerName } from '../lib/paths.js';
import { execFileTracked } from '../lib/child-registry.js';
import {
  assertValidOutput,
  audioEncodeSettings,
  canStreamCopy,
  resolveQualityPreset,
  streamsFromDetectMeta,
  videoEncodeSettings,
  type QualityPreset,
} from '../convert/quality.js';
import type { ProcessContext, ProcessResult } from './types.js';

function requireFfprobe(): string {
  const caps = detectCapabilities();
  if (!caps.binaries.ffprobe?.available) {
    throw unavailable('media.inspect', 'ffprobe not found. Run npm run setup:tools.');
  }
  return caps.binaries.ffprobe.path || 'ffprobe';
}

function requireFfmpeg(): { ffmpeg: string; ffprobe: string } {
  const caps = detectCapabilities();
  if (!caps.binaries.ffmpeg?.available) {
    throw unavailable('media', 'ffmpeg not found. Run npm run setup:tools.');
  }
  if (!caps.binaries.ffprobe?.available) {
    throw unavailable('media', 'ffprobe not found. Run npm run setup:tools.');
  }
  return {
    ffmpeg: caps.binaries.ffmpeg.path || 'ffmpeg',
    ffprobe: caps.binaries.ffprobe.path || 'ffprobe',
  };
}

/** Pull detect metadata from options when converter already probed the file. */
function detectFromOptions(options: Record<string, unknown>): Record<string, unknown> | undefined {
  const d = options._detect ?? options.detectMeta;
  if (d && typeof d === 'object') return d as Record<string, unknown>;
  return undefined;
}

function finishMedia(
  outputPath: string,
  outputName: string,
  ext: string,
  extraMeta?: Record<string, unknown>,
): ProcessResult {
  assertValidOutput(outputPath, { label: 'Media output', expectedExt: ext });
  return {
    outputPath,
    outputName,
    outputMime: guessMime(ext),
    meta: extraMeta,
  };
}

export async function processMedia(ctx: ProcessContext): Promise<ProcessResult> {
  const op = String(ctx.options.operation || 'inspect');
  const family = String(ctx.options.family || 'media'); // media | audio
  ctx.onProgress(10, `${family} ${op}`);

  if (op === 'inspect') {
    // inspect needs ffprobe only — not ffmpeg
    const ffprobe = requireFfprobe();
    if (!ctx.inputPaths[0]) throw badRequest('Media file required');
    const { stdout } = await execFileTracked(
      ffprobe,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', ctx.inputPaths[0]],
      { jobId: ctx.jobId, timeout: 60_000, maxBuffer: 20 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout);
    const name = randomServerName('.json');
    const outputPath = path.join(ctx.outputDir, name);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    ctx.onProgress(100, 'Inspected');
    assertValidOutput(outputPath, { label: 'Inspect output', expectedExt: '.json' });
    return {
      outputPath,
      outputName: 'media-info.json',
      outputMime: 'application/json',
      meta: {
        format: data.format?.format_name,
        duration: data.format?.duration,
        size: data.format?.size,
        streams: (data.streams || []).map((s: { codec_type?: string; codec_name?: string }) => ({
          type: s.codec_type,
          codec: s.codec_name,
        })),
      },
    };
  }

  const { ffmpeg } = requireFfmpeg();
  if (!ctx.inputPaths[0]) throw badRequest('Media file required');
  if (ctx.isCancelled()) throw badRequest('Cancelled');

  const qualityPreset = resolveQualityPreset(ctx.options);
  const videoQ = videoEncodeSettings(qualityPreset);
  const audioQ = audioEncodeSettings(qualityPreset);

  if (op === 'trim') {
    const start = String(ctx.options.start || '0');
    const duration = ctx.options.duration != null ? String(ctx.options.duration) : undefined;
    const end = ctx.options.end != null ? String(ctx.options.end) : undefined;
    const ext = path.extname(ctx.inputNames[0] || ctx.inputPaths[0]) || '.mp4';
    const outName = randomServerName(ext);
    const outputPath = path.join(ctx.outputDir, outName);
    // Stream-copy trim — no re-encode
    const args = ['-y', '-ss', start, '-i', ctx.inputPaths[0]];
    if (duration) args.push('-t', duration);
    else if (end) args.push('-to', end);
    args.push('-c', 'copy', outputPath);
    await runFfmpeg(ffmpeg, args, ctx);
    ctx.onProgress(100, 'Trimmed');
    return finishMedia(outputPath, `trimmed${ext}`, ext, { quality: qualityPreset, streamCopy: true });
  }

  if (op === 'transcode' || op === 'convert') {
    const format = String(ctx.options.format || (family === 'audio' ? 'mp3' : 'mp4')).toLowerCase();
    const ext = `.${format}`;
    const outName = randomServerName(ext);
    const outputPath = path.join(ctx.outputDir, outName);
    const args = ['-y', '-i', ctx.inputPaths[0]];

    const audioFmts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'opus', 'm4a', 'wma'];
    const isAudioOut = audioFmts.includes(format) || family === 'audio';

    // Prefer stream-copy when same/compatible container and codecs already fit
    const detect = detectFromOptions(ctx.options);
    const streams =
      streamsFromDetectMeta(detect) ||
      streamsFromDetectMeta(detect?.meta) ||
      undefined;
    const inputFormat = String(
      detect?.format ||
        path.extname(ctx.inputNames[0] || ctx.inputPaths[0] || '')
          .slice(1)
          .toLowerCase() ||
        '',
    ).toLowerCase();
    const forceReencode = Boolean(ctx.options.reencode || ctx.options.forceReencode);
    const tryCopy =
      !forceReencode &&
      containersCompatibleForCopy(inputFormat, format) &&
      canStreamCopy(format, streams);

    if (tryCopy) {
      args.push('-c', 'copy');
      if (format === 'mp4' || format === 'm4v') {
        args.push('-movflags', videoQ.mp4MovFlags);
      }
      args.push(outputPath);
      await runFfmpeg(ffmpeg, args, ctx);
      ctx.onProgress(100, 'Remuxed');
      return finishMedia(outputPath, `converted${ext}`, ext, {
        quality: qualityPreset,
        streamCopy: true,
      });
    }

    if (isAudioOut) {
      pushAudioEncodeArgs(args, format, audioQ);
      args.push('-vn', outputPath);
    } else if (format === 'gif') {
      // Real GIF palette pipeline — never -c copy
      const fps = qualityPreset === 'fast' ? 8 : qualityPreset === 'high' ? 15 : 10;
      const width = qualityPreset === 'fast' ? 320 : qualityPreset === 'high' ? 640 : 480;
      args.push(
        '-vf',
        `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
        '-loop',
        '0',
        outputPath,
      );
    } else {
      pushVideoEncodeArgs(args, format, videoQ, audioQ, qualityPreset);
      args.push(outputPath);
    }

    await runFfmpeg(ffmpeg, args, ctx);
    ctx.onProgress(100, 'Transcoded');
    return finishMedia(outputPath, `converted${ext}`, ext, {
      quality: qualityPreset,
      streamCopy: false,
      videoPreset: isAudioOut || format === 'gif' ? undefined : format === 'webm' ? 'vp9' : videoQ.x264Preset,
      crf: isAudioOut || format === 'gif' ? undefined : format === 'webm' ? videoQ.vp9Crf : videoQ.crf,
      pixelFormat: isAudioOut || format === 'gif' ? undefined : videoQ.pixelFormat,
    });
  }

  if (op === 'extract-audio') {
    const format = String(ctx.options.format || 'mp3').toLowerCase();
    const ext = `.${format}`;
    const outName = randomServerName(ext);
    const outputPath = path.join(ctx.outputDir, outName);
    const args = ['-y', '-i', ctx.inputPaths[0], '-vn'];

    const detect = detectFromOptions(ctx.options);
    const streams = streamsFromDetectMeta(detect) || streamsFromDetectMeta(detect?.meta);
    const forceReencode = Boolean(ctx.options.reencode || ctx.options.forceReencode);
    if (!forceReencode && canStreamCopy(format, streams)) {
      args.push('-c:a', 'copy', outputPath);
      await runFfmpeg(ffmpeg, args, ctx);
      ctx.onProgress(100, 'Audio extracted');
      return finishMedia(outputPath, `audio${ext}`, ext, { quality: qualityPreset, streamCopy: true });
    }

    pushAudioEncodeArgs(args, format, audioQ);
    args.push(outputPath);
    await runFfmpeg(ffmpeg, args, ctx);
    ctx.onProgress(100, 'Audio extracted');
    return finishMedia(outputPath, `audio${ext}`, ext, { quality: qualityPreset, streamCopy: false });
  }

  if (op === 'normalize') {
    const format = String(ctx.options.format || path.extname(ctx.inputNames[0] || '').slice(1) || 'mp3').toLowerCase();
    const ext = `.${format}`;
    const outName = randomServerName(ext);
    const outputPath = path.join(ctx.outputDir, outName);
    const target = String(ctx.options.targetLoudness || '-16');
    const args = [
      '-y',
      '-i',
      ctx.inputPaths[0],
      '-af',
      `loudnorm=I=${target}:TP=-1.5:LRA=11`,
    ];
    // loudnorm requires re-encode; apply audio quality settings when possible
    const audioFmts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'opus', 'm4a', 'wma'];
    if (audioFmts.includes(format)) {
      pushAudioEncodeArgs(args, format, audioQ);
    }
    args.push(outputPath);
    await runFfmpeg(ffmpeg, args, ctx);
    ctx.onProgress(100, 'Normalized');
    return finishMedia(outputPath, `normalized${ext}`, ext, { quality: qualityPreset });
  }

  throw badRequest(`Unknown media operation: ${op}`);
}

function pushAudioEncodeArgs(
  args: string[],
  format: string,
  audioQ: ReturnType<typeof audioEncodeSettings>,
): void {
  // libopus only supports 8/12/16/24/48 kHz — never 44100
  const sampleRate =
    format === 'ogg' || format === 'opus' ? 48000 : audioQ.sampleRate;
  args.push('-ar', String(sampleRate), '-ac', String(audioQ.channels));

  if (format === 'mp3') {
    args.push('-codec:a', 'libmp3lame', '-qscale:a', String(audioQ.mp3Qscale));
  } else if (format === 'wav') {
    args.push('-codec:a', 'pcm_s16le');
  } else if (format === 'flac') {
    args.push('-codec:a', 'flac');
  } else if (format === 'aac' || format === 'm4a') {
    args.push('-codec:a', 'aac', '-b:a', audioQ.aacBitrate);
  } else if (format === 'ogg' || format === 'opus') {
    args.push('-codec:a', 'libopus', '-b:a', audioQ.opusBitrate);
  } else if (format === 'wma') {
    args.push('-codec:a', 'wmav2', '-b:a', audioQ.wmaBitrate);
  } else {
    args.push('-codec:a', 'libmp3lame', '-qscale:a', String(audioQ.mp3Qscale));
  }
}

function pushVideoEncodeArgs(
  args: string[],
  format: string,
  videoQ: ReturnType<typeof videoEncodeSettings>,
  audioQ: ReturnType<typeof audioEncodeSettings>,
  qualityPreset: QualityPreset,
): void {
  if (format === 'webm') {
    args.push(
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      String(videoQ.vp9Crf),
      '-pix_fmt',
      videoQ.pixelFormat,
      '-c:a',
      'libopus',
      '-b:a',
      audioQ.opusBitrate,
      // libopus requires 48000 (not 44100)
      '-ar',
      '48000',
      '-ac',
      String(audioQ.channels),
    );
    return;
  }

  if (format === 'mp4' || format === 'm4v') {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      videoQ.x264Preset,
      '-crf',
      String(videoQ.crf),
      '-pix_fmt',
      videoQ.pixelFormat,
      '-c:a',
      'aac',
      '-b:a',
      videoQ.audioBitrate,
      '-ar',
      String(videoQ.audioSampleRate),
      '-ac',
      String(videoQ.audioChannels),
      '-movflags',
      videoQ.mp4MovFlags,
    );
    return;
  }

  if (format === 'mkv' || format === 'mov') {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      videoQ.x264Preset,
      '-crf',
      String(videoQ.crf),
      '-pix_fmt',
      videoQ.pixelFormat,
      '-c:a',
      'aac',
      '-b:a',
      videoQ.audioBitrate,
      '-ar',
      String(videoQ.audioSampleRate),
      '-ac',
      String(videoQ.audioChannels),
    );
    return;
  }

  if (format === 'avi') {
    const qv = qualityPreset === 'high' ? '3' : qualityPreset === 'fast' ? '7' : '5';
    args.push(
      '-c:v',
      'mpeg4',
      '-q:v',
      qv,
      '-pix_fmt',
      videoQ.pixelFormat,
      '-c:a',
      'libmp3lame',
      '-qscale:a',
      String(audioQ.mp3Qscale),
    );
    return;
  }

  if (format === 'mpeg' || format === 'mpg') {
    const qv = qualityPreset === 'high' ? '3' : qualityPreset === 'fast' ? '7' : '5';
    args.push(
      '-c:v',
      'mpeg2video',
      '-q:v',
      qv,
      '-pix_fmt',
      videoQ.pixelFormat,
      '-c:a',
      'mp2',
      '-b:a',
      videoQ.audioBitrate,
    );
    return;
  }

  if (format === 'wmv') {
    args.push(
      '-c:v',
      'wmv2',
      '-b:v',
      qualityPreset === 'high' ? '2M' : qualityPreset === 'fast' ? '800k' : '1.5M',
      '-pix_fmt',
      videoQ.pixelFormat,
      '-c:a',
      'wmav2',
      '-b:a',
      audioQ.wmaBitrate,
    );
    return;
  }

  if (format === 'flv') {
    args.push(
      '-c:v',
      'flv',
      '-q:v',
      qualityPreset === 'high' ? '3' : qualityPreset === 'fast' ? '7' : '5',
      '-pix_fmt',
      videoQ.pixelFormat,
      '-c:a',
      'libmp3lame',
      '-qscale:a',
      String(audioQ.mp3Qscale),
    );
    return;
  }

  throw badRequest(`Unsupported media output format: ${format}`);
}

/** Same-container remux pairs that can safely `-c copy` without re-encode. */
function containersCompatibleForCopy(inputFormat: string, outFormat: string): boolean {
  const a = inputFormat.replace(/^\./, '').toLowerCase();
  const b = outFormat.replace(/^\./, '').toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const groups: string[][] = [
    ['mp4', 'm4v'],
    ['mpeg', 'mpg'],
    ['jpg', 'jpeg'],
  ];
  return groups.some((g) => g.includes(a) && g.includes(b));
}

async function runFfmpeg(ffmpeg: string, args: string[], ctx: ProcessContext): Promise<void> {
  ctx.onProgress(40, 'Running ffmpeg');
  if (ctx.isCancelled()) throw badRequest('Cancelled');
  try {
    await execFileTracked(ffmpeg, args, {
      jobId: ctx.jobId,
      timeout: 240_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (e) {
    if (ctx.isCancelled()) throw badRequest('Cancelled');
    const msg = e instanceof Error ? e.message : 'ffmpeg failed';
    throw badRequest(`Media processing failed: ${msg}`);
  }
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma',
    '.json': 'application/json',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}
