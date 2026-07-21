import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isUnavailable } from '../api/client';

const ACTIVE_JOB_KEY = 'alphastudio.pdf.activeJobId';

/**
 * Shared job runner: upload → create → progress → download helpers.
 * Supports resume-after-reload via sessionStorage + waitForJob (SSE → poll).
 */
export default function useJobRunner(notify, { storageKey = ACTIVE_JOB_KEY, autoResume = true } = {}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [job, setJob] = useState(null);
  const abortRef = useRef(null);
  const resumedRef = useRef(false);

  const persistJobId = useCallback(
    (id) => {
      if (!storageKey || typeof sessionStorage === 'undefined') return;
      try {
        if (id) sessionStorage.setItem(storageKey, id);
        else sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const applyJobUpdate = useCallback((j, { fromUpload = false } = {}) => {
    setJob(j);
    if (fromUpload) {
      setProgress(Math.round((j.progress || 0) * 0.3));
    } else {
      // Map server 0–100 into remaining band after optional upload
      const p = Number(j.progress) || 0;
      setProgress(Math.min(99, Math.max(0, Math.round(p))));
    }
    setStatus(j.message || j.status || '');
  }, []);

  const attachToJob = useCallback(
    async (jobId, { signal, autoDownload = false } = {}) => {
      if (!jobId) throw new Error('jobId required');
      setBusy(true);
      setStatus('Reconnecting…');
      persistJobId(jobId);
      const ac = signal ? null : new AbortController();
      const activeSignal = signal || ac.signal;
      if (!signal) abortRef.current = ac;
      try {
        // Snapshot current state first (reload may already be completed)
        let current = await api.getJob(jobId);
        applyJobUpdate(current);
        if (!['completed', 'failed', 'cancelled'].includes(current.status)) {
          current = await api.waitForJob(jobId, {
            onUpdate: (j) => applyJobUpdate(j),
            signal: activeSignal,
          });
        }
        setJob(current);
        if (current.status === 'completed') {
          setProgress(100);
          setStatus(current.status);
          persistJobId(null);
          if (autoDownload && current.downloadUrl) {
            await api.downloadJob(current.id, current.outputName);
            notify?.(`Done — ${current.outputName || 'download'} downloaded`);
          } else {
            notify?.(`Done — ${current.outputName || 'output'} is ready`);
          }
        } else if (current.status === 'failed') {
          persistJobId(null);
          setStatus(current.error || current.message || 'failed');
          throw Object.assign(new Error(current.error || current.message || 'Job failed'), {
            code: current.errorCode || 'JOB_FAILED',
          });
        } else if (current.status === 'cancelled') {
          persistJobId(null);
          notify?.('Cancelled');
          throw Object.assign(new Error('Job cancelled'), { code: 'CANCELLED' });
        }
        return current;
      } catch (err) {
        if (isUnavailable(err)) {
          notify?.(`Unavailable: ${err.message}`);
        } else if (err.code === 'CANCELLED' || err.code === 'ABORTED') {
          notify?.('Cancelled');
        } else if (err.code !== 'JOB_FAILED') {
          notify?.(err.message || 'Operation failed');
        } else {
          notify?.(err.message || 'Job failed');
        }
        throw err;
      } finally {
        setBusy(false);
        if (!signal) abortRef.current = null;
      }
    },
    [applyJobUpdate, notify, persistJobId],
  );

  // Mount-time resume: reattach to active job without creating a duplicate
  useEffect(() => {
    if (!autoResume || resumedRef.current) return;
    resumedRef.current = true;
    if (typeof sessionStorage === 'undefined') return;
    let id = null;
    try {
      id = sessionStorage.getItem(storageKey);
    } catch {
      return;
    }
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const existing = await api.getJob(id);
        if (cancelled) return;
        if (['completed', 'failed', 'cancelled'].includes(existing.status)) {
          setJob(existing);
          if (existing.status === 'completed') {
            setProgress(100);
            setStatus(existing.status);
          } else {
            setStatus(existing.error || existing.message || existing.status);
          }
          persistJobId(null);
          return;
        }
        // Still running/queued — reattach progress stream (no new job)
        await attachToJob(id);
      } catch {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoResume, storageKey, attachToJob, persistJobId]);

  const cancel = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    if (job?.id) {
      try {
        await api.cancelJob(job.id);
        notify?.('Job cancel requested');
      } catch {
        /* ignore */
      }
    }
  }, [job, notify]);

  const run = useCallback(
    async (type, { files = [], uploadIds = [], options = {}, workspaceId, autoDownload = false } = {}) => {
      setBusy(true);
      setProgress(0);
      setStatus('Starting…');
      setJob(null);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        let finalUploadIds = [...uploadIds];
        if (!finalUploadIds.length && files.length) {
          for (const file of files) {
            if (ac.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORTED' });
            const up = await api.upload(file, {
              onProgress: (m) => {
                const pct = typeof m === 'number' ? m : m?.percent ?? 0;
                setProgress(Math.round(pct * 0.3));
                setStatus(`Uploading… ${pct}%`);
              },
              workspaceId,
            });
            finalUploadIds.push(up.id);
          }
        }
        const created = await api.createJob({
          type,
          uploadIds: finalUploadIds,
          options,
          workspaceId,
        });
        setJob(created);
        persistJobId(created.id);
        setProgress(30);
        setStatus(created.message || created.status || 'Queued');

        // Reuse attach path (SSE → poll) so reload/resume and live run share one code path
        const final = await api.waitForJob(created.id, {
          onUpdate: (j) => {
            setJob(j);
            const p = Number(j.progress) || 0;
            setProgress(Math.min(99, 30 + Math.round(p * 0.7)));
            setStatus(j.message || j.status);
          },
          signal: ac.signal,
        });
        setJob(final);
        if (final.status === 'completed') {
          setProgress(100);
          setStatus(final.status);
          persistJobId(null);
          if (autoDownload && final.downloadUrl) {
            await api.downloadJob(final.id, final.outputName);
            notify?.(`Done — ${final.outputName || 'download'} downloaded`);
          } else {
            notify?.(`Done — ${final.outputName || 'output'} is ready`);
          }
          return final;
        }
        if (final.status === 'failed') {
          persistJobId(null);
          throw Object.assign(new Error(final.error || final.message || 'Job failed'), {
            code: final.errorCode || 'JOB_FAILED',
            details: final,
          });
        }
        persistJobId(null);
        throw Object.assign(new Error('Job cancelled'), { code: 'CANCELLED', details: final });
      } catch (err) {
        if (isUnavailable(err)) {
          notify?.(`Unavailable: ${err.message}`);
        } else if (err.code === 'CANCELLED' || err.code === 'ABORTED') {
          notify?.('Cancelled');
        } else {
          notify?.(err.message || 'Operation failed');
        }
        throw err;
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [notify, persistJobId],
  );

  return {
    busy,
    progress,
    status,
    job,
    run,
    cancel,
    /** Reattach to an existing job id (no create). Used after reload. */
    resume: attachToJob,
    setJob,
  };
}

export { ACTIVE_JOB_KEY };
