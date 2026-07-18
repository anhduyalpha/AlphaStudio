const STORAGE_PREFIX = 'alphastudio:upload';

function storageKey(file, workspaceId) {
  return `${STORAGE_PREFIX}:${workspaceId}:${file.name}:${file.size}:${file.lastModified}:${file.type || ''}`;
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* SQLite remains authoritative. */ }
}

function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore unavailable storage */ }
}

async function sha256Hex(blob, ApiError) {
  if (!globalThis.crypto?.subtle) {
    throw new ApiError('Resumable upload requires Web Crypto SHA-256 support', { code: 'UNAVAILABLE' });
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function uploadChunkXhr(runtime, input) {
  let xhr;
  const promise = new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open('PUT', runtime.apiUrl(`/api/upload-sessions/${encodeURIComponent(input.sessionId)}/chunks/${input.index}`));
    if (runtime.apiToken) xhr.setRequestHeader('Authorization', `Bearer ${runtime.apiToken}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Content-Range', `bytes ${input.start}-${input.end}/${input.total}`);
    xhr.setRequestHeader('X-Chunk-SHA256', input.checksum);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => input.onProgress?.(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else {
        const err = xhr.response?.error || {};
        reject(new runtime.ApiError(err.message || 'Chunk upload failed', {
          status: xhr.status,
          code: err.code || 'UPLOAD_FAILED',
          details: err.details,
        }));
      }
    };
    xhr.onerror = () => reject(new runtime.ApiError('Chunk upload network error', { code: 'NETWORK_ERROR' }));
    xhr.onabort = () => reject(new runtime.ApiError('Chunk upload paused', { code: 'PAUSED' }));
    xhr.send(input.blob);
  });
  return { promise, abort: () => xhr?.abort() };
}

/** A controller owns one durable server session and one bounded in-flight chunk. */
class ResumableUploadController {
  constructor(file, options, runtime) {
    this.file = file;
    this.workspaceId = options.workspaceId;
    this.onProgress = options.onProgress;
    this.onState = options.onState;
    this.runtime = runtime;
    this.session = null;
    this.paused = false;
    this.cancelled = false;
    this.inflight = null;
    this.running = null;
    this.key = storageKey(file, this.workspaceId);
  }

  async ensureSession() {
    const savedId = storageGet(this.key);
    if (savedId) {
      try {
        const saved = await this.runtime.request(`/api/upload-sessions/${encodeURIComponent(savedId)}`);
        if (saved.originalName === this.file.name && saved.size === this.file.size && saved.status !== 'completed') {
          this.session = saved;
        } else {
          storageRemove(this.key);
        }
      } catch (err) {
        if (err?.status === 404) storageRemove(this.key);
        else throw err;
      }
    }
    if (!this.session) {
      this.session = await this.runtime.request('/api/upload-sessions/init', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: this.workspaceId,
          originalName: this.file.name,
          size: this.file.size,
          mime: this.file.type || null,
        }),
      });
      storageSet(this.key, this.session.id);
    }
    return this.session;
  }

  start() {
    if (this.running) return this.running;
    this.paused = false;
    this.cancelled = false;
    this.running = this.run().finally(() => {
      this.running = null;
      this.inflight = null;
    });
    return this.running;
  }

  async run() {
    let session = await this.ensureSession();
    if (session.status === 'paused' || session.status === 'failed') {
      session = await this.runtime.request(`/api/upload-sessions/${session.id}/resume`, { method: 'POST' });
      this.session = session;
    }
    const received = new Set(session.receivedChunks || []);
    let committedBytes = Number(session.receivedBytes || 0);
    const runStarted = Date.now();
    const runBaseBytes = committedBytes;
    this.onState?.('uploading', session);
    this.emitProgress(committedBytes, runBaseBytes, runStarted);

    for (let index = 0; index < session.totalChunks; index += 1) {
      if (received.has(index)) continue;
      if (this.paused) throw new this.runtime.ApiError('Upload paused', { code: 'PAUSED' });
      if (this.cancelled) throw new this.runtime.ApiError('Upload cancelled', { code: 'CANCELLED' });
      const start = index * session.chunkSize;
      const endExclusive = Math.min(this.file.size, start + session.chunkSize);
      const blob = this.file.slice(start, endExclusive);
      const checksum = await sha256Hex(blob, this.runtime.ApiError);
      if (this.paused) throw new this.runtime.ApiError('Upload paused', { code: 'PAUSED' });
      const transfer = uploadChunkXhr(this.runtime, {
        sessionId: session.id,
        index,
        blob,
        start,
        end: endExclusive - 1,
        total: this.file.size,
        checksum,
        onProgress: (chunkLoaded) => this.emitProgress(committedBytes + chunkLoaded, runBaseBytes, runStarted),
      });
      this.inflight = transfer;
      const result = await transfer.promise;
      this.inflight = null;
      session = result.session || session;
      this.session = session;
      committedBytes = Number(session.receivedBytes ?? endExclusive);
      this.emitProgress(committedBytes, runBaseBytes, runStarted);
    }

    if (this.paused) throw new this.runtime.ApiError('Upload paused', { code: 'PAUSED' });
    this.onState?.('finalizing', session);
    const finalized = await this.runtime.request(`/api/upload-sessions/${session.id}/finalize`, { method: 'POST' });
    this.session = finalized.session;
    storageRemove(this.key);
    this.emitProgress(this.file.size, runBaseBytes, runStarted);
    this.onState?.('completed', finalized.session);
    return finalized.file;
  }

  emitProgress(loaded, runBaseBytes, runStarted) {
    const elapsedSeconds = Math.max(0.001, (Date.now() - runStarted) / 1000);
    const speedBps = Math.max(0, loaded - runBaseBytes) / elapsedSeconds;
    this.onProgress?.({
      loaded,
      total: this.file.size,
      percent: this.file.size ? Math.min(100, Math.round((loaded / this.file.size) * 100)) : 0,
      speedBps,
      etaSeconds: speedBps > 0 ? Math.max(0, this.file.size - loaded) / speedBps : 0,
      startedAt: runStarted,
    });
  }

  async pause() {
    this.paused = true;
    this.inflight?.abort();
    if (this.session?.id) {
      try {
        this.session = await this.runtime.request(`/api/upload-sessions/${this.session.id}/pause`, { method: 'POST' });
      } catch (err) {
        if (err?.code !== 'UPLOAD_CONFLICT') throw err;
      }
    }
    this.onState?.('paused', this.session);
    return this.session;
  }

  async cancel() {
    this.cancelled = true;
    this.inflight?.abort();
    if (this.session?.id) {
      await this.runtime.request(`/api/upload-sessions/${this.session.id}`, { method: 'DELETE' });
    }
    storageRemove(this.key);
    this.onState?.('cancelled', this.session);
  }
}

export function createResumableUpload(file, options, runtime) {
  return new ResumableUploadController(file, options || {}, runtime);
}
