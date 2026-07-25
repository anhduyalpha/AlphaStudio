import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { classifyJobResult } from '../lib/jobResultKind';

/**
 * Load a completed job output as an object URL (auth-safe for <img>/<audio>).
 * Revokes previous URL on change/unmount.
 */
export default function useJobPreviewUrl(job, { enabled } = {}) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const jobId = job?.id;
  const status = job?.status;
  const auto = enabled == null ? classifyJobResult(job) === 'image' : Boolean(enabled);
  const ready = status === 'completed' && Boolean(jobId) && auto;

  useEffect(() => {
    if (!ready) {
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setError(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const blob = await api.fetchJobBlob(jobId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Preview failed');
          setUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [jobId, status, ready]);

  return { url, error, loading };
}
