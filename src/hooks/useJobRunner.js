import { useCallback, useRef, useState } from 'react';
import { api, isUnavailable } from '../api/client';

/**
 * Shared job runner: upload → create → progress → download helpers.
 */
export default function useJobRunner(notify) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [job, setJob] = useState(null);
  const abortRef = useRef(null);

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
        const final = await api.runJob(type, {
          files,
          uploadIds,
          options,
          workspaceId,
          signal: ac.signal,
          onUploadProgress: (m) => {
            const pct = typeof m === 'number' ? m : m?.percent ?? 0;
            setProgress(Math.round(pct * 0.3));
            setStatus(`Uploading… ${pct}%`);
          },
          onJobUpdate: (j) => {
            setJob(j);
            setProgress(30 + Math.round((j.progress || 0) * 0.7));
            setStatus(j.message || j.status);
          },
        });
        setJob(final);
        setProgress(100);
        setStatus(final.status);
        if (autoDownload && final.status === 'completed' && final.downloadUrl) {
          await api.downloadJob(final.id, final.outputName);
          notify?.(`Done — ${final.outputName || 'download'} downloaded`);
        } else if (final.status === 'completed') {
          notify?.(`Done — ${final.outputName || 'output'} is ready`);
        }
        return final;
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
    [notify],
  );

  return { busy, progress, status, job, run, cancel };
}
