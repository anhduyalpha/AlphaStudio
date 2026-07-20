import fs from 'node:fs';
import { config } from '../../config.js';
import { assertValidOutput } from '../quality.js';
import { normalizeFormat } from '../formats.js';

/** Common bounded output validation used by every registered engine. */
export function validateRegisteredOutput(outputPath: string, outputFormat: string): void {
  const format = normalizeFormat(outputFormat);
  const extension = format === 'jpeg' ? '.jpg' : `.${format}`;
  assertValidOutput(outputPath, {
    label: 'Conversion engine output',
    expectedExt: extension,
  });
  if (fs.statSync(outputPath).size > config.maxOutputBytes) {
    throw new Error('Conversion engine output exceeds the configured size limit');
  }
}
