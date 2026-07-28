export const ARCHIVE_OPERATIONS = Object.freeze([
  { id: 'create', label: 'Create archive' },
  { id: 'extract', label: 'Extract archive' },
  { id: 'inspect', label: 'Inspect contents' },
]);

export const ARCHIVE_FORMATS = Object.freeze([
  { value: 'zip', label: 'ZIP', capability: 'archive.zip' },
  { value: 'tar', label: 'TAR', capability: 'archive.tar' },
  { value: 'gz', label: 'GZ (single file)', capability: 'archive.gz' },
  { value: '7z', label: '7Z', capability: 'archive.7z' },
]);

export function archiveOperation(operation) {
  return ARCHIVE_OPERATIONS.find((entry) => entry.id === operation)
    || ARCHIVE_OPERATIONS[0];
}

export function archiveCapability(operation, format = 'zip') {
  if (operation !== 'create') return 'archive.zip';
  return ARCHIVE_FORMATS.find((entry) => entry.value === format)?.capability || 'archive.zip';
}

export function defaultArchiveForm(operation = 'create') {
  return {
    operation: archiveOperation(operation).id,
    format: 'zip',
  };
}

export function buildArchiveJobOptions(form = {}, uploadIds = []) {
  const operation = archiveOperation(form.operation).id;
  const format = operation === 'extract'
    ? 'auto'
    : ARCHIVE_FORMATS.some((entry) => entry.value === form.format)
      ? form.format
      : 'zip';
  return {
    operation,
    format,
    _mode: 'archive',
    _uploadIds: uploadIds.map(String),
  };
}

export function validateArchiveWorkbench(form = {}, uploadIds = []) {
  const operation = archiveOperation(form.operation).id;
  if (operation === 'create' && uploadIds.length === 0) {
    return 'Select at least one file to create an archive.';
  }
  if (operation !== 'create' && uploadIds.length !== 1) {
    return 'Select exactly one archive to extract or inspect.';
  }
  if (operation === 'create' && form.format === 'gz' && uploadIds.length !== 1) {
    return 'GZ creation accepts exactly one file.';
  }
  if (operation === 'create' && !ARCHIVE_FORMATS.some((entry) => entry.value === form.format)) {
    return 'Choose a published archive format.';
  }
  return '';
}

export function matchesArchiveAccept(file, accept) {
  if (!accept) return true;
  const name = String(file?.originalName || file?.name || '').toLowerCase();
  const mime = String(file?.mime || file?.type || '').toLowerCase();
  return String(accept).split(',').some((token) => {
    const rule = token.trim().toLowerCase();
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return mime.startsWith(rule.slice(0, -1));
    return rule && mime === rule;
  });
}
