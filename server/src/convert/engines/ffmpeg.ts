import { resolveTool } from '../../tools/registry.js';
import { formatFamily } from '../formats.js';
import {
  firstProbeLine,
  runProbeCommand,
  safeProbeReason,
  type ProbeRunner,
} from './probe.js';
import type {
  ConversionEngineAdapter,
  EngineRouteCandidate,
  EngineRouteMetadata,
} from './types.js';
import { validateRegisteredOutput } from './validation.js';

export type FfmpegCapabilityLists = {
  demuxers: Set<string>;
  muxers: Set<string>;
  decoders: Set<string>;
  encoders: Set<string>;
};

type MediaInputPolicy = {
  demuxers: string[];
  audioDecoders?: string[];
  videoDecoders?: string[];
};

type MediaOutputPolicy = {
  muxers: string[];
  audioEncoders?: string[];
  videoEncoders?: string[];
};

const INPUT_POLICY: Record<string, MediaInputPolicy> = {
  mp3: { demuxers: ['mp3'], audioDecoders: ['mp3', 'mp3float'] },
  wav: { demuxers: ['wav'], audioDecoders: ['pcm_s16le', 'pcm_s24le', 'pcm_f32le'] },
  flac: { demuxers: ['flac'], audioDecoders: ['flac'] },
  aac: { demuxers: ['aac'], audioDecoders: ['aac'] },
  m4a: { demuxers: ['mov', 'mp4', 'm4a'], audioDecoders: ['aac', 'alac', 'mp3'] },
  ogg: { demuxers: ['ogg'], audioDecoders: ['vorbis', 'opus', 'flac'] },
  opus: { demuxers: ['ogg', 'opus'], audioDecoders: ['opus'] },
  wma: { demuxers: ['asf'], audioDecoders: ['wmav1', 'wmav2', 'wmapro'] },
  mp4: {
    demuxers: ['mov', 'mp4', 'm4a'],
    videoDecoders: ['h264', 'hevc', 'mpeg4', 'vp9', 'av1'],
    audioDecoders: ['aac', 'mp3', 'ac3', 'opus'],
  },
  m4v: {
    demuxers: ['mov', 'mp4', 'm4a'],
    videoDecoders: ['h264', 'hevc', 'mpeg4'],
    audioDecoders: ['aac', 'mp3'],
  },
  mkv: {
    demuxers: ['matroska', 'webm'],
    videoDecoders: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4'],
    audioDecoders: ['aac', 'opus', 'vorbis', 'flac', 'mp3'],
  },
  webm: {
    demuxers: ['matroska', 'webm'],
    videoDecoders: ['vp8', 'vp9', 'av1'],
    audioDecoders: ['opus', 'vorbis'],
  },
  mov: {
    demuxers: ['mov', 'mp4', 'm4a'],
    videoDecoders: ['h264', 'hevc', 'prores', 'mpeg4'],
    audioDecoders: ['aac', 'pcm_s16le', 'alac'],
  },
  avi: {
    demuxers: ['avi'],
    videoDecoders: ['mpeg4', 'msmpeg4v3', 'h264', 'mjpeg'],
    audioDecoders: ['mp3', 'pcm_s16le', 'ac3'],
  },
  mpeg: {
    demuxers: ['mpeg', 'mpegvideo'],
    videoDecoders: ['mpeg1video', 'mpeg2video'],
    audioDecoders: ['mp2', 'mp3'],
  },
  wmv: {
    demuxers: ['asf'],
    videoDecoders: ['wmv1', 'wmv2', 'wmv3', 'vc1'],
    audioDecoders: ['wmav1', 'wmav2', 'wmapro'],
  },
  flv: {
    demuxers: ['flv'],
    videoDecoders: ['flv1', 'h264', 'vp6f'],
    audioDecoders: ['mp3', 'aac'],
  },
  gif: { demuxers: ['gif'], videoDecoders: ['gif'] },
};

const OUTPUT_POLICY: Record<string, MediaOutputPolicy> = {
  mp3: { muxers: ['mp3'], audioEncoders: ['libmp3lame', 'mp3'] },
  wav: { muxers: ['wav'], audioEncoders: ['pcm_s16le'] },
  flac: { muxers: ['flac'], audioEncoders: ['flac'] },
  aac: { muxers: ['adts', 'aac'], audioEncoders: ['aac'] },
  m4a: { muxers: ['ipod', 'mp4'], audioEncoders: ['aac'] },
  ogg: { muxers: ['ogg'], audioEncoders: ['libopus', 'libvorbis', 'opus', 'vorbis'] },
  opus: { muxers: ['opus', 'ogg'], audioEncoders: ['libopus', 'opus'] },
  wma: { muxers: ['asf'], audioEncoders: ['wmav2'] },
  mp4: { muxers: ['mp4'], videoEncoders: ['libx264', 'h264'], audioEncoders: ['aac'] },
  m4v: { muxers: ['mp4'], videoEncoders: ['libx264', 'h264'], audioEncoders: ['aac'] },
  mkv: { muxers: ['matroska'], videoEncoders: ['libx264', 'h264'], audioEncoders: ['aac'] },
  webm: {
    muxers: ['webm'],
    videoEncoders: ['libvpx-vp9', 'libvpx', 'vp9'],
    audioEncoders: ['libopus', 'opus'],
  },
  mov: { muxers: ['mov'], videoEncoders: ['libx264', 'h264'], audioEncoders: ['aac'] },
  avi: { muxers: ['avi'], videoEncoders: ['mpeg4'], audioEncoders: ['libmp3lame', 'mp3'] },
  mpeg: { muxers: ['mpeg'], videoEncoders: ['mpeg2video'], audioEncoders: ['mp2'] },
  wmv: { muxers: ['asf'], videoEncoders: ['wmv2'], audioEncoders: ['wmav2'] },
  flv: { muxers: ['flv'], videoEncoders: ['flv'], audioEncoders: ['libmp3lame', 'mp3'] },
  gif: { muxers: ['gif'], videoEncoders: ['gif'] },
};

const SAFE_PAIRS: Record<string, string[]> = {
  mp3: ['wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'],
  wav: ['mp3', 'flac', 'aac', 'm4a', 'ogg', 'opus'],
  flac: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus'],
  aac: ['mp3', 'wav', 'flac', 'm4a', 'ogg'],
  m4a: ['mp3', 'wav', 'flac', 'aac', 'ogg'],
  ogg: ['mp3', 'wav', 'flac', 'aac', 'm4a'],
  opus: ['mp3', 'wav', 'ogg', 'm4a'],
  wma: ['mp3', 'wav', 'flac', 'm4a'],
  mp4: ['webm', 'mkv', 'mov', 'avi', 'gif', 'mp3', 'wav', 'aac', 'm4a'],
  mkv: ['mp4', 'webm', 'mov', 'avi', 'gif', 'mp3', 'wav', 'm4a'],
  webm: ['mp4', 'mkv', 'gif', 'mp3', 'wav', 'ogg'],
  mov: ['mp4', 'webm', 'mkv', 'gif', 'mp3', 'wav', 'm4a'],
  avi: ['mp4', 'webm', 'mkv', 'gif', 'mp3', 'wav'],
  mpeg: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  wmv: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  m4v: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  flv: ['mp4', 'webm', 'mkv', 'mp3', 'wav'],
  gif: ['mp4', 'webm'],
};

function parseFormatTable(text: string): Set<string> {
  const formats = new Set<string>();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*[D\. ]?[E\. ]?\s+([a-zA-Z0-9_,.-]+)\s+/);
    if (!match) continue;
    for (const token of match[1].split(',')) {
      if (token && token !== '=') formats.add(token.toLowerCase());
    }
  }
  return formats;
}

function parseCodecTable(text: string): Set<string> {
  const codecs = new Set<string>();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*[VAS][A-Z.]{5}\s+([a-zA-Z0-9_.-]+)\b/);
    if (match) codecs.add(match[1].toLowerCase());
  }
  return codecs;
}

export function parseFfmpegCapabilities(parts: {
  demuxers: string;
  muxers: string;
  decoders: string;
  encoders: string;
}): FfmpegCapabilityLists {
  return {
    demuxers: parseFormatTable(parts.demuxers),
    muxers: parseFormatTable(parts.muxers),
    decoders: parseCodecTable(parts.decoders),
    encoders: parseCodecTable(parts.encoders),
  };
}

function firstAvailable(haystack: Set<string>, candidates: string[] | undefined): string | undefined {
  return candidates?.find((candidate) => haystack.has(candidate));
}

function supportsInput(
  input: MediaInputPolicy,
  outputFamily: string,
  caps: FfmpegCapabilityLists,
): { ok: boolean; reason?: string } {
  if (!firstAvailable(caps.demuxers, input.demuxers)) {
    return { ok: false, reason: 'FFmpeg build lacks a safe demuxer for this input' };
  }
  const needsVideo = outputFamily === 'video' || outputFamily === 'image';
  const decoder = needsVideo
    ? firstAvailable(caps.decoders, input.videoDecoders)
    : firstAvailable(caps.decoders, input.audioDecoders);
  if (!decoder) {
    return {
      ok: false,
      reason: `FFmpeg build lacks a ${needsVideo ? 'video' : 'audio'} decoder for this input`,
    };
  }
  return { ok: true };
}

function supportsOutput(
  output: MediaOutputPolicy,
  caps: FfmpegCapabilityLists,
): { ok: boolean; reason?: string; metadata: EngineRouteMetadata } {
  const muxer = firstAvailable(caps.muxers, output.muxers);
  if (!muxer) {
    return { ok: false, reason: 'FFmpeg build lacks the required output muxer', metadata: {} };
  }
  const audioEncoder = firstAvailable(caps.encoders, output.audioEncoders);
  const videoEncoder = firstAvailable(caps.encoders, output.videoEncoders);
  if (output.audioEncoders?.length && !audioEncoder) {
    return { ok: false, reason: 'FFmpeg build lacks the required audio encoder', metadata: { muxer } };
  }
  if (output.videoEncoders?.length && !videoEncoder) {
    return { ok: false, reason: 'FFmpeg build lacks the required video encoder', metadata: { muxer } };
  }
  return { ok: true, metadata: { muxer, audioEncoder, videoEncoder } };
}

export function createFfmpegEngine(runner: ProbeRunner = runProbeCommand): ConversionEngineAdapter {
  return {
    id: 'ffmpeg',
    name: 'FFmpeg',
    handler: 'media',
    supportedPlatforms: ['win32', 'linux', 'darwin'],
    executableCandidates: ['ffmpeg'],
    profile: 'media',
    approximateInstalledSizeMb: 180,
    defaultWorkerCategory: 'media',
    concurrencyLimit: 2,
    validateOutput: validateRegisteredOutput,
    probe: () => {
      const ffmpeg = resolveTool('ffmpeg');
      const ffprobe = resolveTool('ffprobe');
      if (!ffmpeg.available || !ffprobe.available) {
        return {
          available: false,
          reason: 'Install the media profile to provide matching FFmpeg and ffprobe binaries',
        };
      }
      const result = runner(ffmpeg.path, ['-hide_banner', '-version'], 10_000);
      return {
        available: result.ok,
        executablePath: ffmpeg.path,
        version: firstProbeLine(result) || ffmpeg.version,
        reason: result.ok
          ? undefined
          : safeProbeReason('FFmpeg', result, 'FFmpeg is not installed'),
      };
    },
    discoverCapabilities: (probe) => {
      let caps: FfmpegCapabilityLists = {
        demuxers: new Set(),
        muxers: new Set(),
        decoders: new Set(),
        encoders: new Set(),
      };
      let malformed = false;
      if (probe.available && probe.executablePath) {
        const results = {
          demuxers: runner(probe.executablePath, ['-hide_banner', '-demuxers'], 10_000),
          muxers: runner(probe.executablePath, ['-hide_banner', '-muxers'], 10_000),
          decoders: runner(probe.executablePath, ['-hide_banner', '-decoders'], 10_000),
          encoders: runner(probe.executablePath, ['-hide_banner', '-encoders'], 10_000),
        };
        caps = parseFfmpegCapabilities({
          demuxers: results.demuxers.stdout,
          muxers: results.muxers.stdout,
          decoders: results.decoders.stdout,
          encoders: results.encoders.stdout,
        });
        malformed =
          !results.demuxers.ok ||
          !results.muxers.ok ||
          !results.decoders.ok ||
          !results.encoders.ok ||
          caps.demuxers.size === 0 ||
          caps.muxers.size === 0 ||
          caps.decoders.size === 0 ||
          caps.encoders.size === 0;
      }

      const routes: EngineRouteCandidate[] = [];
      for (const [input, outputs] of Object.entries(SAFE_PAIRS)) {
        for (const output of outputs) {
          const outputFamily = formatFamily(output);
          const inputCheck = supportsInput(INPUT_POLICY[input], outputFamily, caps);
          const outputCheck = supportsOutput(OUTPUT_POLICY[output], caps);
          const supported = probe.available && !malformed && inputCheck.ok && outputCheck.ok;
          routes.push({
            input,
            output,
            inputFamily: formatFamily(input),
            outputFamily,
            priority: 20,
            cost: outputFamily === 'audio' ? 'medium' : 'high',
            workerCategory: 'media',
            requiredCompanions: ['ffmpeg', 'ffprobe'],
            supported,
            reason: supported
              ? undefined
              : malformed
                ? 'FFmpeg returned incomplete or malformed capability tables'
                : inputCheck.reason || outputCheck.reason,
            metadata: {
              ...outputCheck.metadata,
              demuxer: firstAvailable(caps.demuxers, INPUT_POLICY[input].demuxers),
              inputCodecs: [
                ...(INPUT_POLICY[input].audioDecoders || []),
                ...(INPUT_POLICY[input].videoDecoders || []),
              ].filter((codec) => caps.decoders.has(codec)),
            },
          });
        }
      }
      return {
        readableFormats: probe.available && !malformed
          ? Object.keys(INPUT_POLICY).filter((format) =>
              Boolean(firstAvailable(caps.demuxers, INPUT_POLICY[format].demuxers)),
            )
          : [],
        writableFormats: probe.available && !malformed
          ? Object.keys(OUTPUT_POLICY).filter((format) =>
              Boolean(firstAvailable(caps.muxers, OUTPUT_POLICY[format].muxers)),
            )
          : [],
        routes,
        notes: [
          'Device inputs, image sequences, and unapproved container/codec combinations are denied by policy.',
        ],
      };
    },
  };
}

export const ffmpegEngine = createFfmpegEngine();
