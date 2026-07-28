export const QR_OPERATIONS = Object.freeze([
  { id: 'generate', label: 'Generate', capability: 'qr.generate' },
  { id: 'decode', label: 'Decode image', capability: 'qr.decode' },
]);

export const QR_FORMATS = Object.freeze([
  { value: 'png', label: 'PNG' },
  { value: 'svg', label: 'SVG' },
]);

export const QR_ECC_LEVELS = Object.freeze([
  { value: 'L', label: 'Low (L)' },
  { value: 'M', label: 'Medium (M)' },
  { value: 'Q', label: 'Quartile (Q)' },
  { value: 'H', label: 'High (H)' },
]);

export function defaultQrForm(operation = 'generate') {
  return {
    operation: QR_OPERATIONS.some((entry) => entry.id === operation) ? operation : 'generate',
    content: 'https://localhost:5173',
    format: 'png',
    size: '512',
    dark: '#0f172a',
    light: '#ffffff',
    ecc: 'M',
    margin: '2',
  };
}

export function qrOperationCapability(operation) {
  return QR_OPERATIONS.find((entry) => entry.id === operation)?.capability || 'qr.generate';
}

export function buildQrJobOptions(form = {}, uploadIds = []) {
  const operation = QR_OPERATIONS.some((entry) => entry.id === form.operation)
    ? form.operation
    : 'generate';
  const options = {
    operation,
    _mode: 'qr',
    _uploadIds: uploadIds.map(String),
  };
  if (operation === 'generate') {
    options.content = String(form.content || '');
    options.format = QR_FORMATS.some((entry) => entry.value === form.format)
      ? form.format
      : 'png';
    options.size = Math.min(2048, Math.max(64, Number(form.size) || 512));
    options.dark = validHex(form.dark) ? form.dark : '#0f172a';
    options.light = validHex(form.light) ? form.light : '#ffffff';
    options.ecc = QR_ECC_LEVELS.some((entry) => entry.value === form.ecc)
      ? form.ecc
      : 'M';
    options.margin = Math.min(16, Math.max(0, Number(form.margin) || 0));
  }
  return options;
}

export function validateQrWorkbench(form = {}, uploadIds = []) {
  if (form.operation === 'decode') {
    return uploadIds.length === 1 ? '' : 'Select exactly one QR image to decode.';
  }
  const content = String(form.content || '').trim();
  if (!content) return 'Enter content to encode.';
  if (content.length > 2953) return 'QR content must be 2,953 characters or fewer.';
  if (!validHex(form.dark) || !validHex(form.light)) {
    return 'QR colors must use six-digit hexadecimal values.';
  }
  return '';
}

export function matchesQrAccept(file, accept) {
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

export function extractDecodedQrText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return typeof payload.text === 'string' ? payload.text : '';
}

function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}
