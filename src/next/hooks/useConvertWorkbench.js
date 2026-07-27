import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import {
  getContractState,
  loadContracts,
  qualityPresets,
} from '../../protocol/contracts.js';
import {
  applyPoll,
  hydrate,
  optimisticRequest,
  rememberActiveJob,
  resolveRequest,
} from '../../protocol/store.js';
import {
  createUploadTask,
  recoverUploadSessions,
} from '../../protocol/uploads.js';
import {
  buildConversionGroups,
  buildConvertAllPlans,
  defaultGroupSettings,
  hasActiveDuplicateJob,
  jobTouchesFileIds,
} from '../../lib/converterGroups.js';
import {
  buildConvertJobRequests,
  buildConvertRetryRequest,
} from '../../lib/convertJobOptions.js';
import useStore from './useStore.js';

const selectSnapshot = (snapshot) => snapshot;

function requestId(prefix = 'convert') {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function failedReason(error) {
  return error instanceof Error ? error.message : String(error || 'Conversion failed');
}

export default function useConvertWorkbench({ enabled, mode }) {
  const snapshot = useStore(selectSnapshot);
  const [quality, setQuality] = useState('');
  const [preserveMetadata, setPreserveMetadata] = useState(true);
  const [contractTick, setContractTick] = useState(0);
  const [attemptJobIds, setAttemptJobIds] = useState([]);
  const [actionError, setActionError] = useState('');
  const tasksRef = useRef(new Map());

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void loadContracts().then(() => {
      if (active) setContractTick((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  const presetsLookup = useMemo(() => qualityPresets(), [contractTick]);
  const contract = getContractState();
  const publishedPresets = presetsLookup.available ? presetsLookup.value : [];
  const publishedDefault = contract.status === 'ready' ? contract.contract.quality.default : '';

  useEffect(() => {
    if (!quality && publishedDefault) setQuality(publishedDefault);
  }, [publishedDefault, quality]);

  const files = useMemo(
    () => snapshot.files.filter((file) => !file.localOnly && file.status !== 'deleted'),
    [snapshot.files],
  );
  const grouping = useMemo(() => buildConversionGroups(files), [files]);
  const groupSettings = useMemo(() => Object.fromEntries(grouping.groups.map((group) => [
    group.id,
    {
      ...defaultGroupSettings(group),
      ...(quality ? { quality } : {}),
      preserveMetadata,
    },
  ])), [grouping.groups, preserveMetadata, quality]);

  const resolvedMode = useMemo(() => {
    if (!mode) return mode;
    return {
      ...mode,
      options: mode.options.map((option) => (
        option.id === 'quality'
          ? {
              ...option,
              disabled: !publishedPresets.length,
              options: publishedPresets.map((preset) => ({
                value: preset,
                label: preset.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
              })),
            }
          : option.id === 'format'
            ? {
                ...option,
                value: grouping.groups.length
                  ? `${grouping.groups.length} detected ${grouping.groups.length === 1 ? 'group' : 'groups'}`
                  : option.value,
              }
            : option
      )),
    };
  }, [grouping.groups.length, mode, publishedPresets]);

  const onOptionChange = useCallback((id, value) => {
    setActionError('');
    if (id === 'quality') setQuality(String(value));
    if (id === 'preserveMetadata') setPreserveMetadata(Boolean(value));
  }, []);

  const onFiles = useCallback(async (incoming) => {
    if (!enabled || !snapshot.workspaceId) return;
    setActionError('');
    const batch = Array.from(incoming || []);
    await Promise.all(batch.map(async (file) => {
      const task = createUploadTask(file, { workspaceId: snapshot.workspaceId });
      tasksRef.current.set(task.clientId, task);
      try {
        await task.start();
      } catch (error) {
        if (!['PAUSED', 'CANCELLED'].includes(error?.code)) setActionError(failedReason(error));
      } finally {
        if (task.state === 'completed' || task.state === 'failed') {
          tasksRef.current.delete(task.clientId);
        }
      }
    }));
    await hydrate({ route: 'convert' });
  }, [enabled, snapshot.workspaceId]);

  const onRun = useCallback(async () => {
    if (!snapshot.workspaceId) return;
    setActionError('');
    const plans = buildConvertAllPlans(grouping.groups, groupSettings);
    if (!plans.length) {
      setActionError(grouping.unsupported.length
        ? 'No compatible output is available for the detected files.'
        : 'Add a supported file and wait for detection to finish.');
      return;
    }
    const requests = buildConvertJobRequests({
      workspaceId: snapshot.workspaceId,
      plans,
      requestIdFor: () => requestId(),
    });
    const created = [];
    for (const body of requests) {
      if (hasActiveDuplicateJob(snapshot.jobs, {
        uploadIds: body.uploadIds,
        format: body.options.format,
      })) continue;
      const targetId = body.uploadIds.join(',');
      const key = optimisticRequest('convert', targetId, {
        clientRequestId: body.clientRequestId,
      });
      try {
        const job = await api.createJob(body);
        applyPoll({ job });
        rememberActiveJob('convert', 'convert', job.id);
        created.push(job.id);
      } catch (error) {
        setActionError(failedReason(error));
      } finally {
        resolveRequest(key);
      }
    }
    if (created.length) {
      setAttemptJobIds((current) => [...new Set([...current, ...created])]);
    }
  }, [groupSettings, grouping.groups, grouping.unsupported.length, snapshot.jobs, snapshot.workspaceId]);

  const onCancel = useCallback(async () => {
    const active = snapshot.jobs.filter((job) => (
      job.type === 'converter'
      && ['queued', 'running'].includes(job.status)
      && grouping.groups.some((group) => jobTouchesFileIds(job, group.fileIds))
    ));
    await Promise.all(active.map(async (job) => {
      const key = optimisticRequest('cancel', job.id);
      try {
        applyPoll({ job: await api.cancelJob(job.id) });
      } finally {
        resolveRequest(key);
      }
    }));
  }, [grouping.groups, snapshot.jobs]);

  const onRetry = useCallback(async (job) => {
    if (!snapshot.workspaceId) return;
    setActionError('');
    const body = buildConvertRetryRequest({
      workspaceId: snapshot.workspaceId,
      job,
      clientRequestId: requestId('convert-retry'),
    });
    const key = optimisticRequest('convert', job.id, {
      clientRequestId: body.clientRequestId,
    });
    try {
      const next = await api.createJob(body);
      applyPoll({ job: next });
      rememberActiveJob('convert', 'convert', next.id);
      setAttemptJobIds((current) => [...new Set([...current, next.id])]);
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const onRemoveFile = useCallback(async (file) => {
    if (!snapshot.workspaceId || file.localOnly) return;
    const key = optimisticRequest('delete', file.id);
    try {
      await api.removeWorkspaceFile(snapshot.workspaceId, file.id);
      await hydrate({ route: 'convert' });
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const onRemoveResult = useCallback(async (result) => {
    const id = result.jobId || result.id;
    const key = optimisticRequest('delete', id);
    try {
      await api.deleteJob(id);
      await hydrate({ route: 'convert' });
    } finally {
      resolveRequest(key);
    }
  }, []);

  const onDiscardUpload = useCallback(async (session) => {
    await api.cancelUploadSession(session.id);
    if (snapshot.workspaceId) await recoverUploadSessions(snapshot.workspaceId);
  }, [snapshot.workspaceId]);

  const onResumeUpload = useCallback(() => {
    document.querySelector('.workbench__input .dropzone__input')?.click();
  }, []);

  return enabled ? {
    mode: resolvedMode,
    capability: contract.status === 'unavailable'
      ? { available: false, reason: contract.reason }
      : { available: true },
    optionValues: { quality, preserveMetadata },
    attemptJobIds: [
      ...new Set([
        ...snapshot.jobs.filter((job) => job.type === 'converter').map((job) => job.id),
        ...attemptJobIds,
      ]),
    ],
    actionError,
    unsupportedFiles: grouping.unsupported,
    onOptionChange,
    onFiles,
    onRun,
    onCancel,
    onRetry,
    onRemoveFile,
    onRemoveResult,
    onResumeUpload,
    onDiscardUpload,
    onDownload: (result) => api.downloadJob(result.jobId, result.name),
    onDownloadBatch: (outputs) => api.downloadOutputsZip(snapshot.workspaceId, {
      outputIds: outputs.map((output) => output.id),
      jobIds: outputs.map((output) => output.jobId),
    }),
    onRetryHydrate: () => hydrate({ route: 'convert' }),
  } : {};
}
