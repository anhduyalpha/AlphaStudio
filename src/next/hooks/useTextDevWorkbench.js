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
  applyEditorCase,
  buildTextWorkbenchJobOptions,
  defaultTextForm,
  matchesTextAccept,
  textOperationCapability,
  textOperationsFor,
  validateTextWorkbench,
} from '../../lib/textJobOptions.js';
import {
  boundedDiffLines,
  copyText,
  downloadText,
  editorStats,
  summarizeDiff,
} from '../../lib/textDiff.js';
import useStore from './useStore.js';

const selectSnapshot = (snapshot) => snapshot;

function requestId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `text-${suffix}`;
}

function failedReason(error) {
  return error instanceof Error ? error.message : String(error || 'Text operation failed');
}

function operationChoices(modeId) {
  return textOperationsFor(modeId).map((entry) => {
    if (!entry.capability) return { value: entry.id, label: entry.label };
    const lookup = gatedOperation(entry.capability);
    const unavailable = !lookup.available || Boolean(lookup.value);
    return {
      value: entry.id,
      label: `${entry.label}${unavailable ? ' (unavailable)' : ''}`,
      disabled: unavailable,
    };
  });
}

function resolvedOptions(modeId, operation, form, choices) {
  if (!['text', 'dev'].includes(modeId)) return [];
  const options = [{
    id: 'operation',
    type: 'select',
    label: modeId === 'dev' ? 'Developer utility' : 'Text operation',
    options: choices,
    disabled: !choices.length,
  }];
  if (operation === 'case') {
    options.push({
      id: 'caseMode',
      type: 'select',
      label: 'Case mode',
      options: [
        { value: 'title', label: 'Title Case' },
        { value: 'upper', label: 'UPPER' },
        { value: 'lower', label: 'lower' },
        { value: 'snake', label: 'snake_case' },
        { value: 'camel', label: 'camelCase' },
      ],
    });
  }
  if (modeId === 'dev' && operation === 'format-json') {
    options.push(
      {
        id: 'indent',
        type: 'select',
        label: 'Indentation',
        options: [
          { value: '2', label: '2 spaces' },
          { value: '4', label: '4 spaces' },
        ],
      },
      {
        id: 'sortKeys',
        type: 'toggle',
        label: 'Sort object keys',
        hint: 'Sort keys alphabetically at every object level.',
      },
    );
  }
  if (modeId === 'dev' && operation === 'uuid') {
    options.push({
      id: 'uuidCount',
      type: 'text',
      label: 'UUID count',
      hint: 'Between 1 and 100.',
    });
  }
  if (operation === 'hash') {
    options.push({
      id: 'algorithm',
      type: 'derived',
      label: 'Algorithm',
      value: 'SHA-256',
    });
  }
  return options;
}

function jobBelongsToMode(job, modeId) {
  const marked = job.options?._mode;
  if (marked) return marked === modeId;
  const operation = String(job.options?.operation || '');
  return textOperationsFor(modeId).some((entry) => entry.id === operation);
}

function buildResultRows(snapshot, modeId) {
  const files = new Map(snapshot.files.map((file) => [String(file.id), file]));
  const outputsByJob = new Map(
    snapshot.outputs
      .filter((output) => output.jobId)
      .map((output) => [String(output.jobId), output]),
  );
  return snapshot.jobs
    .filter((job) => job.type === 'text' && jobBelongsToMode(job, modeId))
    .map((job) => {
      const output = outputsByJob.get(String(job.id));
      const inputIds = job.options?._uploadIds || job.options?.uploadIds || [];
      const sourceLabel = inputIds
        .map((id) => files.get(String(id))?.originalName || files.get(String(id))?.name)
        .filter(Boolean)
        .join(', ');
      const name = output?.name || output?.outputName || job.outputName || `${job.options?.operation || 'text'} result`;
      const extension = String(name).split('.').pop()?.toLowerCase();
      return {
        ...job,
        ...output,
        id: output?.id || job.id,
        jobId: job.id,
        name,
        status: job.status,
        sourceLabel: sourceLabel || (job.options?.input ? 'Inline UTF-8 input' : ''),
        outputFormat: extension && extension !== name ? extension : undefined,
        detail: job.options?.operation ? `operation: ${job.options.operation}` : '',
        options: job.options,
        error: job.error,
        downloadUrl: output?.downloadUrl,
      };
    })
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export default function useTextDevWorkbench({ enabled, mode }) {
  const snapshot = useStore(selectSnapshot);
  const modeId = mode?.id || 'text';
  const [contractTick, setContractTick] = useState(0);
  const [form, setForm] = useState(() => defaultTextForm('text'));
  const [inputValue, setInputValue] = useState('');
  const [comparison, setComparison] = useState('');
  const [selectedFileId, setSelectedFileId] = useState('');
  const [attemptJobIds, setAttemptJobIds] = useState([]);
  const [localResults, setLocalResults] = useState([]);
  const [actionError, setActionError] = useState('');
  const [outputPreview, setOutputPreview] = useState({ status: 'idle', text: '', error: '' });
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
    setForm(defaultTextForm(modeId));
    setSelectedFileId('');
    setComparison('');
    setLocalResults([]);
    setActionError('');
    setOutputPreview({ status: 'idle', text: '', error: '' });
  }, [modeId]);

  const operations = useMemo(() => textOperationsFor(modeId), [modeId]);
  const operation = operations.find((entry) => entry.id === form.operation) || operations[0] || null;
  const effectiveOperation = operation?.id || '';
  const choices = useMemo(() => operationChoices(modeId), [contractTick, modeId]);
  const acceptLookup = useMemo(
    () => enabled && ['text', 'ocr'].includes(modeId)
      ? acceptAttributeFor('text', effectiveOperation)
      : { available: true, value: '' },
    [contractTick, effectiveOperation, enabled, modeId],
  );
  const accept = acceptLookup.available ? acceptLookup.value : '';
  const compatibleFiles = useMemo(
    () => snapshot.files.filter((file) => (
      !['deleted', 'missing'].includes(file.status) && matchesTextAccept(file, accept)
    )),
    [accept, snapshot.files],
  );

  useEffect(() => {
    if (!selectedFileId) return;
    if (!compatibleFiles.some((file) => String(file.id) === selectedFileId)) {
      setSelectedFileId('');
    }
  }, [compatibleFiles, selectedFileId]);

  const selectedFile = compatibleFiles.find((file) => String(file.id) === selectedFileId) || null;
  const activeJobIds = useMemo(
    () => snapshot.jobs
      .filter((job) => (
        job.type === 'text'
        && jobBelongsToMode(job, modeId)
        && ['queued', 'running'].includes(job.status)
      ))
      .map((job) => job.id),
    [modeId, snapshot.jobs],
  );
  const currentAttemptJobIds = useMemo(
    () => [...new Set([...attemptJobIds, ...activeJobIds])],
    [activeJobIds, attemptJobIds],
  );
  const resultRows = useMemo(() => buildResultRows(snapshot, modeId), [modeId, snapshot]);
  const latestCompletedJob = useMemo(
    () => snapshot.jobs
      .filter((job) => (
        job.type === 'text'
        && job.status === 'completed'
        && jobBelongsToMode(job, modeId)
      ))
      .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))[0] || null,
    [modeId, snapshot.jobs],
  );

  useEffect(() => {
    if (!enabled || modeId !== 'dev' || !latestCompletedJob?.id) {
      setOutputPreview({ status: 'idle', text: '', error: '' });
      return undefined;
    }
    let active = true;
    setOutputPreview({ status: 'loading', text: '', error: '' });
    void api.fetchJobText(latestCompletedJob.id)
      .then((text) => {
        if (active) setOutputPreview({ status: 'ready', text: String(text || ''), error: '' });
      })
      .catch((error) => {
        if (active) setOutputPreview({ status: 'error', text: '', error: failedReason(error) });
      });
    return () => {
      active = false;
    };
  }, [enabled, latestCompletedJob?.id, modeId]);

  const contract = getContractState();
  const operationCapability = textOperationCapability(modeId, effectiveOperation);
  let capability = { available: true };
  if (contract.status === 'idle' || contract.status === 'loading') {
    capability = { available: false, reason: 'Text capabilities are loading.' };
  } else if (contract.status === 'unavailable') {
    capability = { available: false, reason: contract.reason };
  } else if (operationCapability) {
    const lookup = gatedOperation(operationCapability);
    if (!lookup.available) capability = { available: false, reason: lookup.reason };
    else if (lookup.value) capability = { available: false, reason: lookup.value.reason };
  }

  const resolvedMode = useMemo(() => mode ? ({
    ...mode,
    input: modeId === 'dev' && effectiveOperation === 'uuid'
      ? { kind: 'none' }
      : mode.input,
    options: resolvedOptions(modeId, effectiveOperation, form, choices),
  }) : mode, [choices, effectiveOperation, form, mode, modeId]);

  const stats = useMemo(() => editorStats(inputValue), [inputValue]);
  const editorDiff = useMemo(
    () => boundedDiffLines(inputValue, comparison),
    [comparison, inputValue],
  );
  const diffSummary = useMemo(() => summarizeDiff(editorDiff.hunks), [editorDiff.hunks]);

  const onOptionChange = useCallback((id, value) => {
    setActionError('');
    if (id === 'operation') {
      setForm(defaultTextForm(modeId, String(value)));
      return;
    }
    setForm((current) => ({
      ...current,
      [id]: typeof current[id] === 'boolean' ? Boolean(value) : String(value),
    }));
  }, [modeId]);

  const onPanelDispatch = useCallback((_panelKey, action) => {
    if (!action || typeof action !== 'object') return;
    setActionError('');
    if (action.type === 'set-comparison') setComparison(String(action.value || ''));
    if (action.type === 'apply-case') {
      setInputValue((current) => applyEditorCase(current, action.value));
    }
    if (action.type === 'clear-editor') {
      setInputValue('');
      setComparison('');
      setLocalResults([]);
    }
    if (action.type === 'copy-editor') {
      void copyText(inputValue).then((ok) => {
        if (!ok) setActionError('Could not copy editor text.');
      });
    }
    if (action.type === 'export-editor') downloadText('editor.txt', inputValue);
    if (action.type === 'copy-output') {
      void copyText(outputPreview.text).then((ok) => {
        if (!ok) setActionError('Could not copy utility output.');
      });
    }
    if (action.type === 'clear-output-error') {
      setOutputPreview((current) => ({ ...current, error: '' }));
    }
  }, [inputValue, outputPreview.text]);

  const onToggleFile = useCallback((fileId) => {
    const id = String(fileId);
    setSelectedFileId((current) => current === id ? '' : id);
    setActionError('');
  }, []);

  const onFiles = useCallback(async (incoming) => {
    if (!snapshot.workspaceId || !acceptLookup.available) {
      setActionError(capability.reason || 'Text input is unavailable.');
      return;
    }
    const files = Array.from(incoming || []);
    const rejected = files.filter((file) => !matchesTextAccept(file, accept));
    if (rejected.length) {
      setActionError(`${rejected.map((file) => file.name).join(', ')} is not accepted by the published contract.`);
      return;
    }
    const file = files[0];
    if (!file) return;
    const task = createUploadTask(file, { workspaceId: snapshot.workspaceId });
    tasksRef.current.set(task.clientId, task);
    try {
      const uploaded = await task.start();
      setSelectedFileId(String(uploaded.id));
      await hydrate({ route: 'text' });
    } catch (error) {
      if (!['PAUSED', 'CANCELLED'].includes(error?.code)) setActionError(failedReason(error));
    } finally {
      if (['completed', 'failed'].includes(task.state)) tasksRef.current.delete(task.clientId);
    }
  }, [accept, acceptLookup.available, capability.reason, snapshot.workspaceId]);

  const onRemoveFile = useCallback(async (file) => {
    if (!snapshot.workspaceId) return;
    const id = String(file.id);
    setSelectedFileId((current) => current === id ? '' : current);
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
      await hydrate({ route: 'text' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const onRun = useCallback(async () => {
    if (modeId === 'editor') {
      const summary = summarizeDiff(boundedDiffLines(inputValue, comparison).hunks);
      const result = {
        id: `editor-${Date.now()}`,
        name: 'Editor analysis',
        status: 'completed',
        sourceLabel: 'Browser-only',
        outputFormat: 'json',
        detail: `${stats.words} words | +${summary.added} / −${summary.removed}`,
        localText: JSON.stringify({ stats, diff: summary }, null, 2),
      };
      setLocalResults([result]);
      return;
    }
    if (!snapshot.workspaceId || !operation) return;
    const uploadIds = ['text', 'ocr'].includes(modeId) && selectedFile
      ? [String(selectedFile.id)]
      : [];
    const validation = validateTextWorkbench({
      mode: modeId,
      form: { ...form, operation: effectiveOperation },
      input: inputValue,
      uploadIds,
    });
    if (validation) {
      setActionError(validation);
      return;
    }
    if (selectedFile && (selectedFile.localOnly || selectedFile.status !== 'ready')) {
      setActionError('Wait for the selected file to finish uploading and inspection.');
      return;
    }
    let key = '';
    try {
      const clientRequestId = requestId();
      const options = buildTextWorkbenchJobOptions({
        mode: modeId,
        form: { ...form, operation: effectiveOperation },
        input: inputValue,
        uploadIds,
      });
      key = optimisticRequest('convert', uploadIds[0] || `${modeId}-inline`, { clientRequestId });
      const job = await api.createJob({
        type: 'text',
        workspaceId: snapshot.workspaceId,
        uploadIds,
        clientRequestId,
        options,
      });
      applyPoll({ job });
      rememberActiveJob('text', modeId, job.id);
      setAttemptJobIds([job.id]);
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      if (key) resolveRequest(key);
    }
  }, [
    comparison,
    effectiveOperation,
    form,
    inputValue,
    modeId,
    operation,
    selectedFile,
    snapshot.workspaceId,
    stats,
  ]);

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
    for (const job of jobs) {
      try {
        const originalId = job.jobId || job.id;
        const original = snapshot.jobs.find((entry) => entry.id === originalId) || job;
        const uploadIds = original.options?._uploadIds || original.options?.uploadIds || [];
        const next = await api.createJob({
          type: 'text',
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
  }, [snapshot.jobs, snapshot.workspaceId]);

  const onRemoveResult = useCallback(async (result) => {
    if (result.localText != null) {
      setLocalResults((current) => current.filter((entry) => entry.id !== result.id));
      return;
    }
    const id = result.jobId || result.id;
    const key = optimisticRequest('delete', id);
    try {
      await api.deleteJob(id);
      await hydrate({ route: 'text' });
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
    inputValue,
    panelState: {
      compare: {
        visible: ['editor', 'dev'].includes(modeId),
        variant: modeId === 'dev' ? 'developer' : 'editor',
        input: inputValue,
        comparison,
        stats,
        output: outputPreview.text,
        outputStatus: outputPreview.status,
        outputError: outputPreview.error,
      },
      diff: {
        visible: modeId === 'editor',
        left: inputValue,
        right: comparison,
      },
    },
    inputFiles: ['text', 'ocr'].includes(modeId) ? compatibleFiles : [],
    selectedFileIds: selectedFileId ? [selectedFileId] : [],
    attemptJobIds: currentAttemptJobIds,
    resultRows,
    localResults,
    actionError,
    onInputValueChange: (value) => {
      setInputValue(String(value || ''));
      setActionError('');
    },
    onOptionChange,
    onPanelDispatch,
    onPanelRecover: () => setActionError('Use the standard text controls while this panel is unavailable.'),
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
        if (result.localText != null) {
          downloadText('editor-analysis.json', result.localText, 'application/json;charset=utf-8');
        } else if (result.downloadUrl) {
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
        const localRows = rows.filter((row) => row.localText != null);
        localRows.forEach((row) => downloadText(
          `${row.name || 'editor-analysis'}.json`,
          row.localText,
          'application/json;charset=utf-8',
        ));
        const remoteRows = rows.filter((row) => row.localText == null);
        if (remoteRows.length) {
          await api.downloadOutputsZip(snapshot.workspaceId, {
            outputIds: remoteRows.map((row) => row.outputId || row.id).filter(Boolean),
            jobIds: remoteRows.map((row) => row.jobId).filter(Boolean),
          });
        }
      } catch (error) {
        setActionError(failedReason(error));
      }
    },
    onRetryHydrate: () => hydrate({ route: 'text' }),
    editorSummary: diffSummary,
  } : {};
}
