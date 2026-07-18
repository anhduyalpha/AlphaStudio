/**
 * Pure helpers for realtime file/job list state.
 * Upsert-by-id, ordered merge — unit-testable without DOM.
 */

/** UI status labels for file cards */
export const FILE_UI_STATUS = {
  waiting: 'Waiting',
  uploading: 'Uploading',
  paused: 'Paused',
  retrying: 'Retrying',
  finalizing: 'Finalizing',
  inspecting: 'Inspecting',
  ready: 'Ready',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  'upload-failed': 'Upload failed',
  'conversion-failed': 'Conversion failed',
  cancelled: 'Cancelled',
};

/**
 * Map server file.status / job status to UI label key.
 * Prefer linked job when present; file.processing → inspecting; distinguish
 * upload-failed vs conversion-failed when possible.
 *
 * On reload, job may only be known via hydrate `jobs[].options._uploadIds`
 * (PublicFile has no jobId). Callers should pass that resolved job here.
 * Terminal uiStatus (completed/conversion-failed) is kept when job is absent
 * so completed files do not fall back to ready → Batch.
 */
export function normalizeFileUiStatus(file, job) {
  // Explicit uiStatus from optimistic local rows (waiting/uploading/upload-failed)
  if (file?.localOnly && file?.uiStatus) return file.uiStatus;
  if (file?.uiStatus === 'waiting' || file?.uiStatus === 'uploading') return file.uiStatus;
  if (file?.uiStatus === 'paused' || file?.uiStatus === 'retrying' || file?.uiStatus === 'finalizing') return file.uiStatus;
  if (file?.uiStatus === 'upload-failed') return 'upload-failed';

  if (job) {
    if (job.status === 'queued') return 'queued';
    if (job.status === 'running') return 'processing';
    if (job.status === 'completed') return 'completed';
    if (job.status === 'failed') return 'conversion-failed';
    if (job.status === 'cancelled') return 'cancelled';
  }

  // Terminal conversion reflection without live job object (after activeJobs drop / reload)
  if (file?.uiStatus === 'completed') return 'completed';
  if (file?.uiStatus === 'conversion-failed') return 'conversion-failed';
  if (file?.uiStatus === 'cancelled') return 'cancelled';
  if (file?.jobStatus === 'completed') return 'completed';
  if (file?.jobStatus === 'failed') return 'conversion-failed';
  if (file?.jobStatus === 'cancelled') return 'cancelled';
  if (file?.jobStatus === 'queued') return 'queued';
  if (file?.jobStatus === 'running') return 'processing';

  const s = String(file?.status || '').toLowerCase();
  if (s === 'processing') return 'inspecting';
  if (s === 'ready') return 'ready';
  if (s === 'missing' || s === 'deleted') return 'failed';
  if (s === 'uploading') return 'uploading';
  if (s === 'paused') return 'paused';
  if (s === 'retrying') return 'retrying';
  if (s === 'finalizing') return 'finalizing';
  if (s === 'paused') return 'paused';
  if (s === 'retrying') return 'retrying';
  if (s === 'finalizing') return 'finalizing';
  if (s === 'waiting') return 'waiting';
  if (s === 'failed') {
    // Server file failed during finalize (not a conversion job)
    return file?.jobId || file?.uiStatus === 'conversion-failed'
      ? 'conversion-failed'
      : 'upload-failed';
  }
  if (file?.uiStatus && FILE_UI_STATUS[file.uiStatus]) return file.uiStatus;
  return s || 'waiting';
}

/**
 * Rank for choosing which job owns a file when multiple jobs reference it.
 * Active conversion wins over terminal so re-convert keeps the file in Batch.
 */
export function jobStageRank(job) {
  const s = String(job?.status || '');
  if (s === 'running') return 50;
  if (s === 'queued') return 40;
  if (s === 'failed') return 30;
  if (s === 'cancelled') return 25;
  if (s === 'completed') return 20;
  return 0;
}

function jobTimeMs(job) {
  return (
    Date.parse(job?.updatedAt || job?.updated_at || job?.finishedAt || job?.createdAt || 0) || 0
  );
}

/**
 * Index jobs by input file id using options._uploadIds / uploadIds.
 * PublicFile DTOs do not carry jobId — hydrate only has this reverse link.
 * @param {Array|{[id:string]: object}} jobs
 * @returns {Map<string, object>} fileId → winning job
 */
export function indexJobsByFileId(jobs = []) {
  const list = Array.isArray(jobs)
    ? jobs
    : jobs && typeof jobs === 'object'
      ? Object.values(jobs)
      : [];
  const map = new Map();
  for (const j of list) {
    if (!j) continue;
    const opts = j.options && typeof j.options === 'object' ? j.options : {};
    const ids = opts._uploadIds || opts.uploadIds || j.uploadIds || [];
    if (!Array.isArray(ids)) continue;
    for (const raw of ids) {
      const fid = String(raw || '');
      if (!fid) continue;
      const prev = map.get(fid);
      if (!prev) {
        map.set(fid, j);
        continue;
      }
      const pr = jobStageRank(prev);
      const nr = jobStageRank(j);
      if (nr > pr || (nr === pr && jobTimeMs(j) >= jobTimeMs(prev))) {
        map.set(fid, j);
      }
    }
  }
  return map;
}

/**
 * Resolve the job that owns a file for stage placement.
 * Prefers explicit f.jobId in jobsById, else reverse index via _uploadIds.
 */
export function resolveJobForFile(file, jobsByIdOrList = {}) {
  if (!file?.id) return null;
  const jobsById = Array.isArray(jobsByIdOrList)
    ? Object.fromEntries(
        jobsByIdOrList.filter((j) => j?.id).map((j) => [String(j.id), j]),
      )
    : jobsByIdOrList || {};
  if (file.jobId && jobsById[file.jobId]) return jobsById[file.jobId];
  if (file.jobId && jobsById[String(file.jobId)]) return jobsById[String(file.jobId)];
  const byFile = indexJobsByFileId(jobsByIdOrList);
  return byFile.get(String(file.id)) || null;
}

/** Stage membership: Input panel only. */
export const INPUT_STAGE_STATUSES = new Set([
  'waiting',
  'uploading',
  'paused',
  'retrying',
  'finalizing',
  'inspecting',
  'upload-failed',
  'failed', // legacy upload fail without job
]);

/** Stage membership: Batch / converter group panel. */
export const BATCH_STAGE_STATUSES = new Set([
  'ready',
  'queued',
  'processing',
  'conversion-failed',
  'cancelled',
]);

/** Stage membership: Converted Files (jobs completed only when filtering). */
export const CONVERTED_JOB_STATUSES = new Set(['completed']);

/**
 * Exclusive stage for a file given optional linked job.
 * @returns {'input'|'batch'|'converted'|'hidden'}
 */
export function fileStage(file, job = null) {
  const linked =
    job ||
    (file?.jobId || file?.jobStatus
      ? { id: file.jobId, status: file.jobStatus || file.uiStatus }
      : null);
  const ui = normalizeFileUiStatus(file, linked);
  if (ui === 'completed') return 'converted'; // file left batch; job row owns Converted
  if (INPUT_STAGE_STATUSES.has(ui)) {
    // "failed" without job is upload-failed → input; with conversion job → batch
    if (ui === 'failed' && (linked || file?.jobId)) return 'batch';
    return 'input';
  }
  if (BATCH_STAGE_STATUSES.has(ui)) return 'batch';
  if (ui === 'completed') return 'converted';
  return 'hidden';
}

/**
 * Partition files into exclusive Input / Batch lists (never both).
 * Converted is job-based; completed files are excluded from both.
 *
 * `jobs` may be a map id→job or an array. Jobs are matched to files by
 * `file.jobId` OR `job.options._uploadIds` (required after reload — PublicFile
 * has no jobId).
 */
export function partitionFileStages(files = [], jobs = {}) {
  const input = [];
  const batch = [];
  const byFile = indexJobsByFileId(jobs);
  const jobsById = Array.isArray(jobs)
    ? Object.fromEntries(jobs.filter((j) => j?.id).map((j) => [String(j.id), j]))
    : jobs || {};

  for (const f of files || []) {
    if (!f?.id) continue;
    const job =
      (f.jobId && (jobsById[f.jobId] || jobsById[String(f.jobId)])) ||
      byFile.get(String(f.id)) ||
      null;
    const stage = fileStage(f, job);
    if (stage === 'input') input.push(f);
    else if (stage === 'batch') batch.push(f);
    // converted/hidden: not in file panels
  }
  return { input, batch };
}

/**
 * Enrich server file DTOs with job linkage from hydrate jobs (via _uploadIds).
 * Pure helper used on reload so stage filters and uiStatus match live SSE path.
 */
export function attachJobsToFiles(files = [], jobs = []) {
  const byFile = indexJobsByFileId(jobs);
  return (files || []).map((f) => {
    if (!f?.id) return f;
    const job = byFile.get(String(f.id));
    if (!job) {
      return {
        ...f,
        uiStatus: normalizeFileUiStatus(f, null),
      };
    }
    return {
      ...f,
      jobId: job.id,
      jobStatus: job.status,
      jobProgress: job.progress,
      jobMessage: job.message,
      uiStatus: normalizeFileUiStatus(f, job),
    };
  });
}

/**
 * Upsert an item into a list by stable `id`. Never uses index/filename as key.
 * @template T
 * @param {T[]} list
 * @param {T & { id: string }} item
 * @param {(existing: T, incoming: T) => T} [mergeFn]
 * @returns {T[]}
 */
export function upsertById(list, item, mergeFn) {
  if (!item?.id) return list ? [...list] : [];
  const arr = Array.isArray(list) ? list : [];
  const idx = arr.findIndex((x) => x && String(x.id) === String(item.id));
  if (idx < 0) return [...arr, item];
  const next = [...arr];
  const existing = next[idx];
  next[idx] = mergeFn ? mergeFn(existing, item) : { ...existing, ...item };
  return next;
}

/**
 * Compare event/order tokens. Higher version wins; if equal, later updatedAt wins.
 * Returns true if `incoming` should replace `current`.
 */
export function isNewerEvent(current, incoming) {
  if (!current) return true;
  if (!incoming) return false;
  const cv = Number(current.version ?? current.seq ?? 0);
  const iv = Number(incoming.version ?? incoming.seq ?? 0);
  if (Number.isFinite(iv) && Number.isFinite(cv) && iv !== cv) {
    return iv > cv;
  }
  const ct = Date.parse(current.updatedAt || current.updated_at || 0) || 0;
  const it = Date.parse(incoming.updatedAt || incoming.updated_at || 0) || 0;
  if (it !== ct) return it >= ct;
  // Same timestamp: prefer higher progress for same entity
  const cp = Number(current.progress ?? 0);
  const ip = Number(incoming.progress ?? 0);
  if (ip !== cp) return ip >= cp;
  return true; // equal → allow idempotent refresh
}

/**
 * Merge a progress/status event into a map keyed by entity id.
 * Drops stale events (older version/updatedAt).
 */
export function mergeProgressEvent(map, event, idKey = 'id') {
  const id = event?.[idKey] || event?.fileId || event?.jobId;
  if (!id) return map;
  const prev = map[id] || map[String(id)];
  if (prev && !isNewerEvent(prev, event)) return map;
  return { ...map, [String(id)]: { ...prev, ...event, id: String(id) } };
}

/**
 * Merge workspace snapshot (authoritative) with live local state.
 * - Snapshot files/jobs are base
 * - Live-only optimistic rows (waiting/uploading without server counterpart) kept if not contradicted
 * - For same id, pick newer by version/updatedAt
 */
export function mergeWorkspaceSnapshot(liveFiles, snapshotFiles, liveMeta = {}) {
  void liveMeta;
  const byId = new Map();
  for (const f of snapshotFiles || []) {
    if (f?.id) {
      const id = String(f.id);
      byId.set(id, {
        ...f,
        id,
        uiStatus: f.uiStatus || normalizeFileUiStatus(f, null),
      });
    }
  }
  for (const f of liveFiles || []) {
    if (!f?.id) continue;
    const id = String(f.id);
    const snap = byId.get(id);
    if (!snap) {
      // Optimistic local-only (waiting/uploading) — no server counterpart yet
      if (f.localOnly || f.uiStatus === 'waiting' || f.uiStatus === 'uploading') {
        byId.set(id, f);
      }
      continue;
    }

    const snapStatus = String(snap.status || '').toLowerCase();
    // Server terminal status is authoritative on reconnect (same id → one row, ready wins).
    if (['ready', 'missing', 'deleted', 'failed'].includes(snapStatus)) {
      byId.set(id, {
        ...f,
        ...snap,
        id,
        localOnly: false,
        // Drop optimistic uiStatus so normalize recomputes from server status
        uiStatus: normalizeFileUiStatus({ ...snap, uiStatus: undefined }, null),
      });
      continue;
    }

    // Prefer newer of the two for in-flight / non-terminal rows
    const liveEvt = {
      version: f.version ?? f.eventVersion,
      updatedAt: f.updatedAt || f.updated_at,
      progress: f.uploadProgress ?? f.progress,
    };
    const snapEvt = {
      version: snap.version ?? snap.eventVersion,
      updatedAt: snap.updatedAt || snap.updated_at,
      progress: snap.uploadProgress ?? snap.progress,
    };
    if (isNewerEvent(snapEvt, liveEvt) && (f.uiStatus === 'uploading' || f.localProgress)) {
      // Keep live upload metrics on top of snapshot identity
      byId.set(id, {
        ...snap,
        ...f,
        id,
        detect: f.detect || snap.detect,
        status: snap.status || f.status,
        originalName: snap.originalName || f.originalName,
      });
    } else if (!isNewerEvent(liveEvt, snapEvt)) {
      byId.set(id, {
        ...f,
        ...snap,
        id,
        uiStatus: snap.uiStatus || normalizeFileUiStatus(snap, null) || f.uiStatus,
      });
    } else {
      byId.set(id, {
        ...snap,
        ...f,
        id,
        detect: snap.detect || f.detect,
        uiStatus: f.uiStatus || snap.uiStatus || normalizeFileUiStatus(f, null),
      });
    }
  }
  // Stable order: createdAt then id (never order by filename — duplicates allowed across ids)
  return [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a.createdAt || a.created_at || 0) || 0;
    const tb = Date.parse(b.createdAt || b.created_at || 0) || 0;
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Compute upload metrics from loaded/total and elapsed ms.
 */
export function computeUploadMetrics(loaded, total, elapsedMs) {
  const t = Math.max(0, Number(total) || 0);
  const l = Math.max(0, Math.min(Number(loaded) || 0, t || Number(loaded) || 0));
  const pct = t > 0 ? Math.min(100, Math.round((l / t) * 100)) : 0;
  const sec = Math.max(0.001, (Number(elapsedMs) || 0) / 1000);
  const speed = l / sec; // bytes/s
  const remaining = t > l && speed > 0 ? (t - l) / speed : 0;
  return {
    loaded: l,
    total: t,
    percent: pct,
    speedBps: speed,
    etaSeconds: remaining,
  };
}

export function formatSpeed(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return '—';
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}

/**
 * Normalize a workspace SSE event payload to a standard shape.
 */
export function normalizeWorkspaceEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type || raw.event || 'unknown';
  return {
    type,
    workspaceId: raw.workspaceId || raw.workspace_id || null,
    fileId: raw.fileId || raw.file_id || raw.file?.id || null,
    jobId: raw.jobId || raw.job_id || raw.job?.id || null,
    status: raw.status || raw.file?.status || raw.job?.status || null,
    stage: raw.stage || raw.message || null,
    progress: raw.progress != null ? Number(raw.progress) : null,
    processedBytes: raw.processedBytes ?? raw.processed_bytes ?? null,
    message: raw.message || null,
    updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString(),
    version: raw.version ?? raw.seq ?? null,
    file: raw.file || null,
    job: raw.job || null,
    payload: raw,
  };
}

/**
 * Apply a normalized workspace event to file list + job map.
 * file.deleted / status deleted|missing → remove id from list (never re-upsert ghosts).
 */
export function applyWorkspaceEvent(state, event) {
  const ev = normalizeWorkspaceEvent(event);
  if (!ev) return state;
  let files = state.files || [];
  let jobs = { ...(state.jobs || {}) };

  const isDelete =
    ev.type === 'file.deleted' ||
    ev.type === 'file.removed' ||
    ev.status === 'deleted' ||
    ev.status === 'missing' ||
    ev.file?.status === 'deleted' ||
    ev.file?.status === 'missing';

  if (isDelete && (ev.fileId || ev.file?.id)) {
    const dropId = String(ev.fileId || ev.file.id);
    files = files.filter((f) => f && String(f.id) !== dropId);
    return { ...state, files, jobs };
  }

  if (
    ev.file ||
    (ev.fileId &&
      (ev.type === 'file' ||
        ev.type === 'file.updated' ||
        ev.type === 'file.created'))
  ) {
    const f = ev.file || { id: ev.fileId, status: ev.status };
    if (f.id) {
      // Never resurrect deleted/missing via upsert path
      if (f.status === 'deleted' || f.status === 'missing') {
        files = files.filter((x) => x && String(x.id) !== String(f.id));
      } else {
        files = upsertById(
          files,
          {
            ...f,
            version: ev.version ?? f.version,
            updatedAt: ev.updatedAt || f.updatedAt,
            uiStatus: normalizeFileUiStatus(f, null),
          },
          (existing, incoming) => {
            if (!isNewerEvent(existing, incoming)) return existing;
            return {
              ...existing,
              ...incoming,
              detect: incoming.detect || existing.detect,
            };
          },
        );
      }
    }
  }

  if (ev.job || (ev.jobId && (ev.type === 'job' || ev.type === 'job.updated' || ev.type === 'job.progress'))) {
    const j = ev.job || {
      id: ev.jobId,
      status: ev.status,
      progress: ev.progress,
      message: ev.message,
      updatedAt: ev.updatedAt,
      version: ev.version,
    };
    if (j.id) {
      const prev = jobs[j.id];
      if (!prev || isNewerEvent(prev, { ...j, updatedAt: j.updatedAt || ev.updatedAt, version: j.version ?? ev.version })) {
        jobs[j.id] = { ...prev, ...j, updatedAt: j.updatedAt || ev.updatedAt, version: j.version ?? ev.version };
      }
      // Reflect processing on input files if linked
      const ids = j.options?._uploadIds || j.options?.uploadIds || [];
      if (ids.length && ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(j.status)) {
        for (const fid of ids) {
          const uiStatus = normalizeFileUiStatus(null, j);
          files = upsertById(files, {
            id: fid,
            uiStatus,
            jobId: j.id,
            jobStatus: j.status,
            jobProgress: j.progress,
            jobMessage: j.message,
            updatedAt: ev.updatedAt,
            version: ev.version,
          }, (existing, incoming) => {
            // Prefer higher event version; if versions reset after restart, allow newer updatedAt
            if (!isNewerEvent(existing, incoming)) return existing;
            return {
              ...existing,
              ...incoming,
              detect: existing.detect,
              status: existing.status, // keep server file status (ready)
            };
          });
        }
      }
    }
  }

  return { ...state, files, jobs };
}
