/**
 * Pure converter grouping / settings helpers.
 * Groups uploaded files by detected format/family for batch vs per-card UI.
 */

/**
 * @typedef {object} DetectedFile
 * @property {string} id
 * @property {string} [originalName]
 * @property {number} [size]
 * @property {string|null} [mime]
 * @property {string} [status]
 * @property {object|null} [detect]
 */

/**
 * Group key: prefer format, fall back to family, else unknown.
 * @param {DetectedFile} file
 */
export function groupKeyForFile(file) {
  const d = file?.detect;
  if (!d) return 'unknown';
  if (d.unsupported || d.family === 'unknown') return 'unsupported';
  const format = String(d.format || '').toLowerCase();
  const family = String(d.family || '').toLowerCase();
  if (format && format !== 'unknown') return `format:${format}`;
  if (family && family !== 'unknown') return `family:${family}`;
  return 'unknown';
}

/**
 * Build conversion groups from server file DTOs (with detect).
 * Same format → one group; mixed → multiple groups.
 *
 * @param {DetectedFile[]} files
 * @returns {{ groups: Array, unsupported: DetectedFile[], mode: 'batch'|'mixed'|'empty' }}
 */
export function buildConversionGroups(files = []) {
  const usable = (files || []).filter((f) => f && f.status !== 'deleted' && f.status !== 'missing');
  if (!usable.length) {
    return { groups: [], unsupported: [], mode: 'empty' };
  }

  const map = new Map();
  const unsupported = [];

  for (const f of usable) {
    const key = groupKeyForFile(f);
    // No detect, unknown family, or explicit unsupported → not convertible
    if (key === 'unsupported' || key === 'unknown') {
      unsupported.push(f);
      continue;
    }
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(f);
  }

  const groups = [...map.entries()].map(([key, members]) => {
    const first = members[0];
    const detect = first.detect || {};
    const outputs = compatibleOutputsForMembers(members);
    const recommended =
      detect.recommendedOutput ||
      outputs.find((o) => o.available)?.format ||
      null;
    const recommendedOption = outputs.find(
      (o) => o.available && o.format === recommended,
    );
    return {
      id: key,
      key,
      format: detect.format || null,
      family: detect.family || null,
      label: formatGroupLabel(detect),
      members,
      fileIds: members.map((m) => m.id),
      outputs,
      recommendedOutput: recommended,
      valid: outputs.some((o) => o.available),
      engine:
        recommendedOption?.engine?.name ||
        detect.preferredEngine?.name ||
        engineForFamily(detect.family),
      preferredEngine: recommendedOption?.engine || detect.preferredEngine || null,
    };
  });

  // Sort groups by label for stable UI
  groups.sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const mode = groups.length === 0 ? 'empty' : groups.length === 1 ? 'batch' : 'mixed';
  return { groups, unsupported, mode };
}

/**
 * Intersection of available outputs across members of a group.
 */
export function compatibleOutputsForMembers(members) {
  if (!members?.length) return [];
  let inter = null;
  let baseList = members[0].detect?.outputs || [];
  for (const m of members) {
    const list = m.detect?.outputs || [];
    const avail = new Set(list.filter((o) => o.available).map((o) => o.format));
    if (!inter) inter = avail;
    else inter = new Set([...inter].filter((x) => avail.has(x)));
  }
  if (!inter) return [];
  // Prefer labels from first member
  const seen = new Set();
  const out = [];
  for (const m of members) {
    for (const o of m.detect?.outputs || []) {
      if (!inter.has(o.format) || seen.has(o.format)) continue;
      seen.add(o.format);
      out.push({ ...o, available: true });
    }
  }
  // Fallback if base empty but inter non-empty
  if (!out.length && baseList.length) {
    return baseList.filter((o) => inter.has(o.format)).map((o) => ({ ...o, available: true }));
  }
  return out;
}

/**
 * Cross-group batch: when mixed formats share a common target format.
 */
export function sharedTargetsAcrossGroups(groups) {
  if (!groups?.length) return [];
  let inter = null;
  for (const g of groups) {
    const avail = new Set((g.outputs || []).filter((o) => o.available).map((o) => o.format));
    if (!inter) inter = avail;
    else inter = new Set([...inter].filter((x) => avail.has(x)));
  }
  if (!inter?.size) return [];
  const first = groups[0].outputs || [];
  return first.filter((o) => inter.has(o.format));
}

export function formatGroupLabel(detect) {
  if (!detect) return 'Unknown';
  const fmt = detect.format ? String(detect.format).toUpperCase() : null;
  const fam = detect.family
    ? String(detect.family).charAt(0).toUpperCase() + String(detect.family).slice(1)
    : null;
  if (fmt && fam) return `${fmt} · ${fam}`;
  return fmt || fam || 'Unknown';
}

export function engineForFamily(family) {
  switch (String(family || '').toLowerCase()) {
    case 'image':
      return 'Sharp';
    case 'audio':
    case 'video':
      return 'FFmpeg';
    case 'document':
    case 'spreadsheet':
    case 'presentation':
      return 'LibreOffice';
    case 'pdf':
      return 'pdf-lib';
    case 'archive':
      return 'Archive';
    case 'text':
      return 'Text/PDF';
    default:
      return 'Converter';
  }
}

/** Resolve the actual registry-selected engine for a group's current target. */
export function engineForOutput(group, format) {
  const option = (group?.outputs || []).find(
    (output) => output.available && output.format === format,
  );
  return option?.engine?.name || group?.preferredEngine?.name || group?.engine || 'Converter';
}

/**
 * Default per-group settings.
 */
export function defaultGroupSettings(group) {
  return {
    format: group?.recommendedOutput || '',
    quality: 'balanced',
    preserveMetadata: true,
  };
}

/**
 * Apply source settings onto target groups that share the same format option.
 */
export function applySettingsToCompatible(sourceSettings, groups, sourceGroupId) {
  const src = sourceSettings?.[sourceGroupId];
  if (!src?.format) return { ...sourceSettings };
  const next = { ...sourceSettings };
  for (const g of groups || []) {
    if (g.id === sourceGroupId) continue;
    const ok = (g.outputs || []).some((o) => o.available && o.format === src.format);
    if (ok) {
      next[g.id] = {
        ...(next[g.id] || defaultGroupSettings(g)),
        format: src.format,
        quality: src.quality ?? 'balanced',
        preserveMetadata: src.preserveMetadata !== false,
      };
    }
  }
  return next;
}

/**
 * Validate group can convert with settings.
 */
export function canConvertGroup(group, settings) {
  if (!group?.valid || !group.fileIds?.length) return false;
  const fmt = settings?.format;
  if (!fmt) return false;
  return (group.outputs || []).some((o) => o.available && o.format === fmt);
}

/**
 * Resolve source display names for a Converted Files row.
 * Prefers options.inputFileNames (hydrate), then files list via _uploadIds/uploadIds.
 */
function resolveSourceNames(opts, fileById) {
  if (Array.isArray(opts.inputFileNames) && opts.inputFileNames.length) {
    return opts.inputFileNames.map(String).filter(Boolean);
  }
  const inputIds = Array.isArray(opts._uploadIds)
    ? opts._uploadIds.map(String)
    : Array.isArray(opts.uploadIds)
      ? opts.uploadIds.map(String)
      : [];
  if (!inputIds.length) return [];
  return inputIds.map((id) => fileById.get(id)?.originalName).filter(Boolean);
}

/**
 * Normalize result rows from hydrated jobs + outputs for Converted Files list.
 */
export function buildResultRows({ jobs = [], outputs = [], files = [] } = {}) {
  const fileById = new Map((files || []).map((f) => [f.id, f]));
  const outByJob = new Map();
  for (const o of outputs || []) {
    if (o.jobId) outByJob.set(o.jobId, o);
  }

  return (jobs || [])
    .filter((j) => j.type === 'converter' || j.tool === 'converter')
    .map((j) => {
      const opts = j.options || {};
      const out = outByJob.get(j.id);
      const sourceNames = resolveSourceNames(opts, fileById);
      const downloadable =
        j.status === 'completed' &&
        Boolean(j.downloadUrl || out?.downloadUrl) &&
        (out?.size == null || out.size > 0);

      return {
        id: j.id,
        jobId: j.id,
        outputId: out?.id || null,
        outputName: j.outputName || out?.name || null,
        sourceLabel: sourceNames.length ? sourceNames.join(', ') : out?.name ? 'Source file' : '—',
        inputFormat: opts.inputFormat || null,
        outputFormat: opts.format || opts.outputFormat || null,
        size: out?.size ?? null,
        duration: opts.duration ?? j.meta?.duration ?? null,
        engine: j.meta?.conversionEngine?.name || null,
        status: j.status,
        progress: j.progress ?? 0,
        message: j.message,
        error: j.error,
        downloadUrl: downloadable
          ? j.downloadUrl || out?.downloadUrl || null
          : null,
        previewUrl:
          out?.previewUrl ||
          (out?.id && isPreviewable(out?.mime || j.outputMime)
            ? `/api/outputs/${out.id}/download`
            : j.status === 'completed' &&
                j.downloadUrl &&
                isPreviewable(j.outputMime || out?.mime)
              ? j.downloadUrl
              : null),
        outputMime: j.outputMime || out?.mime || null,
        createdAt: j.createdAt || out?.createdAt,
        selected: false,
      };
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/**
 * Apply Converted Files visibility: format/status/sort + hide completed + hidden ids.
 * Pure helper — used by ConverterView and unit tests.
 */
export function applyResultVisibility(
  rows,
  {
    status = 'all',
    format = 'all',
    sort = 'newest',
    hideCompleted = false,
    hiddenIds = [],
  } = {},
) {
  const hidden = new Set((hiddenIds || []).map(String));
  let list = (rows || []).filter((r) => !hidden.has(String(r.id)) && !hidden.has(String(r.jobId)));
  if (hideCompleted) {
    list = list.filter((r) => r.status !== 'completed');
  }
  return filterSortResults(list, { status, format, sort });
}

/** True when a job's input upload ids intersect the given file id set. */
export function jobTouchesFileIds(job, fileIds = []) {
  if (!job || !fileIds?.length) return false;
  const opts = job.options || {};
  const ids = Array.isArray(opts._uploadIds)
    ? opts._uploadIds.map(String)
    : Array.isArray(opts.uploadIds)
      ? opts.uploadIds.map(String)
      : [];
  if (!ids.length) return false;
  const set = new Set(fileIds.map(String));
  return ids.some((id) => set.has(String(id)));
}

export function isPreviewable(mime) {
  if (!mime) return false;
  return (
    mime.startsWith('image/') ||
    mime === 'application/pdf' ||
    mime.startsWith('text/')
  );
}

/**
 * Filter/sort result rows.
 */
export function filterSortResults(rows, { status = 'all', format = 'all', sort = 'newest' } = {}) {
  let list = [...(rows || [])];
  if (status && status !== 'all') {
    list = list.filter((r) => r.status === status);
  }
  if (format && format !== 'all') {
    list = list.filter(
      (r) =>
        String(r.outputFormat || '').toLowerCase() === String(format).toLowerCase() ||
        String(r.inputFormat || '').toLowerCase() === String(format).toLowerCase(),
    );
  }
  if (sort === 'oldest') list.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  else if (sort === 'name') list.sort((a, b) => String(a.outputName || '').localeCompare(String(b.outputName || '')));
  else if (sort === 'status') list.sort((a, b) => String(a.status).localeCompare(String(b.status)));
  else list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return list;
}

/**
 * Deduplicate job create: reject if same uploadIds+format already queued/running.
 */
export function hasActiveDuplicateJob(jobs, { uploadIds = [], format, type = 'converter' } = {}) {
  const key = [...uploadIds].sort().join(',') + '|' + String(format || '');
  return (jobs || []).some((j) => {
    if (j.type !== type && j.tool !== type) return false;
    if (!['queued', 'running'].includes(j.status)) return false;
    const opts = j.options || {};
    const ids = Array.isArray(opts._uploadIds)
      ? opts._uploadIds
      : Array.isArray(opts.uploadIds)
        ? opts.uploadIds
        : [];
    // If options don't carry ids, fall back to false (server has job_files)
    if (!ids.length) return false;
    const k2 = [...ids].sort().join(',') + '|' + String(opts.format || opts.outputFormat || '');
    return k2 === key;
  });
}

/**
 * Toggle a file id in a multi-select set (immutable).
 * @param {Iterable<string>} selected
 * @param {string} fileId
 * @returns {Set<string>}
 */
export function toggleFileSelection(selected, fileId) {
  const next = new Set(selected || []);
  const id = String(fileId || '');
  if (!id) return next;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Select or clear all members of a group within the selection set.
 * @param {Iterable<string>} selected
 * @param {{ fileIds?: string[] }} group
 * @param {boolean} select
 * @returns {Set<string>}
 */
export function setGroupFileSelection(selected, group, select = true) {
  const next = new Set(selected || []);
  for (const id of group?.fileIds || []) {
    if (select) next.add(String(id));
    else next.delete(String(id));
  }
  return next;
}

/**
 * Intersection of available output formats for a subset of files.
 * @param {Array<{ id?: string, detect?: { outputs?: Array } }>} files
 * @param {Iterable<string>} selectedIds
 */
export function outputsForSelectedFiles(files = [], selectedIds = []) {
  const idSet = new Set([...selectedIds].map(String));
  const members = (files || []).filter((f) => idSet.has(String(f.id)));
  return compatibleOutputsForMembers(members);
}

/**
 * Whether a selected subset can convert with the given format.
 */
export function canConvertSelection(files, selectedIds, format) {
  if (!format || !selectedIds || ![...selectedIds].length) return false;
  return outputsForSelectedFiles(files, selectedIds).some(
    (o) => o.available && o.format === format,
  );
}

/**
 * Build convert-all job plans: one plan per valid group using its settings.
 * Pure helper used by Convert all and unit tests.
 *
 * @param {Array} groups from buildConversionGroups
 * @param {Record<string, { format?: string, quality?: string, preserveMetadata?: boolean }>} groupSettings
 * @returns {Array<{ groupId: string, fileIds: string[], format: string, quality: string, preserveMetadata: boolean, inputFormat: string|null, inputFamily: string|null }>}
 */
export function buildConvertAllPlans(groups = [], groupSettings = {}) {
  const plans = [];
  for (const group of groups || []) {
    const settings = groupSettings[group.id] || defaultGroupSettings(group);
    if (!canConvertGroup(group, settings)) continue;
    plans.push({
      groupId: group.id,
      fileIds: [...(group.fileIds || [])],
      format: settings.format,
      quality: settings.quality || 'balanced',
      preserveMetadata: settings.preserveMetadata !== false,
      inputFormat: group.format || null,
      inputFamily: group.family || null,
    });
  }
  return plans;
}

/**
 * Build a convert plan for a subset of files (must share a compatible target).
 * Uses group settings for the primary group when provided.
 */
export function buildConvertSelectionPlan(files, selectedIds, format, settings = {}) {
  const ids = [...(selectedIds || [])].map(String).filter(Boolean);
  if (!ids.length || !format) return null;
  if (!canConvertSelection(files, ids, format)) return null;
  return {
    fileIds: ids,
    format,
    quality: settings.quality || 'balanced',
    preserveMetadata: settings.preserveMetadata !== false,
  };
}

/**
 * Aggregate progress across active converter jobs (0–100).
 * Returns { value, indeterminate, label } for ProgressWave.
 */
export function aggregateJobProgress(jobs = {}) {
  const active = Object.values(jobs || {}).filter((j) =>
    ['queued', 'running'].includes(j?.status),
  );
  if (!active.length) {
    return { value: 0, indeterminate: false, label: 'Idle' };
  }
  const running = active.filter((j) => j.status === 'running');
  if (!running.length) {
    return {
      value: 0,
      indeterminate: true,
      label: `${active.length} queued`,
    };
  }
  const withProgress = running.filter((j) => typeof j.progress === 'number' && j.progress > 0);
  if (!withProgress.length) {
    return {
      value: 0,
      indeterminate: true,
      label: `${running.length} running`,
    };
  }
  const sum = withProgress.reduce((acc, j) => acc + (Number(j.progress) || 0), 0);
  const value = Math.round(sum / withProgress.length);
  return {
    value,
    indeterminate: false,
    label: `${running.length} running · ${value}%`,
  };
}

/**
 * Settings schema for the selected engine/family — only real knobs.
 * @returns {Array<{ id: string, type: string, label: string, description?: string }>}
 */
export function settingsSchemaForEngine(engineName, family) {
  const name = String(engineName || '').toLowerCase();
  const fam = String(family || '').toLowerCase();
  const schema = [];
  const isMedia = fam === 'audio' || fam === 'video' || /ffmpeg/i.test(name);
  const isImage = fam === 'image' || /sharp|alphastudio/i.test(name);
  const isOffice = /libreoffice/i.test(name) || ['document', 'spreadsheet', 'presentation'].includes(fam);
  const isPandoc = /pandoc/i.test(name);
  const isCalibre = /calibre/i.test(name);
  const isPython = /python/i.test(name);

  if (isImage || isMedia) {
    schema.push({
      id: 'quality',
      type: 'select',
      label: 'Quality',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'high', label: 'High quality' },
      ],
    });
    schema.push({
      id: 'preserveMetadata',
      type: 'toggle',
      label: 'Preserve metadata',
      description: 'Only when the selected encoder supports it.',
    });
  } else if (isOffice || isPandoc || isCalibre || isPython) {
    // No fake quality knobs for engines that ignore them.
  } else {
    schema.push({
      id: 'quality',
      type: 'select',
      label: 'Quality',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'high', label: 'High quality' },
      ],
    });
  }
  return schema;
}
