/**
 * Classify a completed job for typed result rendering.
 * Pure helpers — no React, safe for unit/struct tests.
 */

export function getJobMime(job) {
  return String(job?.outputMime || job?.mime || job?.meta?.mime || '').toLowerCase();
}

export function getJobName(job) {
  return String(job?.outputName || job?.meta?.outputName || '');
}

/** @returns {'image'|'text'|'json'|'binary'|'unknown'} */
export function getJobMediaClass(job) {
  const mime = getJobMime(job);
  const name = getJobName(job).toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|ico)$/i.test(name)) {
    return 'image';
  }
  if (
    mime.startsWith('text/')
    || mime.includes('json')
    || /\.(txt|md|csv|json|log)$/i.test(name)
  ) {
    if (mime.includes('json') || name.endsWith('.json')) return 'json';
    return 'text';
  }
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'binary';
  if (mime.includes('zip') || mime.includes('gzip') || /\.(zip|7z|tar|gz|tgz)$/i.test(name)) {
    return 'binary';
  }
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'binary';
  return 'unknown';
}

/**
 * Narrow JSON report kinds from payload shape + job options.
 * @param {object|null} data
 * @param {object} [job]
 */
export function classifyJsonPayload(data, job = null) {
  if (!data || typeof data !== 'object') return 'json';
  if (data.password != null && data.length != null) return 'password';
  if (data.algorithms && typeof data.algorithms === 'object' && !Array.isArray(data.algorithms)) {
    return 'hash';
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'match')
    && (data.expected != null || data.actual != null)
    && data.algorithm
  ) {
    return 'checksum-compare';
  }
  if (data.magicHex != null || (data.detectedMime != null && data.extension != null && Object.prototype.hasOwnProperty.call(data, 'match'))) {
    return 'signature';
  }
  if (data.image && (data.size != null || data.mime != null) && data.name != null) {
    return 'metadata';
  }
  if (Array.isArray(data.entries) || Array.isArray(data.files) || Array.isArray(data.contents)) {
    return 'archive-listing';
  }
  if (Array.isArray(data.streams) || data.format?.format_name || data.duration != null && data.streams) {
    return 'media-inspect';
  }
  if (data.streams && typeof data.streams === 'object') return 'media-inspect';
  if (data.digest || data.uuids) return 'json';
  const op = String(job?.options?.operation || job?.meta?.operation || '').toLowerCase();
  if (op === 'hash' || op === 'checksum') return 'hash';
  if (op === 'compare' && job?.type === 'security') return 'checksum-compare';
  if (op === 'password') return 'password';
  if (op === 'signature' || op === 'magic') return 'signature';
  if (op === 'metadata') return 'metadata';
  if (op === 'inspect' && (job?.type === 'archive' || job?.tool === 'archive')) return 'archive-listing';
  if (op === 'inspect' && (job?.type === 'media' || job?.tool === 'media')) return 'media-inspect';
  return 'json';
}

/**
 * Top-level kind for UI routing before payload fetch.
 * @returns {'image'|'text'|'json'|'download'}
 */
export function classifyJobResult(job) {
  if (!job || job.status !== 'completed') return 'download';
  const media = getJobMediaClass(job);
  if (media === 'image') return 'image';
  if (media === 'json') return 'json';
  if (media === 'text') return 'text';
  return 'download';
}

export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
