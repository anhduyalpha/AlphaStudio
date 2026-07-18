import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const STORAGE_KEY = 'alphastudio-workspace-id';

/**
 * Persistent workspace: only the opaque id is stored in localStorage.
 * All files/settings/jobs live in SQLite on the server.
 */
export default function useWorkspace({ route, notify } = {}) {
  const [workspaceId, setWorkspaceId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [hydrated, setHydrated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(null);
  const hydrating = useRef(false);

  const persistId = useCallback((id) => {
    setWorkspaceId(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const hydrate = useCallback(async () => {
    if (hydrating.current) return null;
    hydrating.current = true;
    setLoading(true);
    try {
      const data = await api.recoverWorkspace({
        id: localStorage.getItem(STORAGE_KEY) || undefined,
        route: route || 'dashboard',
      });
      persistId(data.id);
      setHydrated(data);
      return data;
    } catch (err) {
      notify?.(err.message || 'Failed to restore workspace');
      // create fresh
      try {
        const created = await api.createWorkspace({ route: route || 'dashboard' });
        const data = await api.getWorkspace(created.id);
        persistId(data.id);
        setHydrated(data);
        return data;
      } catch (e2) {
        notify?.(e2.message || 'Workspace unavailable');
        setHydrated(null);
        return null;
      }
    } finally {
      setLoading(false);
      hydrating.current = false;
    }
  }, [notify, persistId, route]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const save = useCallback(
    (patch, { debounceMs = 400 } = {}) => {
      if (!workspaceId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          const data = await api.patchWorkspace(workspaceId, patch);
          setHydrated(data);
        } catch (err) {
          notify?.(err.message || 'Autosave failed');
        } finally {
          setSaving(false);
        }
      }, debounceMs);
    },
    [workspaceId, notify],
  );

  const saveNow = useCallback(
    async (patch) => {
      if (!workspaceId) return null;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      try {
        const data = await api.patchWorkspace(workspaceId, patch);
        setHydrated(data);
        return data;
      } catch (err) {
        notify?.(err.message || 'Save failed');
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [workspaceId, notify],
  );

  const refresh = useCallback(async () => {
    if (!workspaceId) return hydrate();
    setLoading(true);
    try {
      const data = await api.getWorkspace(workspaceId);
      setHydrated(data);
      return data;
    } catch (err) {
      notify?.(err.message || 'Refresh failed');
      return hydrate();
    } finally {
      setLoading(false);
    }
  }, [workspaceId, hydrate, notify]);

  const clear = useCallback(async () => {
    if (!workspaceId) return;
    const data = await api.clearWorkspace(workspaceId);
    setHydrated(data);
    return data;
  }, [workspaceId]);

  const newWorkspace = useCallback(async () => {
    const created = await api.createWorkspace({ route: route || 'dashboard' });
    persistId(created.id);
    const data = await api.getWorkspace(created.id);
    setHydrated(data);
    return data;
  }, [persistId, route]);

  const removeFile = useCallback(
    async (fileId) => {
      if (!workspaceId) return;
      const data = await api.removeWorkspaceFile(workspaceId, fileId);
      setHydrated(data);
      return data;
    },
    [workspaceId],
  );

  return {
    workspaceId,
    hydrated,
    loading,
    saving,
    hydrate,
    refresh,
    save,
    saveNow,
    clear,
    newWorkspace,
    removeFile,
    setHydrated,
  };
}
