import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import FilePicker from '../components/FilePicker';
import EmptyState from '../components/EmptyState';
import {
  PrimaryButton,
  SecondaryButton,
  SelectField,
  StatusBadge,
  ToggleRow,
  Panel,
} from '../components/Common';
import { WorkspaceHeader, WorkbenchLayout, ProgressWave, ResultPanel } from '../components/Workbench';
import { FileRow } from '../components/StudioPrimitives';
import useWorkspace from '../hooks/useWorkspace';
import useWorkspaceEvents from '../hooks/useWorkspaceEvents';
import { api } from '../api/client';
import {
  applyResultVisibility,
  applySettingsToCompatible,
  buildConversionGroups,
  buildResultRows,
  canConvertGroup,
  defaultGroupSettings,
  engineForOutput,
  hasActiveDuplicateJob,
  jobTouchesFileIds,
  sharedTargetsAcrossGroups,
} from '../lib/converterGroups';
import {
  applyWorkspaceEvent,
  attachJobsToFiles,
  computeUploadMetrics,
  FILE_UI_STATUS,
  formatEta,
  formatSpeed,
  mergeWorkspaceSnapshot,
  normalizeFileUiStatus,
  partitionFileStages,
  upsertById,
} from '../lib/liveState';

/**
 * Professional All-in-One Converter:
 * detect → group → batch/per-card panels → Converted Files results.
 * State persists via SQLite workspace hydrate (not React-only).
 *
 * Upload path: optimistic per-file cards (local id) → parallel XHR uploads with
 * live % / speed / ETA → replace with server id on 201. Never waits on a single
 * getWorkspace snapshot that can be cancelled by effect cleanup.
 */
const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;

export default function ConverterView({ notify }) {
  const {
    workspaceId,
    hydrated,
    loading: workspaceLoading,
    saving,
    save,
    saveNow,
    clear,
    newWorkspace,
    removeFile,
    refresh,
  } = useWorkspace({ route: 'converter', notify });

  const [serverFiles, setServerFiles] = useState([]);
  const [groupSettings, setGroupSettings] = useState({});
  const [hydratedOnce, setHydratedOnce] = useState(false);
  const [activeJobs, setActiveJobs] = useState({}); // jobId -> job public
  const [convertingKeys, setConvertingKeys] = useState(() => new Set());
  // Keep queued/running rows visible so progress and the finished file occupy
  // one stable Converted Files location instead of jumping between panels.
  const [resultFilter, setResultFilter] = useState({ status: 'all', format: 'all', sort: 'newest' });
  const [selectedResultIds, setSelectedResultIds] = useState(() => new Set());
  const [hideCompleted, setHideCompleted] = useState(false);
  const [hiddenResultIds, setHiddenResultIds] = useState(() => []);
  const [zipBusy, setZipBusy] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const submitGuard = useRef(new Set()); // groupKey|format in-flight
  const jobGroupKeysRef = useRef(new Map()); // jobId -> group id
  const activeJobsRef = useRef(activeJobs);
  activeJobsRef.current = activeJobs;
  const serverFilesRef = useRef(serverFiles);
  serverFilesRef.current = serverFiles;
  const startedFilesRef = useRef(new WeakSet());
  const uploadControllersRef = useRef(new Map());
  const mountedRef = useRef(true);
  const terminalRefreshPendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const entry of uploadControllersRef.current.values()) {
        void entry.controller.pause().catch(() => {});
      }
    };
  }, []);

  // Live workspace SSE
  const onWorkspaceLiveEvent = useCallback((raw) => {
    const next = applyWorkspaceEvent(
      { files: serverFilesRef.current, jobs: activeJobsRef.current },
      raw,
    );
    serverFilesRef.current = next.files;
    activeJobsRef.current = next.jobs;
    setServerFiles(next.files);
    setActiveJobs(next.jobs);

    const status = raw?.job?.status || raw?.status;
    if (!['completed', 'failed', 'cancelled'].includes(status)) return;
    const terminalJobId = raw?.job?.id || raw?.jobId || raw?.id;
    const terminalGroupId = terminalJobId ? jobGroupKeysRef.current.get(terminalJobId) : null;
    if (terminalGroupId) {
      setConvertingKeys((prev) => {
        const nextKeys = new Set(prev);
        nextKeys.delete(terminalGroupId);
        return nextKeys;
      });
      jobGroupKeysRef.current.delete(terminalJobId);
    }

    // Backend registers the output before emitting the terminal event. Hydrate
    // that authoritative row immediately so Converted Files receives the real
    // output id/name/download URL without a page reload or a fake delay.
    if (terminalRefreshPendingRef.current) return;
    terminalRefreshPendingRef.current = true;
    void refresh()
      .then((data) => {
        if (!mountedRef.current || !data) return;
        const enriched = attachJobsToFiles(data.files || [], data.jobs || []);
        setServerFiles((prev) => {
          const merged = mergeWorkspaceSnapshot(prev, enriched);
          serverFilesRef.current = merged;
          return merged;
        });
        const running = Object.fromEntries(
          (data.jobs || [])
            .filter((job) => ['queued', 'running'].includes(job.status))
            .map((job) => [job.id, job]),
        );
        activeJobsRef.current = running;
        setActiveJobs(running);
        submitGuard.current.clear();
      })
      .catch(() => {
        /* polling/reconnect will retry */
      })
      .finally(() => {
        terminalRefreshPendingRef.current = false;
      });
  }, [refresh]);

  const onWorkspaceReconnect = useCallback(async () => {
    try {
      const data = await refresh();
      if (!data) return;
      // Re-attach jobs via _uploadIds so completed files stay out of Batch
      const enriched = attachJobsToFiles(data.files || [], data.jobs || []);
      setServerFiles((prev) => mergeWorkspaceSnapshot(prev, enriched));
      const jobs = { ...activeJobsRef.current };
      for (const j of data.jobs || []) {
        if (['queued', 'running'].includes(j.status)) jobs[j.id] = j;
        // Drop from active if terminal
        if (['completed', 'failed', 'cancelled'].includes(j.status)) {
          delete jobs[j.id];
        }
      }
      activeJobsRef.current = jobs;
      setActiveJobs(jobs);
    } catch {
      /* ignore reconnect snapshot errors */
    }
  }, [refresh]);

  // Subscribe as soon as we have a workspace id (before/during finalization)
  useWorkspaceEvents(workspaceId, {
    enabled: Boolean(workspaceId),
    onEvent: onWorkspaceLiveEvent,
    onReconnect: onWorkspaceReconnect,
  });

  // ── Hydrate from SQLite workspace (once). Later merges happen on refresh/SSE reconnect. ──
  useEffect(() => {
    if (!hydrated || hydratedOnce) return;

    // Link jobs → files via options._uploadIds (PublicFile has no jobId on reload)
    const snapFiles = attachJobsToFiles(hydrated.files || [], hydrated.jobs || []);
    setServerFiles((prev) => mergeWorkspaceSnapshot(prev, snapFiles));

    const conv = hydrated.toolSettings?.converter || {};
    const perGroup =
      conv.groupSettings && typeof conv.groupSettings === 'object' ? conv.groupSettings : {};
    setGroupSettings(perGroup);
    setHideCompleted(Boolean(conv.hideCompleted));
    setHiddenResultIds(Array.isArray(conv.hiddenResultIds) ? conv.hiddenResultIds.map(String) : []);
    if (hydrated.ui?.converterResultFilter && typeof hydrated.ui.converterResultFilter === 'object') {
      setResultFilter((f) => ({ ...f, ...hydrated.ui.converterResultFilter }));
    }

    // Poll only active jobs; terminal jobs still used for stage placement via hydrated.jobs
    const jobs = {};
    for (const j of hydrated.jobs || []) {
      if (['queued', 'running'].includes(j.status)) jobs[j.id] = j;
    }
    activeJobsRef.current = jobs;
    setActiveJobs(jobs);
    setHydratedOnce(true);
  }, [hydrated, hydratedOnce]);

  // SQLite owns resumable state. A reload loses the browser File handle, so
  // pause active sessions and show persisted bytes until the file is reselected.
  useEffect(() => {
    if (!workspaceId || !hydratedOnce) return;
    let cancelled = false;
    void api.listUploadSessions(workspaceId).then(async ({ sessions = [] } = {}) => {
      const rows = [];
      for (const raw of Array.isArray(sessions) ? sessions : []) {
        let session = raw;
        if (session.status === 'uploading') {
          try { session = await api.pauseUploadSession(session.id); }
          catch { session = await api.getUploadSession(session.id); }
        }
        rows.push({
          id: `session-${session.id}`,
          uploadSessionId: session.id,
          localOnly: true,
          resumableMissingFile: true,
          originalName: session.originalName,
          size: session.size,
          mime: session.mime || null,
          status: session.status,
          uiStatus: session.status === 'failed' ? 'upload-failed' : 'paused',
          uploadProgress: session.size ? Math.round((Number(session.receivedBytes || 0) / session.size) * 100) : 0,
          loaded: Number(session.receivedBytes || 0),
          total: session.size,
          speedBps: 0,
          etaSeconds: 0,
          error: session.lastError || null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      }
      if (!cancelled && mountedRef.current && rows.length) {
        setServerFiles((prev) => rows.reduce((next, row) => upsertById(next, row), prev));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId, hydratedOnce]);

  // All jobs known to the workspace: active (live) + hydrate snapshot (completed/failed).
  // Required so completed files leave Batch after reload when f.jobId is absent.
  const jobsForStages = useMemo(() => {
    const map = { ...activeJobs };
    for (const j of hydrated?.jobs || []) {
      if (j?.id && !map[j.id]) map[j.id] = j;
    }
    return map;
  }, [activeJobs, hydrated?.jobs]);

  // Exclusive stage partition: Input vs Batch (never both); completed leave both
  const stageLists = useMemo(
    () => partitionFileStages(serverFiles, jobsForStages),
    [serverFiles, jobsForStages],
  );
  const inputStageFiles = stageLists.input;
  const batchStageFiles = stageLists.batch;

  // Group only batch-stage files (ready / queued / processing / conversion-failed)
  const grouping = useMemo(
    () =>
      buildConversionGroups(
        batchStageFiles.filter(
          (f) =>
            !f.localOnly &&
            f.status !== 'failed' &&
            f.uiStatus !== 'conversion-failed' &&
            f.uiStatus !== 'cancelled',
        ),
      ),
    [batchStageFiles],
  );

  useEffect(() => {
    if (!grouping.groups.length) {
      setSelectedGroupId(null);
      return;
    }
    if (!selectedGroupId || !grouping.groups.some((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(grouping.groups[0].id);
    }
  }, [grouping.groups, selectedGroupId]);

  const selectedGroup = useMemo(
    () => grouping.groups.find((g) => g.id === selectedGroupId) || grouping.groups[0] || null,
    [grouping.groups, selectedGroupId],
  );

  // Ensure each group has settings once detected
  useEffect(() => {
    if (!grouping.groups.length) return;
    setGroupSettings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of grouping.groups) {
        if (!next[g.id]) {
          next[g.id] = defaultGroupSettings(g);
          changed = true;
        } else if (!next[g.id].format && g.recommendedOutput) {
          next[g.id] = { ...next[g.id], format: g.recommendedOutput };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [grouping.groups]);

  // Persist group settings + selection + result visibility
  useEffect(() => {
    if (!workspaceId || !hydratedOnce) return;
    const selectedFileIds = serverFiles
      .filter((f) => !f.localOnly && !String(f.id).startsWith('local-'))
      .map((f) => f.id);
    save({
      route: 'converter',
      selectedFileIds,
      toolSettings: {
        converter: {
          groupSettings,
          hideCompleted,
          hiddenResultIds,
          // legacy single-format fields for older clients
          format: grouping.groups[0] ? groupSettings[grouping.groups[0].id]?.format : '',
          quality: grouping.groups[0] ? groupSettings[grouping.groups[0].id]?.quality : 'balanced',
          preserveMetadata: grouping.groups[0]
            ? groupSettings[grouping.groups[0].id]?.preserveMetadata !== false
            : true,
        },
      },
      ui: {
        converterResultFilter: resultFilter,
      },
    });
  }, [
    workspaceId,
    hydratedOnce,
    groupSettings,
    serverFiles,
    save,
    grouping.groups,
    resultFilter,
    hideCompleted,
    hiddenResultIds,
  ]);

  // Poll active jobs for progress (SSE is primary; poll is fallback)
  useEffect(() => {
    const ids = Object.keys(activeJobs).filter((id) => {
      const s = activeJobs[id]?.status;
      return s === 'queued' || s === 'running';
    });
    if (!ids.length) return undefined;
    let cancelled = false;
    const tick = async () => {
      for (const id of ids) {
        if (cancelled) return;
        try {
          const j = await api.getJob(id);
          setActiveJobs((prev) => {
            const next = { ...prev, [id]: j };
            activeJobsRef.current = next;
            return next;
          });
          // Reflect job progress on linked input files
          const uploadIds = j.options?._uploadIds || j.options?.uploadIds || [];
          if (uploadIds.length) {
            setServerFiles((prev) => {
              let next = prev;
              for (const fid of uploadIds) {
                next = upsertById(next, {
                  id: fid,
                  uiStatus: normalizeFileUiStatus(null, j),
                  jobId: j.id,
                  jobProgress: j.progress,
                  jobMessage: j.message,
                  updatedAt: j.updatedAt || new Date().toISOString(),
                });
              }
              return next;
            });
          }
          if (['completed', 'failed', 'cancelled'].includes(j.status)) {
            const terminalGroupId = jobGroupKeysRef.current.get(id);
            setConvertingKeys((prev) => {
              const n = new Set(prev);
              if (terminalGroupId) n.delete(terminalGroupId);
              return n;
            });
            jobGroupKeysRef.current.delete(id);
            submitGuard.current.clear();
            const data = await refresh();
            if (data) {
              const enriched = attachJobsToFiles(data.files || [], data.jobs || []);
              setServerFiles((prev) => {
                const merged = mergeWorkspaceSnapshot(prev, enriched);
                serverFilesRef.current = merged;
                return merged;
              });
              const running = Object.fromEntries(
                (data.jobs || [])
                  .filter((job) => ['queued', 'running'].includes(job.status))
                  .map((job) => [job.id, job]),
              );
              activeJobsRef.current = running;
              setActiveJobs(running);
            }
          }
        } catch {
          /* ignore poll errors */
        }
      }
    };
    const t = setInterval(tick, 500);
    tick();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeJobs, refresh]);

  // Terminal events can race with a hydrate/SSE reconnect. Never leave the UI
  // locked when the authoritative active-job map has no queued/running jobs.
  useEffect(() => {
    const hasActiveJob = Object.values(activeJobs).some((job) =>
      ['queued', 'running'].includes(job.status),
    );
    const hasPendingCreateRequest = submitGuard.current.size > 0;
    if (!hasActiveJob && !hasPendingCreateRequest && convertingKeys.size > 0) {
      setConvertingKeys(new Set());
      jobGroupKeysRef.current.clear();
    }
  }, [activeJobs, convertingKeys.size]);

  /**
   * Upload one File with optimistic card + live progress.
   * Never gated by effect cleanup — success always upserts by server id.
   */
  const uploadOne = useCallback(
    async (file) => {
      if (!workspaceId) return null;

      const localId = `local-${
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      }`;
      const now = new Date().toISOString();

      // Optimistic row: waiting → uploading
      setServerFiles((prev) =>
        upsertById(prev, {
          id: localId,
          localOnly: true,
          originalName: file.name,
          size: file.size,
          mime: file.type || null,
          status: 'waiting',
          uiStatus: 'waiting',
          uploadProgress: 0,
          speedBps: 0,
          etaSeconds: 0,
          createdAt: now,
          updatedAt: now,
        }),
      );

      // Flip to uploading immediately before XHR starts
      setServerFiles((prev) =>
        upsertById(prev, {
          id: localId,
          status: 'uploading',
          uiStatus: 'uploading',
          updatedAt: new Date().toISOString(),
        }),
      );

      try {
        const onProgress = (m) => {
            const metrics =
              typeof m === 'number'
                ? computeUploadMetrics(0, file.size, 0)
                : m && typeof m === 'object'
                  ? m
                  : computeUploadMetrics(0, file.size, 0);
            const percent =
              typeof m === 'number'
                ? m
                : metrics.percent ?? 0;
            if (!mountedRef.current) return;
            setServerFiles((prev) =>
              upsertById(prev, {
                id: localId,
                uiStatus: 'uploading',
                status: 'uploading',
                localOnly: true,
                localProgress: true,
                uploadProgress: percent,
                loaded: metrics.loaded,
                total: metrics.total ?? file.size,
                speedBps: metrics.speedBps ?? 0,
                etaSeconds: metrics.etaSeconds ?? 0,
                updatedAt: new Date().toISOString(),
              }),
            );
          };
        let up;
        if (file.size >= RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
          const controller = api.createResumableUpload(file, {
            workspaceId,
            onProgress,
            onState: (state, session) => {
              if (!mountedRef.current) return;
              setServerFiles((prev) => {
                const next = session?.id ? prev.filter((row) => row.id !== `session-${session.id}`) : prev;
                return upsertById(next, {
                  id: localId,
                  uploadSessionId: session?.id || null,
                  status: state,
                  uiStatus: state,
                  localOnly: true,
                  resumableMissingFile: false,
                  updatedAt: new Date().toISOString(),
                });
              });
            },
          });
          uploadControllersRef.current.set(localId, { controller, file });
          up = await controller.start();
        } else {
          up = await api.upload(file, { workspaceId, onProgress });
        }

        // Remove local card; upsert server file by real id
        const uiStatus = normalizeFileUiStatus(
          { ...up, uiStatus: undefined },
          null,
        );
        setServerFiles((prev) => {
          const withoutLocal = prev.filter((f) => f.id !== localId);
          return upsertById(withoutLocal, {
            ...up,
            localOnly: false,
            uiStatus:
              uiStatus === 'waiting' || !uiStatus
                ? up.status === 'ready'
                  ? 'ready'
                  : 'inspecting'
                : uiStatus,
            uploadProgress: 100,
            updatedAt: up.updatedAt || new Date().toISOString(),
          });
        });
        uploadControllersRef.current.delete(localId);

        // SSE is primary; poll as fallback so inspecting becomes ready without reload
        if (up?.id) {
          api.inspect([up.id]).catch(() => {});
          void (async () => {
            try {
              const ready = await api.waitForFileReady(up.id, {
                intervalMs: 200,
                timeoutMs: 60_000,
              });
              if (!mountedRef.current || !ready) return;
              setServerFiles((prev) =>
                upsertById(
                  prev,
                  {
                    ...ready,
                    id: ready.id,
                    localOnly: false,
                    uiStatus: normalizeFileUiStatus(
                      { ...ready, uiStatus: undefined },
                      null,
                    ),
                    updatedAt: ready.updatedAt || new Date().toISOString(),
                  },
                  (existing, incoming) => {
                    // Do not regress a newer SSE event
                    const exT = Date.parse(existing.updatedAt || 0) || 0;
                    const inT = Date.parse(incoming.updatedAt || 0) || 0;
                    if (exT > inT && existing.status === 'ready') return existing;
                    return {
                      ...existing,
                      ...incoming,
                      detect: incoming.detect || existing.detect,
                    };
                  },
                ),
              );
            } catch {
              /* SSE or later poll will recover; do not fake progress */
            }
          })();
        }
        return up;
      } catch (err) {
        if (err?.code === 'PAUSED') return null;
        if (err?.code === 'CANCELLED') {
          uploadControllersRef.current.delete(localId);
          setServerFiles((prev) => prev.filter((f) => f.id !== localId));
          return null;
        }
        if (mountedRef.current) {
          setServerFiles((prev) =>
            upsertById(prev, {
              id: localId,
              uiStatus: 'upload-failed',
              status: 'failed',
              localOnly: true,
              error: err?.message || 'Upload failed',
              updatedAt: new Date().toISOString(),
            }),
          );
          notify(err?.message || `Upload failed: ${file.name}`);
        }
        return null;
      }
    },
    [workspaceId, notify],
  );

  const pauseLocalUpload = useCallback(async (localId) => {
    const entry = uploadControllersRef.current.get(localId);
    if (!entry) return;
    try { await entry.controller.pause(); }
    catch (err) { notify(err?.message || 'Could not pause upload'); }
  }, [notify]);

  const restartLocalUpload = useCallback(async (localId) => {
    const entry = uploadControllersRef.current.get(localId);
    if (!entry?.file) {
      notify('Reselect the same file to resume this persisted upload');
      return;
    }
    uploadControllersRef.current.delete(localId);
    setServerFiles((prev) => prev.filter((file) => file.id !== localId));
    startedFilesRef.current.delete(entry.file);
    await uploadOne(entry.file);
  }, [notify, uploadOne]);

  const cancelLocalUpload = useCallback(async (file) => {
    try {
      const entry = uploadControllersRef.current.get(file.id);
      if (entry) {
        await entry.controller.cancel();
        uploadControllersRef.current.delete(file.id);
      } else if (file.uploadSessionId) {
        await api.cancelUploadSession(file.uploadSessionId);
      }
      setServerFiles((prev) => prev.filter((row) => row.id !== file.id));
    } catch (err) {
      notify(err?.message || 'Could not cancel upload');
    }
  }, [notify]);

  /**
   * Accept new File objects (from dropzone / Add files).
   * Parallel uploads — order independent; upsert by id.
   * WeakSet dedupes Strict Mode double-invoke and FilePicker re-fires.
   */
  const startUploads = useCallback(
    async (incoming) => {
      if (!workspaceId || !hydratedOnce) return;
      const list = Array.isArray(incoming) ? incoming : Array.from(incoming || []);
      const batch = list.filter((f) => f && !startedFilesRef.current.has(f));
      if (!batch.length) return;
      for (const f of batch) startedFilesRef.current.add(f);

      const results = new Array(batch.length);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, batch.length) }, async () => {
        while (cursor < batch.length) {
          const index = cursor;
          cursor += 1;
          results[index] = await uploadOne(batch[index]);
        }
      });
      await Promise.all(workers);
      const ids = serverFilesRef.current
        .filter((f) => !f.localOnly && !String(f.id).startsWith('local-') && f.status !== 'failed')
        .map((f) => f.id);
      // Also include just-uploaded ids that may not have flushed into ref yet
      for (const r of results) {
        if (r?.id && !ids.includes(r.id)) ids.push(r.id);
      }
      if (!ids.length || !mountedRef.current) return;
      try {
        await saveNow({
          route: 'converter',
          selectedFileIds: ids,
          toolSettings: { converter: { groupSettings } },
        });
      } catch {
        /* non-fatal */
      }
    },
    [workspaceId, hydratedOnce, uploadOne, saveNow, groupSettings],
  );

  const updateGroupSetting = (groupId, patch) => {
    setGroupSettings((prev) => ({
      ...prev,
      [groupId]: { ...(prev[groupId] || {}), ...patch },
    }));
  };

  const onApplySettings = (sourceGroupId) => {
    setGroupSettings((prev) => applySettingsToCompatible(prev, grouping.groups, sourceGroupId));
    notify('Settings applied to compatible groups');
  };

  const startGroupConvert = async (group) => {
    const settings = groupSettings[group.id] || defaultGroupSettings(group);
    if (!canConvertGroup(group, settings)) {
      notify('Choose a valid output format for this group');
      return;
    }
    const guardKey = `${group.id}|${settings.format}|${group.fileIds.join(',')}`;
    if (submitGuard.current.has(guardKey)) {
      notify('Conversion already in progress for this selection');
      return;
    }
    const jobs = [...(hydrated?.jobs || []), ...Object.values(activeJobs)];
    if (
      hasActiveDuplicateJob(jobs, {
        uploadIds: group.fileIds,
        format: settings.format,
        type: 'converter',
      })
    ) {
      notify('A matching conversion is already queued or running');
      return;
    }

    submitGuard.current.add(guardKey);
    setConvertingKeys((prev) => new Set(prev).add(group.id));
    try {
      const job = await api.createJob({
        type: 'converter',
        uploadIds: group.fileIds,
        workspaceId,
        options: {
          operation: 'batch',
          format: settings.format,
          quality: settings.quality || 'balanced',
          preserveMetadata: settings.preserveMetadata !== false,
          _uploadIds: group.fileIds,
          inputFormat: group.format,
          inputFamily: group.family,
        },
      });
      jobGroupKeysRef.current.set(job.id, group.id);
      setActiveJobs((prev) => {
        const next = { ...prev, [job.id]: job };
        activeJobsRef.current = next;
        return next;
      });
      // Mark group members as processing immediately
      setServerFiles((prev) => {
        let next = prev;
        for (const fid of group.fileIds) {
          next = upsertById(next, {
            id: fid,
            uiStatus: 'processing',
            jobId: job.id,
            jobProgress: job.progress ?? 0,
          });
        }
        return next;
      });
      notify(`Queued conversion → ${String(settings.format).toUpperCase()}`);
      const data = await refresh();
      if (data?.files) {
        setServerFiles((prev) => mergeWorkspaceSnapshot(prev, data.files || []));
      }
    } catch (err) {
      notify(err.message || 'Could not start conversion');
      setConvertingKeys((prev) => {
        const n = new Set(prev);
        n.delete(group.id);
        return n;
      });
    } finally {
      submitGuard.current.delete(guardKey);
    }
  };

  const cancelGroupJobs = async (group) => {
    // Only cancel jobs whose inputs intersect this group's file ids — never all converter jobs
    const candidates = [
      ...Object.values(activeJobs),
      ...(hydrated?.jobs || []),
    ];
    const seen = new Set();
    let cancelled = 0;
    for (const j of candidates) {
      if (seen.has(j.id)) continue;
      if (!['queued', 'running'].includes(j.status)) continue;
      if (j.type !== 'converter' && j.tool !== 'converter') continue;
      if (!jobTouchesFileIds(j, group.fileIds)) continue;
      seen.add(j.id);
      try {
        await api.cancelJob(j.id);
        cancelled += 1;
      } catch {
        /* ignore */
      }
    }
    setConvertingKeys((prev) => {
      const n = new Set(prev);
      n.delete(group.id);
      return n;
    });
    for (const key of [...submitGuard.current]) {
      if (key.startsWith(`${group.id}|`)) submitGuard.current.delete(key);
    }
    const data = await refresh();
    if (data?.files) {
      const enriched = attachJobsToFiles(data.files || [], data.jobs || []);
      setServerFiles((prev) => mergeWorkspaceSnapshot(prev, enriched));
    }
    notify(cancelled ? `Cancel requested (${cancelled})` : 'No matching active jobs for this group');
  };

  const onRemoveServerFile = async (fileId) => {
    const row = serverFilesRef.current.find((f) => f.id === fileId);
    // Local-only optimistic / failed upload cards — drop without API
    if (row?.localOnly || String(fileId).startsWith('local-')) {
      if (row?.uploadSessionId) {
        await cancelLocalUpload(row);
        return;
      }
      setServerFiles((prev) => prev.filter((f) => f.id !== fileId));
      return;
    }
    try {
      await removeFile(fileId);
      setServerFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch (err) {
      notify(err.message || 'Remove failed');
    }
  };

  const onClear = async () => {
    await clear();
    setServerFiles([]);
    setGroupSettings({});
    activeJobsRef.current = {};
    setActiveJobs({});
    setSelectedResultIds(new Set());
    setHideCompleted(false);
    setHiddenResultIds([]);
    notify('Workspace cleared');
  };

  const onNew = async () => {
    await newWorkspace();
    setHydratedOnce(false);
    setServerFiles([]);
    setGroupSettings({});
    activeJobsRef.current = {};
    setActiveJobs({});
    setSelectedResultIds(new Set());
    setHideCompleted(false);
    setHiddenResultIds([]);
    notify('New workspace started');
  };

  // ── Results list ───────────────────────────────────────────────────────
  const resultRows = useMemo(() => {
    const jobs = (hydrated?.jobs || []).map((j) => ({
      ...j,
      options: typeof j.options === 'object' ? j.options : {},
    }));
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const j of Object.values(activeJobs)) {
      byId.set(j.id, { ...byId.get(j.id), ...j });
    }
    return buildResultRows({
      jobs: [...byId.values()],
      outputs: hydrated?.outputs || [],
      files: serverFiles.filter((f) => !f.localOnly),
    });
  }, [hydrated, activeJobs, serverFiles]);

  const visibleResults = useMemo(
    () =>
      applyResultVisibility(resultRows, {
        ...resultFilter,
        hideCompleted,
        hiddenIds: hiddenResultIds,
      }),
    [resultRows, resultFilter, hideCompleted, hiddenResultIds],
  );

  const formatFilterOptions = useMemo(() => {
    const set = new Set();
    for (const r of resultRows) {
      if (r.outputFormat) set.add(String(r.outputFormat).toLowerCase());
      if (r.inputFormat) set.add(String(r.inputFormat).toLowerCase());
    }
    return [...set].sort();
  }, [resultRows]);

  const toggleSelectResult = (id) => {
    setSelectedResultIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const downloadOne = async (row) => {
    if (!row.downloadUrl && !row.jobId) {
      notify('Output not available for download');
      return;
    }
    try {
      if (row.jobId) {
        await api.downloadJob(row.jobId, row.outputName || 'download');
      } else {
        await api.downloadPath(row.downloadUrl, row.outputName || 'download');
      }
    } catch (err) {
      notify(err.message || 'Download failed');
    }
  };

  const downloadSelectedOrAll = async (mode) => {
    const completed = visibleResults.filter((r) => r.status === 'completed' && (r.downloadUrl || r.jobId));
    const targets =
      mode === 'selected'
        ? completed.filter((r) => selectedResultIds.has(r.id))
        : completed;
    if (!targets.length) {
      notify(mode === 'selected' ? 'Select completed results first' : 'No completed outputs to download');
      return;
    }
    if (targets.length === 1) {
      await downloadOne(targets[0]);
      return;
    }
    setZipBusy(true);
    try {
      await api.downloadOutputsZip(workspaceId, {
        jobIds: targets.map((t) => t.jobId).filter(Boolean),
        outputIds: targets.map((t) => t.outputId).filter(Boolean),
      });
      notify(`Downloaded ZIP of ${targets.length} files`);
    } catch (err) {
      notify(err.message || 'ZIP download failed');
    } finally {
      setZipBusy(false);
    }
  };

  /**
   * Hide completed results from the Converted Files list (persisted).
   * Disk outputs remain until workspace clear/retention; list no longer shows them.
   */
  const clearCompleted = async () => {
    const completedIds = resultRows.filter((r) => r.status === 'completed').map((r) => r.id);
    setHideCompleted(true);
    if (resultFilter.status === 'completed') {
      setResultFilter((f) => ({ ...f, status: 'all' }));
    }
    setSelectedResultIds((prev) => {
      const n = new Set(prev);
      for (const id of completedIds) n.delete(id);
      return n;
    });
    await saveNow({
      toolSettings: {
        converter: {
          groupSettings,
          hideCompleted: true,
          hiddenResultIds,
        },
      },
    });
    notify(
      completedIds.length
        ? `Cleared ${completedIds.length} completed result(s) from the list`
        : 'No completed results to clear',
    );
  };

  /** Remove one result row from the list (persisted hidden id; does not delete disk). */
  const removeResultRow = async (row) => {
    const id = String(row.id || row.jobId);
    const nextHidden = [...new Set([...hiddenResultIds, id])];
    setHiddenResultIds(nextHidden);
    setSelectedResultIds((prev) => {
      const n = new Set(prev);
      n.delete(row.id);
      n.delete(row.jobId);
      return n;
    });
    await saveNow({
      toolSettings: {
        converter: {
          groupSettings,
          hideCompleted,
          hiddenResultIds: nextHidden,
        },
      },
    });
    notify('Result removed from list');
  };

  /**
   * Retry failed conversions. Pass jobIds to retry a subset (per-row Retry);
   * omit to retry all failed currently in resultRows.
   */
  const retryFailed = async (jobIds = null) => {
    let failed = resultRows.filter((r) => r.status === 'failed');
    if (jobIds != null) {
      const want = new Set((Array.isArray(jobIds) ? jobIds : [jobIds]).map(String));
      failed = failed.filter((r) => want.has(String(r.jobId)) || want.has(String(r.id)));
    }
    if (!failed.length) {
      notify(jobIds != null ? 'Nothing to retry for that job' : 'No failed conversions to retry');
      return;
    }
    let n = 0;
    for (const row of failed) {
      const j =
        (hydrated?.jobs || []).find((x) => x.id === row.jobId) ||
        activeJobs[row.jobId] ||
        row;
      const opts = (typeof j.options === 'object' && j.options) || row.options || {};
      const ids = opts._uploadIds || opts.uploadIds || [];
      const format = opts.format || row.outputFormat;
      if (!ids.length || !format) continue;
      try {
        const job = await api.createJob({
          type: 'converter',
          uploadIds: ids,
          workspaceId,
          options: {
            ...opts,
            operation: 'batch',
            format,
            _uploadIds: ids,
          },
        });
        setActiveJobs((prev) => {
          const next = { ...prev, [job.id]: job };
          activeJobsRef.current = next;
          return next;
        });
        n += 1;
      } catch {
        /* skip */
      }
    }
    notify(n ? `Retried ${n} failed conversion(s)` : 'Could not retry — missing input references');
    const data = await refresh();
    if (data?.files) {
      setServerFiles((prev) => mergeWorkspaceSnapshot(prev, data.files || []));
    }
  };

  const sharedTargets = useMemo(
    () => sharedTargetsAcrossGroups(grouping.groups),
    [grouping.groups],
  );

  const displayCount = inputStageFiles.length;
  const uploadingCount = inputStageFiles.filter(
    (f) => f.uiStatus === 'uploading' || f.uiStatus === 'waiting',
  ).length;
  const anyBusy =
    convertingKeys.size > 0 ||
    Object.values(activeJobs).some((j) => ['queued', 'running'].includes(j.status));

  if (workspaceLoading && !hydratedOnce) {
    return (
      <div className="view-stack conversion-board">
        <WorkspaceHeader
          meta="Core tools / Converter"
          title="Restoring workspace…"
          description="Loading files, groups, jobs, and outputs from SQLite."
          family="converter"
        />
        <article className="surface-card content-card">
          <p className="helper-note">Please wait while we hydrate your session…</p>
        </article>
      </div>
    );
  }

  return (
    <div className="view-stack converter-pro conversion-board family-converter" data-testid="conversion-board">
      <WorkspaceHeader
        meta="Core tools / Converter"
        title="Conversion board"
        description="Files and detected groups are the primary surface. Targets, engines, and results stay contextual."
        family="converter"
        status={(
          <StatusBadge tone="purple">
            {displayCount} file{displayCount === 1 ? '' : 's'}
            {anyBusy ? ' · busy' : ''}
          </StatusBadge>
        )}
        actions={
          <>
            <SecondaryButton icon="trash" onClick={onClear} disabled={anyBusy}>
              Clear
            </SecondaryButton>
            <SecondaryButton icon="plus" onClick={onNew} disabled={anyBusy}>
              New workspace
            </SecondaryButton>
            <PrimaryButton
              icon="plus"
              onClick={() => document.getElementById('converter-add-input')?.click()}
              disabled={false}
            >
              Add files
            </PrimaryButton>
          </>
        }
      />

      <WorkbenchLayout
        family="converter"
        className="conversion-board-layout"
        stage={(
          <>
            <Panel
              title="File stage"
              actions={(
                <StatusBadge tone="cyan">
                  {displayCount} file{displayCount === 1 ? '' : 's'}
                  {uploadingCount ? ` · ${uploadingCount} uploading` : ''}
                  {saving ? ' · saving' : ''}
                </StatusBadge>
              )}
            >
              {inputStageFiles.length > 0 ? (
                <div className="file-queue-list" style={{ marginBottom: 12 }}>
                  {inputStageFiles.map((f) => (
                    <FileInputCard
                      key={f.id}
                      file={f}
                      job={f.jobId ? activeJobs[f.jobId] : null}
                      onRemove={() => onRemoveServerFile(f.id)}
                      removeDisabled={anyBusy && !f.localOnly}
                      onPause={uploadControllersRef.current.has(f.id) ? () => pauseLocalUpload(f.id) : null}
                      onResume={uploadControllersRef.current.has(f.id) ? () => restartLocalUpload(f.id) : null}
                      onRetry={uploadControllersRef.current.has(f.id) ? () => restartLocalUpload(f.id) : null}
                      onCancel={f.localOnly && f.uploadSessionId ? () => cancelLocalUpload(f) : null}
                    />
                  ))}
                </div>
              ) : null}

              <FilePicker
                files={[]}
                onChange={(next) => {
                  void startUploads(next);
                }}
                disabled={false}
                title={inputStageFiles.length || batchStageFiles.length ? 'Add more files' : 'Drop source files here'}
              />
              <input
                id="converter-add-input"
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void startUploads(Array.from(e.target.files));
                  }
                  e.target.value = '';
                }}
              />
              {grouping.unsupported.length > 0 ? (
                <div className="converter-unsupported" role="alert">
                  <strong>Unsupported files</strong>
                  <ul>
                    {grouping.unsupported.map((f) => (
                      <li key={f.id}>
                        {f.originalName} - {unsupportedFileMessage(f)}
                        <button type="button" className="linkish" onClick={() => onRemoveServerFile(f.id)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="helper-note" style={{ marginTop: 8 }}>
                Workspace {workspaceId ? workspaceId.slice(0, 8) : '…'} · mode: {grouping.mode}
              </p>
            </Panel>

            <Panel title="Detected groups" actions={<StatusBadge tone="purple">{grouping.groups.length}</StatusBadge>}>
              {!grouping.groups.length ? (
                <EmptyState
                  type="converted"
                  compact
                  title="No convertible groups yet"
                  description="Upload supported files. Groups appear when detection finishes."
                />
              ) : (
                <div className="converter-group-list" role="listbox" aria-label="Conversion groups">
                  {grouping.groups.map((group) => {
                    const settings = groupSettings[group.id] || defaultGroupSettings(group);
                    const busyGroup = convertingKeys.has(group.id);
                    const selectedEngine = engineForOutput(group, settings.format);
                    return (
                      <FileRow
                        key={group.id}
                        name={group.label}
                        meta={`${group.fileIds.length} file(s) · ${selectedEngine || 'engine'} · ${settings.format || '—'}`}
                        status={busyGroup ? 'converting' : 'ready'}
                        selected={selectedGroup?.id === group.id}
                        onSelect={() => setSelectedGroupId(group.id)}
                        leading={<Icon name="layers" size={18} />}
                      />
                    );
                  })}
                </div>
              )}
              {selectedGroup ? (
                <div className="file-queue-list" style={{ marginTop: 12 }}>
                  {selectedGroup.members.map((f) => (
                    <FileInputCard
                      key={f.id}
                      file={f}
                      job={f.jobId ? activeJobs[f.jobId] : null}
                      compact
                      onRemove={null}
                    />
                  ))}
                </div>
              ) : null}
            </Panel>

            {batchStageFiles.some(
              (f) => f.uiStatus === 'conversion-failed' || f.uiStatus === 'cancelled',
            ) ? (
              <Panel title="Needs attention">
                <div className="file-queue-list">
                  {batchStageFiles
                    .filter(
                      (f) => f.uiStatus === 'conversion-failed' || f.uiStatus === 'cancelled',
                    )
                    .map((f) => (
                      <FileInputCard
                        key={`batch-fail-${f.id}`}
                        file={f}
                        job={f.jobId ? activeJobs[f.jobId] : null}
                        onRemove={() => onRemoveServerFile(f.id)}
                        removeDisabled={false}
                      />
                    ))}
                </div>
              </Panel>
            ) : null}
          </>
        )}
        rail={(
          <Panel title={selectedGroup ? `Target · ${selectedGroup.label}` : 'Target settings'}>
            {!selectedGroup ? (
              <p className="workspace-description" style={{ margin: 0 }}>Select a detected group to configure output format and engine.</p>
            ) : (() => {
              const group = selectedGroup;
              const settings = groupSettings[group.id] || defaultGroupSettings(group);
              const outputs = (group.outputs || []).filter((o) => o.available);
              const unavailable = (group.outputs || []).filter((o) => !o.available);
              const selectedEngine = engineForOutput(group, settings.format);
              return (
                <>
                  <div className="preview-info-list" style={{ marginBottom: 12 }}>
                    <div><span>Engine</span><strong>{selectedEngine || '—'}</strong></div>
                    <div><span>Files</span><strong>{group.fileIds.length}</strong></div>
                  </div>
                  <div className="form-grid">
                    <SelectField
                      label="Output format"
                      value={settings.format || ''}
                      onChange={(e) => updateGroupSetting(group.id, { format: e.target.value })}
                    >
                      {!outputs.length ? (
                        <option value="">No compatible outputs</option>
                      ) : (
                        outputs.map((o) => (
                          <option key={o.format} value={o.format}>
                            {o.label}
                            {o.format === group.recommendedOutput ? ' (recommended)' : ''}
                          </option>
                        ))
                      )}
                    </SelectField>
                    <SelectField
                      label="Quality"
                      value={settings.quality || 'balanced'}
                      onChange={(e) => updateGroupSetting(group.id, { quality: e.target.value })}
                    >
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="high">High quality</option>
                    </SelectField>
                  </div>
                  {unavailable.length > 0 ? (
                    <p className="helper-note" style={{ marginTop: 8 }}>
                      Unavailable: {unavailable
                        .slice(0, 4)
                        .map((o) => `${o.label}${o.profile ? ` [${o.profile} profile]` : ''}`)
                        .join(', ')}
                      {unavailable[0]?.reason ? ` - ${unavailable[0].reason}` : ''}
                    </p>
                  ) : null}
                  <div className="toggle-stack" style={{ marginTop: 10 }}>
                    <ToggleRow
                      title="Preserve metadata"
                      description="Only when the selected encoder supports it."
                      checked={settings.preserveMetadata !== false}
                      onChange={(e) =>
                        updateGroupSetting(group.id, { preserveMetadata: e.target.checked })
                      }
                    />
                  </div>
                  {grouping.groups.length > 1 ? (
                    <div style={{ marginTop: 12 }}>
                      <SecondaryButton icon="copy" onClick={() => onApplySettings(group.id)}>
                        Apply settings to compatible
                      </SecondaryButton>
                    </div>
                  ) : null}
                </>
              );
            })()}
            <div className="summary-list" style={{ marginTop: 16 }}>
              <div><span>Session files</span><strong>{serverFiles.filter((f) => !f.localOnly).length}</strong></div>
              <div><span>Groups</span><strong>{grouping.groups.length}</strong></div>
              <div><span>Results</span><strong>{resultRows.length}</strong></div>
              <div>
                <span>Active jobs</span>
                <strong>
                  {Object.values(activeJobs).filter((j) => ['queued', 'running'].includes(j.status)).length}
                </strong>
              </div>
            </div>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{selectedGroup ? selectedGroup.label : 'Conversion board'}</strong>
              <span>
                {anyBusy
                  ? 'Working…'
                  : selectedGroup
                    ? 'Ready to convert selected group'
                    : 'Add files to begin'}
              </span>
              {anyBusy ? <ProgressWave value={0} indeterminate label="Active conversions" /> : null}
            </div>
            <div className="hero-button-row">
              {selectedGroup && convertingKeys.has(selectedGroup.id) ? (
                <SecondaryButton icon="close" onClick={() => cancelGroupJobs(selectedGroup)}>Cancel</SecondaryButton>
              ) : null}
              <PrimaryButton
                icon="swap"
                onClick={() => selectedGroup && startGroupConvert(selectedGroup)}
                disabled={!selectedGroup || convertingKeys.has(selectedGroup.id) || !canConvertGroup(selectedGroup, groupSettings[selectedGroup.id] || defaultGroupSettings(selectedGroup))}
                busy={selectedGroup ? convertingKeys.has(selectedGroup.id) : false}
              >
                Convert selected
              </PrimaryButton>
            </div>
          </>
        )}
        footer={(
          <ResultPanel title="Converted files">
            <div className="converted-results">
            <div className="card-heading compact-heading">
              <div>
                <p className="eyebrow">Results</p>
                <h3>Output management</h3>
              </div>
              <StatusBadge tone="neutral">{visibleResults.length} results</StatusBadge>
            </div>

            <div className="converted-toolbar form-grid">
              <SelectField
                label="Status"
                value={resultFilter.status}
                onChange={(e) => setResultFilter((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="all">All</option>
                <option value="queued">Queued</option>
                <option value="running">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </SelectField>
              <SelectField
                label="Format"
                value={resultFilter.format}
                onChange={(e) => setResultFilter((f) => ({ ...f, format: e.target.value }))}
              >
                <option value="all">All formats</option>
                {formatFilterOptions.map((fmt) => (
                  <option key={fmt} value={fmt}>
                    {String(fmt).toUpperCase()}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Sort"
                value={resultFilter.sort}
                onChange={(e) => setResultFilter((f) => ({ ...f, sort: e.target.value }))}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
                <option value="status">Status</option>
              </SelectField>
            </div>

            <div className="converted-actions">
              <SecondaryButton
                icon="download"
                onClick={() => downloadSelectedOrAll('all')}
                disabled={
                  zipBusy ||
                  !resultRows.some((r) => r.status === 'completed' && !hiddenResultIds.includes(String(r.id)))
                }
              >
                {zipBusy ? 'Zipping…' : 'Download all'}
              </SecondaryButton>
              <SecondaryButton
                icon="download"
                onClick={() => downloadSelectedOrAll('selected')}
                disabled={zipBusy || selectedResultIds.size === 0}
              >
                Download selected
              </SecondaryButton>
              <SecondaryButton icon="trash" onClick={clearCompleted} disabled={!resultRows.some((r) => r.status === 'completed')}>
                Clear completed
              </SecondaryButton>
              {hideCompleted ? (
                <SecondaryButton
                  icon="refresh"
                  onClick={async () => {
                    setHideCompleted(false);
                    await saveNow({
                      toolSettings: {
                        converter: { groupSettings, hideCompleted: false, hiddenResultIds },
                      },
                    });
                    notify('Showing completed results again');
                  }}
                >
                  Show completed
                </SecondaryButton>
              ) : null}
              <SecondaryButton icon="refresh" onClick={() => retryFailed()}>
                Retry failed
              </SecondaryButton>
            </div>

            {visibleResults.length === 0 ? (
              <EmptyState
                type={resultRows.length ? 'noResults' : 'converted'}
                compact
                className="empty-results"
                title={
                  hideCompleted && resultRows.some((r) => r.status === 'completed')
                    ? 'Completed results are hidden'
                    : undefined
                }
                description={
                  hideCompleted && resultRows.some((r) => r.status === 'completed')
                    ? 'Use “Show completed” or start a new conversion.'
                    : undefined
                }
              />
            ) : (
              <div className="converted-list">
                {visibleResults.map((row) => (
                  <div className={`converted-row status-${row.status}`} key={row.id}>
                    <label className="converted-select">
                      <input
                        type="checkbox"
                        checked={selectedResultIds.has(row.id)}
                        onChange={() => toggleSelectResult(row.id)}
                        aria-label={`Select ${row.outputName || row.id}`}
                      />
                    </label>
                    {row.previewUrl && row.status === 'completed' ? (
                      <img
                        className="converted-preview"
                        src={row.previewUrl.startsWith('http') ? row.previewUrl : `${api.base}${row.previewUrl}`}
                        alt=""
                        width={40}
                        height={40}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="file-type-icon" aria-hidden="true">
                        <Icon name="file" size={16} />
                      </div>
                    )}
                    <div className="file-info">
                      <strong>{row.outputName || 'Output pending'}</strong>
                      <span>
                        {row.sourceLabel}
                        {row.inputFormat || row.outputFormat
                          ? ` · ${String(row.inputFormat || '?').toUpperCase()} → ${String(row.outputFormat || '?').toUpperCase()}`
                          : ''}
                        {row.size != null ? ` · ${formatBytes(row.size)}` : ''}
                        {row.duration != null ? ` · ${row.duration}s` : ''}
                      </span>
                      {row.error ? <span className="error-detail">{row.error}</span> : null}
                      {['queued', 'running'].includes(row.status) ? (
                        <div className="progress-track" aria-valuenow={row.progress || 0} role="progressbar">
                          <div
                            className={`progress-fill${(row.progress || 0) <= 0 ? ' is-indeterminate' : ''}`}
                            style={{ width: `${Math.min(100, row.progress || 0)}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                    <StatusBadge
                      status={row.status}
                      tone={
                        row.status === 'completed'
                          ? 'green'
                          : row.status === 'failed'
                            ? 'danger'
                            : row.status === 'running'
                              ? 'blue'
                              : 'neutral'
                      }
                    >
                      {row.status === 'running' ? 'processing' : row.status}
                      {['queued', 'running'].includes(row.status) && row.progress != null
                        ? ` ${Math.round(row.progress)}%`
                        : ''}
                    </StatusBadge>
                    <div className="converted-row-actions">
                      {row.status === 'completed' && row.downloadUrl ? (
                        <SecondaryButton icon="download" onClick={() => downloadOne(row)}>
                          Download
                        </SecondaryButton>
                      ) : null}
                      {row.status === 'failed' ? (
                        <SecondaryButton icon="refresh" onClick={() => retryFailed([row.jobId || row.id])}>
                          Retry
                        </SecondaryButton>
                      ) : null}
                      {['queued', 'running'].includes(row.status) ? (
                        <SecondaryButton
                          icon="close"
                          onClick={async () => {
                            try {
                              await api.cancelJob(row.jobId);
                              const data = await refresh();
                              if (data?.files) {
                                setServerFiles((prev) => mergeWorkspaceSnapshot(prev, data.files || []));
                              }
                            } catch (e) {
                              notify(e.message || 'Cancel failed');
                            }
                          }}
                        >
                          Cancel
                        </SecondaryButton>
                      ) : null}
                      <SecondaryButton
                        icon="trash"
                        onClick={() => removeResultRow(row)}
                        aria-label={`Remove ${row.outputName || row.id} from list`}
                      >
                        Remove
                      </SecondaryButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </ResultPanel>
        )}
      />
    </div>
  );
}

/**
 * Per-file card with uiStatus, upload metrics, job progress, fallback icon.
 */
function FileInputCard({ file, job, onRemove, removeDisabled, compact = false, onPause, onResume, onRetry, onCancel }) {
  const [imgFailed, setImgFailed] = useState(false);
  const uiKey = normalizeFileUiStatus(file, job);
  const label = FILE_UI_STATUS[uiKey] || uiKey || file.status || 'file';
  const isUploading = uiKey === 'uploading' || uiKey === 'waiting' || uiKey === 'retrying' || uiKey === 'finalizing';
  const isPaused = uiKey === 'paused';
  const isUploadPhase = isUploading || isPaused || uiKey === 'upload-failed';
  const isProcessing =
    uiKey === 'processing' || uiKey === 'inspecting' || uiKey === 'queued';
  const pct = isUploading || isPaused
    ? Number(file.uploadProgress ?? 0)
    : isProcessing
      ? Number(file.jobProgress ?? job?.progress ?? 0)
      : null;
  const canPreview =
    !file.localOnly &&
    !String(file.id || '').startsWith('local-') &&
    file.mime?.startsWith('image/') &&
    !imgFailed;
  const tone =
    uiKey === 'ready' || uiKey === 'completed'
      ? 'green'
      : uiKey === 'failed' || uiKey === 'upload-failed' || uiKey === 'conversion-failed'
        ? 'danger'
        : uiKey === 'uploading' || uiKey === 'paused' || uiKey === 'retrying' || uiKey === 'finalizing' ||
            uiKey === 'processing' ||
            uiKey === 'inspecting' ||
            uiKey === 'queued'
          ? 'blue'
          : 'neutral';

  const iconSize = compact ? 16 : 18;
  const thumb = compact ? 36 : 40;

  return (
    <div className="file-queue-row">
      <div className="file-type-icon" aria-hidden="true">
        {canPreview ? (
          <img
            src={api.filePreviewUrl(file.id)}
            alt=""
            style={{ width: thumb, height: thumb, objectFit: 'cover', borderRadius: 8 }}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Icon name="file" size={iconSize} />
        )}
      </div>
      <div className="file-info">
        <strong>{file.originalName}</strong>
        <span>
          {file.detect?.format
            ? String(file.detect.format).toUpperCase()
            : file.mime || file.ext || 'file'}{' '}
          · {formatBytes(file.size)}
          {file.detect?.family ? ` · ${file.detect.family}` : ''}
          {isUploadPhase ? ` · ${formatBytes(Number(file.loaded || 0))} / ${formatBytes(Number(file.total || file.size || 0))}` : ''}
          {isUploading
            ? ` · ${Math.round(pct || 0)}% · ${formatSpeed(file.speedBps)} · ETA ${formatEta(file.etaSeconds)}`
            : isProcessing && pct != null
              ? ` · ${Math.round(pct)}%`
              : ''}
          {file.error ? ` · ${file.error}` : ''}
          {file.resumableMissingFile ? ' · reselect this file to resume' : ''}
        </span>
        {(isUploading || isPaused || (isProcessing && pct != null)) ? (
          <div
            className="progress-track"
            aria-valuenow={pct || 0}
            role="progressbar"
            style={{ marginTop: 6 }}
          >
            <div
              className={`progress-fill${isProcessing && (pct || 0) <= 0 ? ' is-indeterminate' : ''}`}
              style={{ width: `${Math.min(100, pct || 0)}%` }}
            />
          </div>
        ) : null}
      </div>
      <StatusBadge tone={tone}>
        {label}
        {isUploading && pct != null ? ` ${Math.round(pct)}%` : ''}
        {isProcessing && pct != null && !isUploading ? ` ${Math.round(pct)}%` : ''}
      </StatusBadge>
      {onPause && uiKey === 'uploading' ? <button className="linkish" type="button" onClick={onPause}>Pause</button> : null}
      {onResume && isPaused && !file.resumableMissingFile ? <button className="linkish" type="button" onClick={onResume}>Resume</button> : null}
      {onRetry && uiKey === 'upload-failed' && !file.resumableMissingFile ? <button className="linkish" type="button" onClick={onRetry}>Retry</button> : null}
      {onCancel && !['finalizing', 'completed'].includes(uiKey) ? <button className="linkish" type="button" onClick={onCancel}>Cancel</button> : null}
      {onRemove && !onCancel ? (
        <button
          className="icon-button quiet"
          type="button"
          aria-label={`Remove ${file.originalName}`}
          onClick={onRemove}
          disabled={removeDisabled}
        >
          <Icon name="trash" size={17} />
        </button>
      ) : null}
    </div>
  );
}

function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human message for files that cannot be converted (prefer detect.reason). */
function unsupportedFileMessage(file) {
  const reason = file?.detect?.reason;
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  if (!file?.detect) {
    return 'format could not be detected (magic/MIME sniff failed or missing).';
  }
  if (file.detect.unsupported || file.detect.family === 'unknown') {
    return 'unrecognized or unsupported type (magic/MIME did not match a convertible format).';
  }
  return 'format could not be detected or is not convertible.';
}
