import { badRequest } from '../lib/errors.js';
import { isToolAvailable } from '../capabilities.js';
import { unavailable } from '../lib/errors.js';
import type { Processor } from './types.js';

/**
 * Lazy processor loaders — heavy modules (sharp, pdf-lib, ffmpeg wrappers, converters)
 * are only imported when a job of that type actually runs.
 */
const processorLoaders: Record<string, () => Promise<Processor>> = {
  text: async () => (await import('./text.js')).processText,
  image: async () => (await import('./image.js')).processImage,
  qr: async () => (await import('./qr.js')).processQr,
  pdf: async () => (await import('./pdf.js')).processPdf,
  archive: async () => (await import('./archive.js')).processArchive,
  security: async () => (await import('./security.js')).processSecurity,
  media: async () => (await import('./media.js')).processMedia,
  audio: async () => {
    const { processMedia } = await import('./media.js');
    return async (ctx) => processMedia({ ...ctx, options: { ...ctx.options, family: 'audio' } });
  },
  converter: async () => (await import('./converter.js')).processConverter,
};

const loaded: Partial<Record<string, Processor>> = {};

/** Map job type + options.operation to capability id for gating */
export function capabilityIdFor(type: string, options: Record<string, unknown>): string | null {
  const op = String(options.operation || '');
  const map: Record<string, string> = {
    'text:format-json': 'text.format-json',
    'text:base64-encode': 'text.base64',
    'text:base64-decode': 'text.base64',
    'text:url-encode': 'text.url',
    'text:url-decode': 'text.url',
    'text:hash': 'text.hash',
    'text:cleanup': 'text.cleanup',
    'qr:generate': 'qr.generate',
    'qr:decode': 'qr.decode',
    'image:resize': 'image.resize',
    'image:crop': 'image.crop',
    'image:rotate': 'image.rotate',
    'image:convert': 'image.convert',
    'image:compress': 'image.compress',
    'image:optimize': 'image.compress',
    'image:strip-metadata': 'image.strip-metadata',
    'pdf:merge': 'pdf.merge',
    'pdf:split': 'pdf.split',
    'pdf:rotate': 'pdf.rotate',
    'pdf:reorder': 'pdf.reorder',
    'pdf:compress': 'pdf.compress.structural',
    'pdf:compress-structural': 'pdf.compress.structural',
    'pdf:compress-advanced': 'pdf.compress.advanced',
    'pdf:extract': 'pdf.extract',
    'pdf:delete-pages': 'pdf.delete-pages',
    'pdf:duplicate-pages': 'pdf.duplicate-pages',
    'pdf:to-images': 'pdf.to-images',
    'pdf:to-text': 'pdf.to-text',
    'pdf:extract-text': 'pdf.to-text',
    'pdf:ocr': 'pdf.ocr',
    'pdf:inspect': 'pdf.inspect',
    'pdf:repair': 'pdf.repair',
    'pdf:from-images': 'pdf.from-images',
    'archive:create': 'archive.zip',
    'archive:extract': 'archive.zip',
    'security:hash': 'security.hash',
    'security:checksum': 'security.hash',
    'security:signature': 'security.signature',
    'security:magic': 'security.signature',
    'security:metadata': 'security.metadata',
    'media:inspect': 'media.inspect',
    'media:trim': 'media.trim',
    'media:transcode': 'media.transcode',
    'media:convert': 'media.transcode',
    'media:extract-audio': 'media.extract-audio',
    'audio:convert': 'audio.convert',
    'audio:trim': 'audio.trim',
    'audio:normalize': 'audio.normalize',
    'converter:batch': 'converter.batch',
  };

  if (type === 'converter') return 'converter.batch';
  if (type === 'archive') {
    const format = String(options.format || 'zip').toLowerCase();
    if (format === '7z') return 'archive.7z';
    if (format === 'tar') return 'archive.tar';
    if (format === 'gz' || format === 'gzip') return 'archive.gz';
    return 'archive.zip';
  }
  return map[`${type}:${op}`] || null;
}

export async function getProcessor(type: string): Promise<Processor> {
  const cached = loaded[type];
  if (cached) return cached;
  const load = processorLoaders[type];
  if (!load) throw badRequest(`Unknown job type: ${type}`);
  const proc = await load();
  loaded[type] = proc;
  return proc;
}

export function assertJobCapable(type: string, options: Record<string, unknown>): void {
  const capId = capabilityIdFor(type, options);
  if (!capId) return;
  const { available, reason } = isToolAvailable(capId);
  if (!available) throw unavailable(capId, reason);
}

export * from './types.js';
