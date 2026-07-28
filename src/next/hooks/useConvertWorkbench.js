import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import {
  gatedOperation,
  getContractState,
  loadContracts,
  qualityPresets,
} from '../../protocol/contracts.js';
import {
  applyPoll,
  hydrate,
  optimisticRequest,
  rememberActiveJob,
  resolveOptimisticUpload,
  resolveRequest,
} from '../../protocol/store.js';
import {
  createUploadTask,
  recoverUploadSessions,
} from '../../protocol/uploads.js';
import {
  applySettingsToCompatible,
  buildConversionGroups,
  buildConvertAllPlans,
  buildConvertSelectionPlan,
  buildResultRows,
  canConvertGroup,
  defaultGroupSettings,
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
  const [groupOverrides, setGroupOverrides] = useState({});
  const [selectedFileIds, setSelectedFileIds] = useState(() => new Set());
  const [pauseableFileIds, setPauseableFileIds] = useState(() => new Set());
  const [contractTick, setContractTick] = useState(0);
  const [attemptJobIds, setAttemptJobIds] = useState([]);
  const [actionError, setActionError] = useState('');
  const tasksRef = useRef(new Map());
  const requestIdsRef = useRef(new Map());

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
  const capabilityLookup = useMemo(() => {
    if (!enabled) return { available: true, value: null };
    if (contract.status === 'idle' || contract.status === 'loading') {
      return { available: false, reason: 'Loading server capabilities…' };
    }
    if (contract.status === 'unavailable') {
      return { available: false, reason: contract.reason };
    }
    for (const capabilityId of mode?.capabilityIds || []) {
      const lookup = gatedOperation(capabilityId);
      if (!lookup.available) return lookup;
      if (lookup.value) {
        return { available: false, reason: lookup.value.reason };
      }
    }
    return { available: true, value: null };
  }, [contract, contractTick, enabled, mode?.capabilityIds]);

  useEffect(() => {
    if (!quality && publishedDefault) setQuality(publishedDefault);
  }, [publishedDefault, quality]);

  const files = useMemo(
    () => snapshot.files.filter((file) => !file.localOnly && file.status !== 'deleted'),
    [snapshot.files],
  );
  const grouping = useMemo(() => buildConversionGroups(files), [files]);
  const activeConverterJobIds = useMemo(
    () => snapshot.jobs
      .filter((job) => job.type === 'converter' && ['queued', 'running'].includes(job.status))
      .map((job) => job.id),
    [snapshot.jobs],
  );
  const currentAttemptJobIds = useMemo(
    () => [...new Set([...attemptJobIds, ...activeConverterJobIds])],
    [activeConverterJobIds, attemptJobIds],
  );
  useEffect(() => {
    if (!activeConverterJobIds.length) return;
    setAttemptJobIds((current) => [
      ...new Set([...current, ...activeConverterJobIds]),
    ]);
  }, [activeConverterJobIds]);
  const resultRows = useMemo(() => buildResultRows({
    jobs: snapshot.jobs,
    outputs: snapshot.outputs,
    files: snapshot.files,
  }), [snapshot.files, snapshot.jobs, snapshot.outputs]);
  const groupSettings = useMemo(() => Object.fromEntries(grouping.groups.map((group) => [
    group.id,
    {
      ...defaultGroupSettings(group, quality),
      ...(quality ? { quality } : {}),
      preserveMetadata,
      ...(groupOverrides[group.id] || {}),
    },
  ])), [groupOverrides, grouping.groups, preserveMetadata, quality]);
  const selectedPlan = useMemo(() => {
    const firstGroup = grouping.groups.find((group) => (
      group.fileIds.some((id) => selectedFileIds.has(String(id)))
    ));
    if (!firstGroup) return null;
    const settings = groupSettings[firstGroup.id] || defaultGroupSettings(firstGroup, quality);
    const plan = buildConvertSelectionPlan(
      files,
      selectedFileIds,
      settings.format,
      settings,
    );
    return plan ? {
      ...plan,
      inputFormat: firstGroup.format || null,
      inputFamily: firstGroup.family || null,
    } : null;
  }, [files, groupSettings, grouping.groups, quality, selectedFileIds]);

  useEffect(() => {
    const available = new Set(files.map((file) => String(file.id)));
    setSelectedFileIds((current) => {
      const next = new Set([...current].filter((id) => available.has(String(id))));
      return next.size === current.size ? current : next;
    });
  }, [files]);

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

  const onGroupSettingChange = useCallback((groupId, id, value) => {
    setActionError('');
    setGroupOverrides((current) => ({
      ...current,
      [groupId]: {
        ...(current[groupId] || {}),
        [id]: id === 'preserveMetadata' ? Boolean(value) : String(value),
      },
    }));
  }, []);

  const onApplyGroupSettings = useCallback((groupId) => {
    setGroupOverrides(applySettingsToCompatible(groupSettings, grouping.groups, groupId));
  }, [groupSettings, grouping.groups]);

  const onToggleFile = useCallback((fileId) => {
    setSelectedFileIds((current) => {
      const next = new Set(current);
      const id = String(fileId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSelectGroup = useCallback((groupId, select) => {
    const group = grouping.groups.find((item) => item.id === groupId);
    if (!group) return;
    setSelectedFileIds((current) => {
      const next = new Set(current);
      for (const id of group.fileIds) {
        if (select) next.add(String(id));
        else next.delete(String(id));
      }
      return next;
    });
  }, [grouping.groups]);

  const onFiles = useCallback(async (incoming) => {
    if (!enabled || !snapshot.workspaceId) return;
    setActionError('');
    const batch = Array.from(incoming || []);
    await Promise.all(batch.map(async (file) => {
      let task;
      task = createUploadTask(file, {
        workspaceId: snapshot.workspaceId,
        onState: (state) => {
          if (task.kind !== 'resumable') return;
          setPauseableFileIds((current) => {
            const next = new Set(current);
            if (state === 'uploading') next.add(task.clientId);
            else next.delete(task.clientId);
            return next;
          });
        },
      });
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

  const onPauseFile = useCallback(async (file) => {
    const task = tasksRef.current.get(String(file.id));
    if (!task || task.kind !== 'resumable') {
      setActionError('Only an active resumable upload can be paused.');
      return;
    }
    try {
      await task.pause();
      if (snapshot.workspaceId) await recoverUploadSessions(snapshot.workspaceId);
    } catch (error) {
      setActionError(failedReason(error));
    }
  }, [snapshot.workspaceId]);

  const queuePlans = useCallback(async (plans) => {
    if (!snapshot.workspaceId) return;
    setActionError('');
    if (!plans.length) {
      setActionError(grouping.unsupported.length
        ? 'No compatible output is available for the detected files.'
        : 'Add a supported file and wait for detection to finish.');
      return;
    }
    setAttemptJobIds([]);
    const planKeys = plans.map((plan) => (
      `${[...(plan.fileIds || [])].map(String).sort().join(',')}|${String(plan.format || '')}`
    ));
    const requests = buildConvertJobRequests({
      workspaceId: snapshot.workspaceId,
      plans,
      requestIdFor: (_plan, index) => {
        const key = planKeys[index];
        const existing = requestIdsRef.current.get(key);
        if (existing) return existing;
        const next = requestId();
        requestIdsRef.current.set(key, next);
        return next;
      },
    });
    for (const [index, body] of requests.entries()) {
      const targetId = body.uploadIds.join(',');
      const key = optimisticRequest('convert', targetId, {
        clientRequestId: body.clientRequestId,
      });
      try {
        const job = await api.createJob(body);
        applyPoll({ job });
        rememberActiveJob('convert', 'convert', job.id);
        setAttemptJobIds((current) => [...new Set([...current, job.id])]);
      } catch (error) {
        setActionError(failedReason(error));
      } finally {
        resolveRequest(key);
        requestIdsRef.current.delete(planKeys[index]);
      }
    }
  }, [grouping.unsupported.length, snapshot.workspaceId]);

  const onRun = useCallback(() => queuePlans(
    buildConvertAllPlans(grouping.groups, groupSettings),
  ), [groupSettings, grouping.groups, queuePlans]);

  const onRunGroup = useCallback((groupId) => {
    const group = grouping.groups.find((item) => item.id === groupId);
    if (!group) return Promise.resolve();
    return queuePlans(buildConvertAllPlans([group], groupSettings));
  }, [groupSettings, grouping.groups, queuePlans]);

  const onRunSelected = useCallback(() => {
    if (!selectedFileIds.size) {
      setActionError('Select at least one detected file to convert.');
      return Promise.resolve();
    }
    if (!selectedPlan) {
      setActionError('Selected files do not share the chosen output target.');
      return Promise.resolve();
    }
    return queuePlans([selectedPlan]);
  }, [queuePlans, selectedFileIds.size, selectedPlan]);

  const onCancel = useCallback(async () => {
    const attemptIds = new Set(currentAttemptJobIds);
    const active = snapshot.jobs.filter((job) => (
      attemptIds.has(job.id) && ['queued', 'running'].includes(job.status)
    ));
    const failures = [];
    await Promise.all(active.map(async (job) => {
      const key = optimisticRequest('cancel', job.id);
      try {
        applyPoll({ job: await api.cancelJob(job.id) });
      } catch (error) {
        failures.push(failedReason(error));
      } finally {
        resolveRequest(key);
      }
    }));
    if (failures.length) setActionError(failures[0]);
  }, [currentAttemptJobIds, snapshot.jobs]);

  const onCancelGroup = useCallback(async (groupId) => {
    const group = grouping.groups.find((item) => item.id === groupId);
    if (!group) return;
    const attemptIds = new Set(currentAttemptJobIds);
    const active = snapshot.jobs.filter((job) => (
      attemptIds.has(job.id)
      && ['queued', 'running'].includes(job.status)
      && jobTouchesFileIds(job, group.fileIds)
    ));
    const failures = [];
    await Promise.all(active.map(async (job) => {
      const key = optimisticRequest('cancel', job.id);
      try {
        applyPoll({ job: await api.cancelJob(job.id) });
      } catch (error) {
        failures.push(failedReason(error));
      } finally {
        resolveRequest(key);
      }
    }));
    if (failures.length) setActionError(failures[0]);
  }, [currentAttemptJobIds, grouping.groups, snapshot.jobs]);

  const retryJobs = useCallback(async (jobs) => {
    if (!snapshot.workspaceId) return;
    setActionError('');
    setAttemptJobIds([]);
    const failures = [];
    for (const job of jobs) {
      let key = '';
      try {
        const body = buildConvertRetryRequest({
          workspaceId: snapshot.workspaceId,
          job,
          clientRequestId: requestId('convert-retry'),
        });
        key = optimisticRequest('convert', job.id, {
          clientRequestId: body.clientRequestId,
        });
        const next = await api.createJob(body);
        applyPoll({ job: next });
        rememberActiveJob('convert', 'convert', next.id);
        setAttemptJobIds((current) => [...new Set([...current, next.id])]);
      } catch (error) {
        failures.push(failedReason(error));
      } finally {
        if (key) resolveRequest(key);
      }
    }
    if (failures.length) setActionError(failures[0]);
  }, [snapshot.workspaceId]);
  const onRetry = useCallback((job) => retryJobs([job]), [retryJobs]);
  const onRetryAll = useCallback((jobs) => retryJobs(jobs), [retryJobs]);

  const onRemoveFile = useCallback(async (file) => {
    if (!snapshot.workspaceId) return;
    if (file.localOnly) {
      const task = tasksRef.current.get(String(file.id));
      try {
        if (task) await task.cancel();
        tasksRef.current.delete(String(file.id));
        resolveOptimisticUpload(String(file.id));
      } catch (error) {
        setActionError(failedReason(error));
      }
      return;
    }
    const key = optimisticRequest('delete', file.id);
    try {
      await api.removeWorkspaceFile(snapshot.workspaceId, file.id);
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      await hydrate({ route: 'convert' }).catch((error) => {
        setActionError(failedReason(error));
      });
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const onRemoveResult = useCallback(async (result) => {
    const id = result.jobId || result.id;
    const key = optimisticRequest('delete', id);
    try {
      await api.deleteJob(id);
      await hydrate({ route: 'convert' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const onRemoveBadInput = useCallback(async (result) => {
    const inputIds = result.options?._uploadIds || result.options?.uploadIds || [];
    if (!snapshot.workspaceId || inputIds.length !== 1) {
      setActionError('Choose the bad source in Input when a failed job has multiple files.');
      return;
    }
    const fileId = String(inputIds[0]);
    const key = optimisticRequest('delete', fileId);
    try {
      const relatedFailures = snapshot.jobs.filter((job) => (
        job.type === 'converter'
        && job.status === 'failed'
        && jobTouchesFileIds(job, [fileId])
      ));
      await Promise.all(relatedFailures.map((job) => api.deleteJob(job.id)));
      await api.removeWorkspaceFile(snapshot.workspaceId, fileId);
      await hydrate({ route: 'convert' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.jobs, snapshot.workspaceId]);

  const onDiscardUpload = useCallback(async (session) => {
    try {
      await api.cancelUploadSession(session.id);
      if (snapshot.workspaceId) await recoverUploadSessions(snapshot.workspaceId);
    } catch (error) {
      setActionError(failedReason(error));
    }
  }, [snapshot.workspaceId]);

  const onResumeUpload = useCallback(() => {
    document.querySelector('.workbench__input .dropzone__input')?.click();
  }, []);

  return enabled ? {
    mode: resolvedMode,
    capability: capabilityLookup.available
      ? { available: true }
      : { available: false, reason: capabilityLookup.reason },
    optionValues: { quality, preserveMetadata },
    attemptJobIds: currentAttemptJobIds,
    resultRows,
    actionError,
    unsupportedFiles: grouping.unsupported,
    groupBoard: {
      groups: grouping.groups.map((group) => ({
        ...group,
        settings: groupSettings[group.id],
        canRun: capabilityLookup.available
          && canConvertGroup(group, groupSettings[group.id]),
        active: snapshot.jobs.some((job) => (
          job.type === 'converter'
          && ['queued', 'running'].includes(job.status)
          && jobTouchesFileIds(job, group.fileIds)
        )),
      })),
      qualityPresets: publishedPresets,
      selectedFileIds: [...selectedFileIds],
      onToggleFile,
      onSelectGroup,
      onSettingChange: onGroupSettingChange,
      onApplySettings: onApplyGroupSettings,
      onRunGroup,
      onRunSelected,
      onCancelGroup,
      canRunSelected: capabilityLookup.available && Boolean(selectedPlan),
      disabled: !capabilityLookup.available,
      disabledReason: !capabilityLookup.available
        ? capabilityLookup.reason
        : grouping.groups.length && !grouping.groups.some((group) => group.valid)
          ? (grouping.groups
            .flatMap((group) => group.outputs || [])
            .find((output) => !output.available)?.reason
            || 'No installed engine supports an output for these files.')
          : '',
    },
    onOptionChange,
    onFiles,
    onRun,
    onCancel,
    onRetry,
    onRetryAll,
    onRemoveFile,
    onPauseFile,
    pauseableFileIds: [...pauseableFileIds],
    onRemoveResult,
    onRemoveBadInput,
    onResumeUpload,
    onDiscardUpload,
    onDownload: async (result) => {
      try {
        await api.downloadJob(result.jobId, result.name || result.outputName);
      } catch (error) {
        setActionError(failedReason(error));
      }
    },
    onDownloadBatch: async (outputs) => {
      try {
        await api.downloadOutputsZip(snapshot.workspaceId, {
          outputIds: outputs
            .map((output) => output.outputId || output.id)
            .filter(Boolean),
          jobIds: outputs.map((output) => output.jobId),
        });
      } catch (error) {
        setActionError(failedReason(error));
      }
    },
    onRetryHydrate: () => hydrate({ route: 'convert' }),
  } : {};
}
