import { useCallback, useEffect, useRef, useState } from 'react';
import { api, createClientRequestId, isUnavailable } from '../api/client';

/** PDF workspace storage key — only PdfView should pass this with autoResume:true */
export const PDF_ACTIVE_JOB_KEY = 'alphastudio.pdf.activeJobId';

/**
 * Shared job runner: upload → create → progress → download helpers.
 * Optional resume-after-reload via sessionStorage + waitForJob (SSE → poll).
 *
 * Defaults are safe for all tools: no auto-resume and no sessionStorage writes.
 * Callers that need resume (e.g. PdfView) must opt in explicitly:
 *   useJobRunner(notify, { storageKey: PDF_ACTIVE_JOB_KEY, autoResume: true, expectedJobType: 'pdf' })
 */
export default function useJobRunner(
  notify,
  {
    storageKey = null,
    autoResume = false,
    expectedJobType = null,
    restoreRecentCompleted = false,
  } = {},
) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [job, setJob] = useState(null);
  const abortRef = useRef(null);
  const resumedRef = useRef(false);
  const runPromiseRef = useRef(null);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

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

  // Mount-time resume: reattach to active job without creating a duplicate.
  // Only runs when autoResume is explicitly true AND a storageKey is set.
  useEffect(() => {
    if (!autoResume || !storageKey || resumedRef.current) return;
    resumedRef.current = true;
    if (typeof sessionStorage === 'undefined') return;
    let id = null;
    try {
      id = sessionStorage.getItem(storageKey);
    } catch {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!id) {
          if (!restoreRecentCompleted) return;
          const recent = await api.listJobs(50);
          if (cancelled) return;
          const completed = recent?.jobs?.find(
            (candidate) =>
              candidate.status === 'completed' &&
              (!expectedJobType || candidate.type === expectedJobType) &&
              candidate.downloadUrl,
          );
          if (completed) {
            setJob(completed);
            setProgress(100);
            setStatus(completed.message || completed.status);
          }
          return;
        }
        const existing = await api.getJob(id);
        if (cancelled) return;
        // Do not steal another tool's job (e.g. ImageView must never resume a PDF job)
        if (expectedJobType && existing.type && existing.type !== expectedJobType) {
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* ignore */
          }
          return;
        }
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
      abortRef.current?.abort();
    };
  }, [
    autoResume,
    storageKey,
    expectedJobType,
    restoreRecentCompleted,
    attachToJob,
    persistJobId,
  ]);

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
    (type, {
      files = [],
      uploadIds = [],
      options = {},
      workspaceId,
      autoDownload = false,
      clientRequestId,
    } = {}) => {
      if (runPromiseRef.current) return runPromiseRef.current;
      const actionRequestId = clientRequestId || createClientRequestId();
      const task = (async () => {
      setBusy(true);
      setProgress(0);
      setStatus('Starting…');
      setJob(null);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        let finalUploadIds = [...uploadIds];
        if (!finalUploadIds.length && files.length) {
          for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
            const file = files[fileIndex];
            if (ac.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORTED' });
            const up = await api.upload(file, {
              onProgress: (m) => {
                const pct = typeof m === 'number' ? m : m?.percent ?? 0;
                const aggregate = ((fileIndex * 100) + pct) / files.length;
                setProgress((previous) => Math.max(previous, Math.round(aggregate * 0.3)));
                setStatus(`Uploading… ${Math.round(aggregate)}%`);
              },
              workspaceId,
              signal: ac.signal,
            });
            if (ac.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORTED' });
            finalUploadIds.push(up.id);
          }
        }
        if (ac.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORTED' });
        const created = await api.createJob(
          {
            type,
            uploadIds: finalUploadIds,
            options,
            workspaceId,
            clientRequestId: actionRequestId,
          },
          { signal: ac.signal },
        );
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
      })();
      runPromiseRef.current = task;
      void task.finally(() => {
        if (runPromiseRef.current === task) runPromiseRef.current = null;
      }).catch(() => {});
      return task;
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

/** @deprecated use PDF_ACTIVE_JOB_KEY */
export const ACTIVE_JOB_KEY = PDF_ACTIVE_JOB_KEY;
