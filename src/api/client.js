import { computeUploadMetrics } from '../lib/liveState.js';
import { createResumableUpload } from './resumableUpload.js';

// Empty means same-origin. In development Vite proxies /api to 127.0.0.1:8787;
// in production the Fastify server serves both dist/ and /api.
const configuredBase = String(import.meta.env.VITE_API_URL || '').trim();
const API_BASE = configuredBase ? configuredBase.replace(/\/$/, '') : '';
const API_TOKEN = String(import.meta.env.VITE_API_TOKEN || '').trim();

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function authHeaders(headers = {}) {
  return {
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    ...headers,
  };
}

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function request(path, options = {}) {
  const url = apiUrl(path);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: authHeaders({
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      }),
    });
  } catch (err) {
    throw new ApiError(err.message || 'Network error — is the API server running?', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  const data = await parseJson(res);
  if (!res.ok) {
    const err = data?.error || {};
    throw new ApiError(err.message || res.statusText || 'Request failed', {
      status: res.status,
      code: err.code || 'HTTP_ERROR',
      details: err.details,
    });
  }
  return data;
}

export const api = {
  base: API_BASE,

  health: () => request('/api/health'),
  version: () => request('/api/version'),
  capabilities: () => request('/api/capabilities'),
  convertMatrix: () => request('/api/convert/matrix'),
  inspect: (uploadIds) =>
    request('/api/inspect', { method: 'POST', body: JSON.stringify({ uploadIds }) }),
  inspectUpload: (id) => request(`/api/uploads/${id}/inspect`),
  stats: () => request('/api/stats'),

  createWorkspace: (body = {}) =>
    request('/api/workspaces', { method: 'POST', body: JSON.stringify(body) }),
  recoverWorkspace: (body = {}) =>
    request('/api/workspaces/recover', { method: 'POST', body: JSON.stringify(body) }),
  getWorkspace: (id) => request(`/api/workspaces/${id}`),
  patchWorkspace: (id, patch) =>
    request(`/api/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  clearWorkspace: (id) => request(`/api/workspaces/${id}/clear`, { method: 'POST' }),
  deleteWorkspace: (id) => request(`/api/workspaces/${id}`, { method: 'DELETE' }),
  removeWorkspaceFile: (workspaceId, fileId) =>
    request(`/api/workspaces/${workspaceId}/files/${fileId}`, { method: 'DELETE' }),
  fileDownloadUrl: (id) => apiUrl(`/api/files/${id}/download`),
  filePreviewUrl: (id) => apiUrl(`/api/files/${id}/preview`),

  workspaceEventsUrl: (id) => apiUrl(`/api/workspaces/${id}/events`),
  listUploadSessions: (workspaceId) =>
    request(`/api/upload-sessions?workspaceId=${encodeURIComponent(workspaceId)}`),
  getUploadSession: (id) => request(`/api/upload-sessions/${id}`),
  pauseUploadSession: (id) => request(`/api/upload-sessions/${id}/pause`, { method: 'POST' }),
  cancelUploadSession: (id) => request(`/api/upload-sessions/${id}`, { method: 'DELETE' }),
  createResumableUpload(file, options = {}) {
    return createResumableUpload(file, options, { request, apiUrl, apiToken: API_TOKEN, ApiError });
  },

  /**
   * Subscribe to workspace SSE. Returns an unsubscribe function.
   * Closes on error or abort; does not auto-reconnect (callers handle backoff).
   * @param {string} id
   * @param {{ onEvent?: (event: any) => void, onError?: (err: Error) => void, onOpen?: () => void, signal?: AbortSignal }} [opts]
   * @returns {() => void}
   */
  subscribeWorkspaceEvents(id, { onEvent, onError, onOpen, signal } = {}) {
    if (!id || (!API_TOKEN && typeof EventSource === 'undefined')) {
      return () => {};
    }
    if (signal?.aborted) {
      return () => {};
    }

    if (API_TOKEN) {
      return subscribeViaFetch(this.workspaceEventsUrl(id), {
        onEvent,
        onError,
        onOpen,
        signal,
      });
    }

    const es = new EventSource(this.workspaceEventsUrl(id));
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      es.close();
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => cleanup();
    signal?.addEventListener('abort', onAbort);

    es.onopen = () => {
      if (!closed) onOpen?.();
    };

    es.onmessage = (ev) => {
      if (closed) return;
      try {
        const event = JSON.parse(ev.data);
        onEvent?.(event);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    es.onerror = () => {
      if (closed) return;
      cleanup();
      onError?.(new ApiError('Workspace SSE connection failed', { code: 'SSE_ERROR' }));
    };

    return cleanup;
  },

  getActivity: (limit = 50) => request(`/api/activity?limit=${limit}`),
  clearActivity: () => request('/api/activity', { method: 'DELETE' }),

  getProfile: () => request('/api/profile'),
  saveProfile: (body) => request('/api/profile', { method: 'PUT', body: JSON.stringify(body) }),

  getSettings: () => request('/api/settings'),
  saveSettings: (settings) =>
    request('/api/settings', { method: 'PUT', body: JSON.stringify({ settings }) }),

  /**
   * Stream file upload. Server returns immediately with quick detect + file id.
   * Does NOT compute a client-side full-file hash (checksum may be null while status=processing).
   * Poll GET /api/uploads/:id if full checksum/deep detect is required.
   *
   * onProgress receives a metrics object:
   *   { loaded, total, percent, speedBps, etaSeconds, startedAt }
   */
  async upload(file, { onProgress, workspaceId } = {}) {
    // XHR for upload progress; workspaceId binds file to persistent workspace
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
      const startedAt = Date.now();
      xhr.open('POST', apiUrl(`/api/uploads${qs}`));
      if (API_TOKEN) xhr.setRequestHeader('Authorization', `Bearer ${API_TOKEN}`);
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !onProgress) return;
        const elapsed = Date.now() - startedAt;
        const metrics = computeUploadMetrics(e.loaded, e.total, elapsed);
        onProgress({ ...metrics, startedAt });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else {
          const err = xhr.response?.error || {};
          reject(
            new ApiError(err.message || 'Upload failed', {
              status: xhr.status,
              code: err.code || 'UPLOAD_FAILED',
              details: err.details,
            }),
          );
        }
      };
      xhr.onerror = () => reject(new ApiError('Upload network error', { code: 'NETWORK_ERROR' }));
      const form = new FormData();
      form.append('file', file, file.name);
      if (workspaceId) form.append('workspaceId', workspaceId);
      xhr.send(form);
    });
  },

  /**
   * Poll until file status is terminal ready/failed/missing or timeout.
   * Used as SSE fallback so inspecting never requires a full page reload.
   */
  async waitForFileReady(id, { intervalMs = 150, timeoutMs = 30_000, signal } = {}) {
    const start = Date.now();
    while (!signal?.aborted) {
      const file = await this.getUpload(id);
      if (file.status === 'ready' && file.checksum) return file;
      if (file.status === 'failed' || file.status === 'missing' || file.status === 'deleted') {
        return file;
      }
      if (Date.now() - start > timeoutMs) {
        throw new ApiError('Timed out waiting for file finalize', { code: 'TIMEOUT' });
      }
      await sleep(intervalMs);
    }
    throw new ApiError('Aborted', { code: 'ABORTED' });
  },

  getUpload: (id) => request(`/api/uploads/${id}`),

  createJob: (body) => request('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  getJob: (id) => request(`/api/jobs/${id}`),
  listJobs: (limit = 50) => request(`/api/jobs?limit=${limit}`),
  cancelJob: (id) => request(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  downloadUrl: (id) => apiUrl(`/api/jobs/${id}/download`),

  /**
   * Poll job until terminal state. Returns final job.
   * Optional onUpdate(job). Optional signal for AbortController.
   */
  async waitForJob(id, { onUpdate, intervalMs = 400, signal } = {}) {
    // Prefer SSE when available
    if (!API_TOKEN && typeof EventSource !== 'undefined' && !signal?.aborted) {
      try {
        return await waitViaSse(id, { onUpdate, signal });
      } catch {
        // fall through to poll
      }
    }
    while (!signal?.aborted) {
      const job = await this.getJob(id);
      onUpdate?.(job);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
      await sleep(intervalMs);
    }
    throw new ApiError('Job wait aborted', { code: 'ABORTED' });
  },

  async runJob(
    type,
    {
      files = [],
      uploadIds: existingIds = [],
      options = {},
      workspaceId,
      onUploadProgress,
      onJobUpdate,
      signal,
    } = {},
  ) {
    let uploadIds = [...existingIds];
    if (!uploadIds.length) {
      for (const file of files) {
        if (signal?.aborted) throw new ApiError('Cancelled', { code: 'ABORTED' });
        const up = await this.upload(file, { onProgress: onUploadProgress, workspaceId });
        uploadIds.push(up.id);
      }
    }
    const job = await this.createJob({ type, uploadIds, options, workspaceId });
    onJobUpdate?.(job);
    const final = await this.waitForJob(job.id, { onUpdate: onJobUpdate, signal });
    if (final.status === 'failed') {
      throw new ApiError(final.error || final.message || 'Job failed', {
        code: 'JOB_FAILED',
        details: final,
      });
    }
    if (final.status === 'cancelled') {
      throw new ApiError('Job cancelled', { code: 'CANCELLED', details: final });
    }
    return final;
  },

  async downloadJob(jobId, filename) {
    return this.downloadPath(`/api/jobs/${jobId}/download`, filename);
  },

  async fetchJobBlob(jobId) {
    const res = await fetch(this.downloadUrl(jobId), { headers: authHeaders() });
    if (!res.ok) throw new ApiError('Could not read job output', { status: res.status });
    return res.blob();
  },

  async fetchJobJson(jobId) {
    const res = await fetch(this.downloadUrl(jobId), { headers: authHeaders() });
    if (!res.ok) throw new ApiError('Could not read job output', { status: res.status });
    return res.json();
  },

  async fetchJobText(jobId) {
    const res = await fetch(this.downloadUrl(jobId), { headers: authHeaders() });
    if (!res.ok) throw new ApiError('Could not read job output', { status: res.status });
    return res.text();
  },

  async downloadPath(path, filename = 'download') {
    const res = await fetch(apiUrl(path), { headers: authHeaders() });
    if (!res.ok) throw new ApiError('Download failed', { status: res.status });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return blob;
  },

  /**
   * Download workspace converter outputs as one ZIP (server-side archive).
   * @param {string} workspaceId
   * @param {{ outputIds?: string[], jobIds?: string[] }} [selection]
   *   Empty / omitted → all valid on-disk outputs for the workspace.
   */
  async downloadOutputsZip(workspaceId, { outputIds, jobIds } = {}) {
    const res = await fetch(apiUrl(`/api/workspaces/${workspaceId}/outputs/download-zip`), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ outputIds, jobIds }),
    });
    if (!res.ok) {
      let message = 'ZIP download failed';
      try {
        const data = await res.json();
        message = data?.error?.message || message;
      } catch {
        /* ignore */
      }
      throw new ApiError(message, { status: res.status, code: 'ZIP_DOWNLOAD_FAILED' });
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alphastudio-outputs.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return blob;
  },
};

function waitViaSse(id, { onUpdate, signal }) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(apiUrl(`/api/jobs/${id}/events`));
    const abort = () => {
      es.close();
      reject(new ApiError('Job wait aborted', { code: 'ABORTED' }));
    };
    signal?.addEventListener('abort', abort);
    es.onmessage = (ev) => {
      try {
        const job = JSON.parse(ev.data);
        onUpdate?.(job);
        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
          es.close();
          signal?.removeEventListener('abort', abort);
          resolve(job);
        }
      } catch (e) {
        es.close();
        reject(e);
      }
    };
    es.onerror = () => {
      es.close();
      signal?.removeEventListener('abort', abort);
      reject(new ApiError('SSE connection failed', { code: 'SSE_ERROR' }));
    };
  });
}

function subscribeViaFetch(url, { onEvent, onError, onOpen, signal }) {
  const controller = new AbortController();
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    signal?.removeEventListener('abort', cleanup);
  };
  signal?.addEventListener('abort', cleanup);

  void (async () => {
    try {
      const res = await fetch(url, {
        headers: authHeaders({ Accept: 'text/event-stream' }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new ApiError('Workspace SSE connection failed', {
          status: res.status,
          code: 'SSE_ERROR',
        });
      }
      onOpen?.();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const payload = chunk
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!payload) continue;
          onEvent?.(JSON.parse(payload));
        }
      }
      if (!closed) throw new ApiError('Workspace SSE connection closed', { code: 'SSE_ERROR' });
    } catch (err) {
      if (!closed && err?.name !== 'AbortError') {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      cleanup();
    }
  })();

  return cleanup;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isUnavailable(err) {
  return err?.code === 'UNAVAILABLE' || err?.status === 503;
}
