import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

let cache = null;

export default function useCapabilities() {
  const [caps, setCaps] = useState(cache);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!cache);
  const requestRef = useRef(0);

  const load = useCallback(async ({ refresh = false } = {}) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const data = await api.capabilities({ refresh });
      if (requestId !== requestRef.current) return null;
      cache = data;
      setCaps(data);
      setError(null);
      return data;
    } catch (err) {
      if (requestId === requestRef.current) setError(err);
      throw err;
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cache) {
      setCaps(cache);
      setLoading(false);
    }
    void load().catch(() => {});
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const isAvailable = (toolId) => {
    if (!caps?.tools) return null; // unknown until loaded
    const t = caps.tools.find((x) => x.id === toolId);
    return t ? t.available : false;
  };

  const reason = (toolId) => {
    const t = caps?.tools?.find((x) => x.id === toolId);
    return t?.reason || null;
  };

  const refresh = useCallback(() => {
    cache = null;
    return load({ refresh: true });
  }, [load]);

  return { caps, loading, error, isAvailable, reason, refresh };
}
