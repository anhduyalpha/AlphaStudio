export const TEXT_OPERATIONS = Object.freeze([
  Object.freeze({ id: 'cleanup', label: 'Cleanup', capability: 'text.cleanup' }),
  Object.freeze({ id: 'word-count', label: 'Analyze', capability: 'text.cleanup' }),
  Object.freeze({ id: 'case', label: 'Case', capability: 'text.cleanup' }),
  Object.freeze({ id: 'hash', label: 'Hash', capability: 'text.hash' }),
]);

export const DEV_OPERATIONS = Object.freeze([
  Object.freeze({ id: 'format-json', label: 'JSON Formatter', capability: 'text.format-json' }),
  Object.freeze({ id: 'base64-encode', label: 'Base64 Encode', capability: 'text.base64' }),
  Object.freeze({ id: 'base64-decode', label: 'Base64 Decode', capability: 'text.base64' }),
  Object.freeze({ id: 'url-encode', label: 'URL Encode', capability: 'text.url' }),
  Object.freeze({ id: 'url-decode', label: 'URL Decode', capability: 'text.url' }),
  Object.freeze({ id: 'hash', label: 'SHA-256 Hash', capability: 'text.hash' }),
  Object.freeze({ id: 'cleanup', label: 'Text Cleaner', capability: 'text.cleanup' }),
  Object.freeze({ id: 'uuid', label: 'UUID Generator', capability: null }),
]);

export function textOperationsFor(mode) {
  if (mode === 'dev') return DEV_OPERATIONS;
  if (mode === 'ocr') {
    return [Object.freeze({ id: 'ocr', label: 'OCR', capability: 'text.ocr' })];
  }
  if (mode === 'editor') return [];
  return TEXT_OPERATIONS;
}

export function defaultTextForm(mode = 'text', operation) {
  const first = textOperationsFor(mode)[0]?.id || '';
  return {
    operation: operation || first,
    caseMode: 'title',
    algorithm: 'sha256',
    indent: '2',
    sortKeys: false,
    uuidCount: '1',
  };
}

export function textOperationCapability(mode, operation) {
  return textOperationsFor(mode).find((entry) => entry.id === operation)?.capability || null;
}

export function buildTextWorkbenchJobOptions({
  mode,
  form,
  input = '',
  uploadIds = [],
} = {}) {
  const operation = String(form?.operation || textOperationsFor(mode)[0]?.id || '');
  const options = {
    operation,
    _mode: String(mode || 'text'),
    _uploadIds: [...new Set((uploadIds || []).map(String).filter(Boolean))],
  };

  if (mode === 'dev' && operation !== 'uuid') options.input = String(input ?? '');
  if (operation === 'case') options.caseMode = String(form?.caseMode || 'title');
  if (operation === 'hash') options.algorithm = 'sha256';
  if (operation === 'format-json') {
    options.indent = Math.max(2, Math.min(4, Number(form?.indent) || 2));
    options.sortKeys = Boolean(form?.sortKeys);
  }
  if (operation === 'uuid') {
    options.count = Math.max(1, Math.min(100, Math.round(Number(form?.uuidCount) || 1)));
  }
  return options;
}

export function validateTextWorkbench({
  mode,
  form,
  input = '',
  uploadIds = [],
} = {}) {
  if (mode === 'editor') return '';
  const operation = String(form?.operation || '');
  if (!textOperationsFor(mode).some((entry) => entry.id === operation)) {
    return 'Choose a published text operation.';
  }
  if (mode === 'text' || mode === 'ocr') {
    if (uploadIds.length !== 1) return 'Select one source file.';
  }
  if (mode === 'dev' && operation !== 'uuid' && !String(input).length) {
    return 'Enter text for this utility.';
  }
  return '';
}

export function matchesTextAccept(file, accept) {
  if (!accept) return true;
  const tokens = String(accept).split(',').map((token) => token.trim().toLowerCase()).filter(Boolean);
  const name = String(file?.name || file?.originalName || '').toLowerCase();
  const mime = String(file?.type || file?.mime || '').toLowerCase();
  return tokens.some((token) => (
    token.startsWith('.') ? name.endsWith(token)
      : token.endsWith('/*') ? mime.startsWith(token.slice(0, -1))
        : mime === token
  ));
}

export function applyEditorCase(text, mode) {
  const value = String(text ?? '');
  if (mode === 'upper') return value.toUpperCase();
  if (mode === 'lower') return value.toLowerCase();
  if (mode === 'title') {
    return value.replace(/\w\S*/g, (word) => (
      word[0].toUpperCase() + word.slice(1).toLowerCase()
    ));
  }
  return value;
}
