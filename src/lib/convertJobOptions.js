function nonEmptyIds(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizedFormat(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Build the converter options persisted with a job.
 *
 * The format is always supplied by a detect-derived plan. This module owns no
 * client format catalogue and therefore cannot drift from the server matrix.
 */
export function buildConvertJobOptions({
  fileIds,
  format,
  quality,
  preserveMetadata = true,
  inputFormat = null,
  inputFamily = null,
  inputFileNames = [],
} = {}) {
  const uploadIds = nonEmptyIds(fileIds);
  const outputFormat = normalizedFormat(format);
  if (!uploadIds.length) {
    throw new TypeError('A conversion requires at least one input file');
  }
  if (!outputFormat) {
    throw new TypeError('A conversion requires a detect-derived output format');
  }

  return {
    operation: 'batch',
    format: outputFormat,
    ...(quality ? { quality: String(quality) } : {}),
    preserveMetadata: preserveMetadata !== false,
    _uploadIds: uploadIds,
    ...(inputFormat ? { inputFormat: String(inputFormat) } : {}),
    ...(inputFamily ? { inputFamily: String(inputFamily) } : {}),
    ...(inputFileNames?.length
      ? { inputFileNames: inputFileNames.map(String).filter(Boolean) }
      : {}),
  };
}

export function buildConvertJobRequest({
  workspaceId,
  plan,
  clientRequestId,
} = {}) {
  const workspace = String(workspaceId || '').trim();
  if (!workspace) throw new TypeError('A conversion requires a workspace id');
  const options = buildConvertJobOptions(plan);
  return {
    type: 'converter',
    workspaceId: workspace,
    uploadIds: [...options._uploadIds],
    options,
    ...(clientRequestId ? { clientRequestId: String(clientRequestId) } : {}),
  };
}

export function buildConvertJobRequests({
  workspaceId,
  plans = [],
  requestIdFor,
} = {}) {
  return plans.map((plan, index) => buildConvertJobRequest({
    workspaceId,
    plan,
    clientRequestId: requestIdFor?.(plan, index),
  }));
}

/**
 * Retry preserves the failed attempt's inputs and settings but deliberately
 * requires a fresh request id so the server creates a new immutable job row.
 */
export function buildConvertRetryRequest({
  workspaceId,
  job,
  clientRequestId,
} = {}) {
  if (!job || job.status !== 'failed') {
    throw new TypeError('Only a failed conversion can be retried');
  }
  if (!clientRequestId) {
    throw new TypeError('Retry requires a new client request id');
  }
  const options = job.options && typeof job.options === 'object' ? job.options : {};
  return buildConvertJobRequest({
    workspaceId,
    clientRequestId,
    plan: {
      fileIds: options._uploadIds || options.uploadIds,
      format: options.format || options.outputFormat,
      quality: options.quality,
      preserveMetadata: options.preserveMetadata,
      inputFormat: options.inputFormat,
      inputFamily: options.inputFamily,
      inputFileNames: options.inputFileNames,
    },
  });
}
