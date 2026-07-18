import { useEffect, useState } from 'react';
import { api } from '../api/client';

let cache = null;

export default function useCapabilities() {
  const [caps, setCaps] = useState(cache);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    if (cache) {
      setCaps(cache);
      setLoading(false);
    }
    api
      .capabilities()
      .then((data) => {
        if (!alive) return;
        cache = data;
        setCaps(data);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const isAvailable = (toolId) => {
    if (!caps?.tools) return null; // unknown until loaded
    const t = caps.tools.find((x) => x.id === toolId);
    return t ? t.available : false;
  };

  const reason = (toolId) => {
    const t = caps?.tools?.find((x) => x.id === toolId);
    return t?.reason || null;
  };

  return { caps, loading, error, isAvailable, reason, refresh: () => { cache = null; } };
}
