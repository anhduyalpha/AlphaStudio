export const SECURITY_OPERATIONS = Object.freeze([
  { id: 'hash', label: 'Hash', capability: 'security.hash', needsFile: true },
  { id: 'compare', label: 'Compare checksum', capability: 'security.hash', needsFile: true },
  { id: 'metadata', label: 'Metadata', capability: 'security.metadata', needsFile: true },
  { id: 'signature', label: 'File signature', capability: 'security.signature', needsFile: true },
  { id: 'password', label: 'Password generator', capability: 'security.hash', needsFile: false },
]);

export const SECURITY_ALGORITHMS = Object.freeze([
  { value: 'md5', label: 'MD5' },
  { value: 'sha1', label: 'SHA-1' },
  { value: 'sha256', label: 'SHA-256' },
  { value: 'sha512', label: 'SHA-512' },
]);

export function securityOperation(operation) {
  return SECURITY_OPERATIONS.find((entry) => entry.id === operation)
    || SECURITY_OPERATIONS[0];
}

export function defaultSecurityForm(operation = 'hash') {
  return {
    operation: securityOperation(operation).id,
    algorithm: 'sha256',
    expected: '',
    length: '20',
    symbols: true,
  };
}

export function buildSecurityJobOptions(form = {}, uploadIds = []) {
  const operation = securityOperation(form.operation).id;
  const options = {
    operation,
    _mode: 'security',
    _uploadIds: uploadIds.map(String),
  };
  if (operation === 'hash') {
    options.algorithms = ['md5', 'sha1', 'sha256', 'sha512'];
  }
  if (operation === 'compare') {
    options.algorithm = SECURITY_ALGORITHMS.some((entry) => entry.value === form.algorithm)
      ? form.algorithm
      : 'sha256';
    options.expected = String(form.expected || '').trim().toLowerCase();
  }
  if (operation === 'password') {
    options.length = Math.min(128, Math.max(8, Number(form.length) || 20));
    options.symbols = form.symbols !== false;
  }
  return options;
}

export function validateSecurityWorkbench(form = {}, uploadIds = []) {
  const operation = securityOperation(form.operation);
  if (operation.needsFile && uploadIds.length !== 1) {
    return 'Select exactly one file for this security operation.';
  }
  if (operation.id === 'compare') {
    const expected = String(form.expected || '').trim();
    if (!/^[a-fA-F0-9]{32,128}$/.test(expected)) {
      return 'Enter a hexadecimal checksum between 32 and 128 characters.';
    }
  }
  if (operation.id === 'password') {
    const length = Number(form.length);
    if (!Number.isInteger(length) || length < 8 || length > 128) {
      return 'Password length must be a whole number from 8 to 128.';
    }
  }
  return '';
}
