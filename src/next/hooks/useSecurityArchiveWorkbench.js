import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import {
  acceptAttributeFor,
  gatedOperation,
  getContractState,
  loadContracts,
} from '../../protocol/contracts.js';
import {
  applyPoll,
  hydrate,
  optimisticRequest,
  rememberActiveJob,
  resolveOptimisticUpload,
  resolveRequest,
} from '../../protocol/store.js';
import { createUploadTask, recoverUploadSessions } from '../../protocol/uploads.js';
import {
  SECURITY_ALGORITHMS,
  SECURITY_OPERATIONS,
  buildSecurityJobOptions,
  defaultSecurityForm,
  securityOperation,
  validateSecurityWorkbench,
} from '../../lib/securityJobOptions.js';
import {
  ARCHIVE_FORMATS,
  ARCHIVE_OPERATIONS,
  archiveCapability,
  archiveOperation,
  buildArchiveJobOptions,
  defaultArchiveForm,
  matchesArchiveAccept,
  validateArchiveWorkbench,
} from '../../lib/archiveJobOptions.js';
import { extractArchiveEntries } from '../../lib/archiveTree.js';
import useStore from './useStore.js';

const selectSnapshot = (snapshot) => snapshot;
const MAX_ARCHIVE_ENTRIES = 10_000;

function requestId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `security-archive-${suffix}`;
}

function failedReason(error) {
  return error instanceof Error
    ? error.message
    : String(error || 'Security or archive operation failed');
}

function capabilityChoice(entry) {
  const lookup = gatedOperation(entry.capability);
  const unavailable = !lookup.available || Boolean(lookup.value);
  return {
    value: entry.value || entry.id,
    label: `${entry.label}${unavailable ? ' (unavailable)' : ''}`,
    disabled: unavailable,
  };
}

function securityOptions(operation, form) {
  const options = [{
    id: 'operation',
    type: 'select',
    label: 'Security operation',
    options: SECURITY_OPERATIONS.map((entry) => capabilityChoice({
      ...entry,
      value: entry.id,
    })),
  }];
  if (operation === 'hash') {
    options.push({
      id: 'algorithms',
      type: 'derived',
      label: 'Algorithms',
      value: 'MD5 · SHA-1 · SHA-256 · SHA-512',
    });
  }
  if (operation === 'compare') {
    options.push(
      {
        id: 'algorithm',
        type: 'select',
        label: 'Algorithm',
        options: SECURITY_ALGORITHMS,
      },
      {
        id: 'expected',
        type: 'text',
        label: 'Expected checksum (hex)',
        hint: 'Paste a hexadecimal digest between 32 and 128 characters.',
        required: true,
      },
    );
  }
  if (operation === 'metadata') {
    options.push({
      id: 'report',
      type: 'derived',
      label: 'Report',
      value: 'Size, MIME, timestamps, and format-specific metadata',
    });
  }
  if (operation === 'signature') {
    options.push({
      id: 'report',
      type: 'derived',
      label: 'Verification',
      value: 'Extension compared with magic-byte signature',
    });
  }
  if (operation === 'password') {
    options.push(
      {
        id: 'length',
        type: 'range',
        label: 'Password length',
        min: 8,
        max: 128,
        step: 1,
        hint: `${form.length || 20} characters`,
      },
      {
        id: 'symbols',
        type: 'toggle',
        label: 'Include symbols',
        hint: 'Use punctuation in the generated password.',
      },
    );
  }
  return options;
}

function archiveOptions(operation) {
  const options = [{
    id: 'operation',
    type: 'select',
    label: 'Archive operation',
    options: ARCHIVE_OPERATIONS.map((entry) => ({
      value: entry.id,
      label: entry.label,
    })),
  }];
  if (operation === 'create') {
    options.push({
      id: 'format',
      type: 'select',
      label: 'Archive format',
      options: ARCHIVE_FORMATS.map(capabilityChoice),
    });
  } else {
    options.push({
      id: 'detection',
      type: 'derived',
      label: operation === 'inspect' ? 'Listing mode' : 'Input detection',
      value: operation === 'inspect'
        ? 'Read bounded names and sizes without publishing extracted files'
        : 'Format is detected from magic bytes and extension',
    });
  }
  return options;
}

function buildResultRows(snapshot, modeId) {
  const files = new Map(snapshot.files.map((file) => [String(file.id), file]));
  const outputsByJob = new Map(
    snapshot.outputs
      .filter((output) => output.jobId)
      .map((output) => [String(output.jobId), output]),
  );
  return snapshot.jobs
    .filter((job) => job.type === modeId)
    .map((job) => {
      const output = outputsByJob.get(String(job.id));
      const inputIds = job.options?._uploadIds || job.options?.uploadIds || [];
      const sourceLabel = inputIds
        .map((id) => files.get(String(id))?.originalName || files.get(String(id))?.name)
        .filter(Boolean)
        .join(', ');
      const name = output?.name
        || output?.outputName
        || job.outputName
        || `${job.options?.operation || modeId} result`;
      const extension = String(name).split('.').pop()?.toLowerCase();
      return {
        ...job,
        ...output,
        id: output?.id || job.id,
        jobId: job.id,
        name,
        status: job.status,
        sourceLabel: sourceLabel || (job.options?.operation === 'password' ? 'Server generator' : ''),
        outputFormat: extension && extension !== name ? extension : undefined,
        detail: [
          job.options?.operation ? `operation: ${job.options.operation}` : '',
          job.options?.format && job.options.format !== 'auto' ? `format: ${job.options.format}` : '',
        ].filter(Boolean).join(' | '),
        options: job.options,
        error: job.error,
        downloadUrl: output?.downloadUrl,
      };
    })
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export default function useSecurityArchiveWorkbench({ enabled, mode }) {
  const snapshot = useStore(selectSnapshot);
  const modeId = mode?.id || 'security';
  const [contractTick, setContractTick] = useState(0);
  const [form, setForm] = useState(() => defaultSecurityForm());
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [attemptJobIds, setAttemptJobIds] = useState([]);
  const [actionError, setActionError] = useState('');
  const [listingRetry, setListingRetry] = useState(0);
  const [listing, setListing] = useState({ status: 'idle', entries: [], error: '' });
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

  useEffect(() => {
    setForm(modeId === 'archive' ? defaultArchiveForm() : defaultSecurityForm());
    setSelectedFileIds([]);
    setAttemptJobIds([]);
    setActionError('');
    setListing({ status: 'idle', entries: [], error: '' });
  }, [modeId]);

  const effectiveOperation = modeId === 'archive'
    ? archiveOperation(form.operation).id
    : securityOperation(form.operation).id;
  const acceptLookup = useMemo(
    () => enabled && modeId === 'archive'
      ? acceptAttributeFor('archive', effectiveOperation)
      : { available: true, value: '' },
    [contractTick, effectiveOperation, enabled, modeId],
  );
  const accept = acceptLookup.available ? acceptLookup.value : '';
  const compatibleFiles = useMemo(
    () => snapshot.files.filter((file) => (
      !['deleted', 'missing'].includes(file.status)
      && (modeId !== 'archive' || matchesArchiveAccept(file, accept))
    )),
    [accept, modeId, snapshot.files],
  );

  useEffect(() => {
    const compatibleIds = new Set(compatibleFiles.map((file) => String(file.id)));
    setSelectedFileIds((current) => {
      const next = current.filter((id) => compatibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [compatibleFiles]);

  const selectedFiles = selectedFileIds
    .map((id) => compatibleFiles.find((file) => String(file.id) === id))
    .filter(Boolean);
  const activeJobIds = useMemo(
    () => snapshot.jobs
      .filter((job) => job.type === modeId && ['queued', 'running'].includes(job.status))
      .map((job) => job.id),
    [modeId, snapshot.jobs],
  );
  const currentAttemptJobIds = useMemo(
    () => [...new Set([...attemptJobIds, ...activeJobIds])],
    [activeJobIds, attemptJobIds],
  );
  const resultRows = useMemo(() => buildResultRows(snapshot, modeId), [modeId, snapshot]);
  const latestInspectJob = useMemo(
    () => modeId === 'archive'
      ? snapshot.jobs
        .filter((job) => job.type === 'archive'
          && job.status === 'completed'
          && job.options?.operation === 'inspect')
        .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))[0] || null
      : null,
    [modeId, snapshot.jobs],
  );

  useEffect(() => {
    if (!enabled || modeId !== 'archive' || effectiveOperation !== 'inspect' || !latestInspectJob?.id) {
      setListing({ status: 'idle', entries: [], error: '' });
      return undefined;
    }
    let active = true;
    setListing({ status: 'loading', entries: [], error: '' });
    void api.fetchJobText(latestInspectJob.id)
      .then((text) => {
        if (!active) return;
        const payload = JSON.parse(String(text || '{}'));
        const entries = extractArchiveEntries(payload).slice(0, MAX_ARCHIVE_ENTRIES);
        setListing({ status: 'ready', entries, error: '' });
      })
      .catch((error) => {
        if (active) setListing({ status: 'error', entries: [], error: failedReason(error) });
      });
    return () => {
      active = false;
    };
  }, [effectiveOperation, enabled, latestInspectJob?.id, listingRetry, modeId]);

  const contract = getContractState();
  const capabilityId = modeId === 'archive'
    ? archiveCapability(effectiveOperation, form.format)
    : securityOperation(effectiveOperation).capability;
  let capability = { available: true };
  if (contract.status === 'idle' || contract.status === 'loading') {
    capability = { available: false, reason: 'Security and archive capabilities are loading.' };
  } else if (contract.status === 'unavailable') {
    capability = { available: false, reason: contract.reason };
  } else {
    const lookup = gatedOperation(capabilityId);
    if (!lookup.available) capability = { available: false, reason: lookup.reason };
    else if (lookup.value) capability = { available: false, reason: lookup.value.reason };
  }

  const resolvedMode = useMemo(() => {
    if (!mode) return mode;
    const password = modeId === 'security' && effectiveOperation === 'password';
    const inspect = modeId === 'archive' && effectiveOperation === 'inspect';
    return {
      ...mode,
      input: password
        ? { kind: 'none' }
        : {
            ...mode.input,
            multiple: modeId === 'archive' && effectiveOperation === 'create',
          },
      options: modeId === 'archive'
        ? archiveOptions(effectiveOperation)
        : securityOptions(effectiveOperation, form),
      panels: inspect ? ['archive-tree'] : [],
      run: {
        ...mode.run,
        label: modeId === 'archive'
          ? ARCHIVE_OPERATIONS.find((entry) => entry.id === effectiveOperation)?.label || 'Run archive job'
          : effectiveOperation === 'password'
            ? 'Generate password'
            : `Run ${SECURITY_OPERATIONS.find((entry) => entry.id === effectiveOperation)?.label.toLowerCase()}`,
      },
    };
  }, [contractTick, effectiveOperation, form, mode, modeId]);

  const onOptionChange = useCallback((id, value) => {
    setActionError('');
    if (id === 'operation') {
      setForm(modeId === 'archive'
        ? defaultArchiveForm(String(value))
        : defaultSecurityForm(String(value)));
      setSelectedFileIds([]);
      setListing({ status: 'idle', entries: [], error: '' });
      return;
    }
    setForm((current) => ({
      ...current,
      [id]: typeof current[id] === 'boolean' ? Boolean(value) : String(value),
    }));
  }, [modeId]);

  const onToggleFile = useCallback((fileId) => {
    const id = String(fileId);
    const multiple = modeId === 'archive' && effectiveOperation === 'create';
    setSelectedFileIds((current) => {
      if (!multiple) return current.includes(id) ? [] : [id];
      return current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id];
    });
    setActionError('');
  }, [effectiveOperation, modeId]);

  const onFiles = useCallback(async (incoming) => {
    if (!snapshot.workspaceId || !acceptLookup.available) {
      setActionError(capability.reason || 'File input is unavailable.');
      return;
    }
    const incomingFiles = Array.from(incoming || []);
    const rejected = incomingFiles.filter((file) => (
      modeId === 'archive' && !matchesArchiveAccept(file, accept)
    ));
    if (rejected.length) {
      setActionError(`${rejected.map((file) => file.name).join(', ')} is not accepted by the published contract.`);
      return;
    }
    const multiple = modeId === 'archive' && effectiveOperation === 'create';
    const files = multiple ? incomingFiles : incomingFiles.slice(0, 1);
    const uploadedIds = [];
    for (const file of files) {
      const task = createUploadTask(file, { workspaceId: snapshot.workspaceId });
      tasksRef.current.set(task.clientId, task);
      try {
        const uploaded = await task.start();
        uploadedIds.push(String(uploaded.id));
      } catch (error) {
        if (!['PAUSED', 'CANCELLED'].includes(error?.code)) setActionError(failedReason(error));
      } finally {
        if (['completed', 'failed'].includes(task.state)) tasksRef.current.delete(task.clientId);
      }
    }
    if (uploadedIds.length) {
      setSelectedFileIds((current) => multiple
        ? [...new Set([...current, ...uploadedIds])]
        : [uploadedIds[0]]);
      await hydrate({ route: 'security' });
    }
  }, [
    accept,
    acceptLookup.available,
    capability.reason,
    effectiveOperation,
    modeId,
    snapshot.workspaceId,
  ]);

  const onRemoveFile = useCallback(async (file) => {
    if (!snapshot.workspaceId) return;
    const id = String(file.id);
    setSelectedFileIds((current) => current.filter((entry) => entry !== id));
    if (file.localOnly) {
      const task = tasksRef.current.get(id);
      try {
        if (task) await task.cancel();
        tasksRef.current.delete(id);
        resolveOptimisticUpload(id);
      } catch (error) {
        setActionError(failedReason(error));
      }
      return;
    }
    const key = optimisticRequest('delete', id);
    try {
      await api.removeWorkspaceFile(snapshot.workspaceId, id);
      await hydrate({ route: 'security' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const onRun = useCallback(async () => {
    if (!snapshot.workspaceId) return;
    const uploadIds = selectedFiles.map((file) => String(file.id));
    const validation = modeId === 'archive'
      ? validateArchiveWorkbench({ ...form, operation: effectiveOperation }, uploadIds)
      : validateSecurityWorkbench({ ...form, operation: effectiveOperation }, uploadIds);
    if (validation) {
      setActionError(validation);
      return;
    }
    if (selectedFiles.some((file) => file.localOnly || file.status !== 'ready')) {
      setActionError('Wait for every selected file to finish uploading and inspection.');
      return;
    }
    let key = '';
    try {
      const clientRequestId = requestId();
      const options = modeId === 'archive'
        ? buildArchiveJobOptions({ ...form, operation: effectiveOperation }, uploadIds)
        : buildSecurityJobOptions({ ...form, operation: effectiveOperation }, uploadIds);
      key = optimisticRequest('convert', uploadIds[0] || `${modeId}-generator`, { clientRequestId });
      const job = await api.createJob({
        type: modeId,
        workspaceId: snapshot.workspaceId,
        uploadIds,
        clientRequestId,
        options,
      });
      applyPoll({ job });
      rememberActiveJob('security', modeId, job.id);
      setAttemptJobIds([job.id]);
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      if (key) resolveRequest(key);
    }
  }, [effectiveOperation, form, modeId, selectedFiles, snapshot.workspaceId]);

  const onCancel = useCallback(async () => {
    const active = snapshot.jobs.filter((job) => (
      activeJobIds.includes(job.id) && ['queued', 'running'].includes(job.status)
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
  }, [activeJobIds, snapshot.jobs]);

  const retryJobs = useCallback(async (jobs) => {
    if (!snapshot.workspaceId) return;
    const ids = [];
    for (const row of jobs) {
      try {
        const originalId = row.jobId || row.id;
        const original = snapshot.jobs.find((entry) => entry.id === originalId) || row;
        const uploadIds = original.options?._uploadIds || original.options?.uploadIds || [];
        const next = await api.createJob({
          type: original.type || modeId,
          workspaceId: snapshot.workspaceId,
          uploadIds,
          clientRequestId: requestId(),
          options: { ...original.options, _uploadIds: uploadIds },
        });
        applyPoll({ job: next });
        ids.push(next.id);
      } catch (error) {
        setActionError(failedReason(error));
      }
    }
    if (ids.length) setAttemptJobIds(ids);
  }, [modeId, snapshot.jobs, snapshot.workspaceId]);

  const onRemoveResult = useCallback(async (result) => {
    const id = result.jobId || result.id;
    const key = optimisticRequest('delete', id);
    try {
      await api.deleteJob(id);
      await hydrate({ route: 'security' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, []);

  const onDiscardUpload = useCallback(async (session) => {
    try {
      await api.cancelUploadSession(session.id);
      if (snapshot.workspaceId) await recoverUploadSessions(snapshot.workspaceId);
    } catch (error) {
      setActionError(failedReason(error));
    }
  }, [snapshot.workspaceId]);

  const openInput = useCallback(() => {
    document.querySelector('.workbench__input .dropzone__input')?.click();
  }, []);

  return enabled ? {
    mode: resolvedMode,
    capability,
    accept,
    optionValues: { ...form, operation: effectiveOperation },
    panelState: {
      'archive-tree': {
        visible: modeId === 'archive' && effectiveOperation === 'inspect',
        ...listing,
      },
    },
    inputFiles: modeId === 'security' && effectiveOperation === 'password'
      ? []
      : compatibleFiles,
    selectedFileIds,
    attemptJobIds: currentAttemptJobIds,
    resultRows,
    actionError,
    onOptionChange,
    onPanelDispatch: (_panelKey, action) => {
      if (action?.type === 'retry-listing') setListingRetry((value) => value + 1);
    },
    onPanelRecover: () => setActionError('Archive listing is optional; job outputs remain downloadable.'),
    onToggleFile,
    onFiles,
    onRemoveFile,
    onRun,
    onCancel,
    onRetry: (job) => retryJobs([job]),
    onRetryAll: retryJobs,
    onRemoveResult,
    onRemoveBadInput: () => setActionError('Remove the source from Input and upload a corrected file.'),
    onResumeUpload: openInput,
    onDiscardUpload,
    onAddInput: openInput,
    onDownload: async (result) => {
      try {
        if (result.downloadUrl) {
          await api.downloadPath(result.downloadUrl, result.name || result.outputName);
        } else {
          await api.downloadJob(result.jobId || result.id, result.name || result.outputName);
        }
      } catch (error) {
        setActionError(failedReason(error));
      }
    },
    onDownloadBatch: async (rows) => {
      try {
        await api.downloadOutputsZip(snapshot.workspaceId, {
          outputIds: rows.map((row) => row.outputId || row.id).filter(Boolean),
          jobIds: rows.map((row) => row.jobId).filter(Boolean),
        });
      } catch (error) {
        setActionError(failedReason(error));
      }
    },
    onRetryHydrate: () => hydrate({ route: 'security' }),
  } : {};
}
