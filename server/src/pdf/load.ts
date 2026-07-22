/**
 * Shared PDF load / validation helpers for operations.
 */
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { validatePdfInput, type PdfInspectResult } from '../convert/pdfInspect.js';
import { sanitizeUserError } from '../lib/sanitize.js';
import { pdfError, throwIfCancelled } from './errors.js';

export async function loadPdfDocument(
  filePath: string,
  opts: { ignoreEncryption?: boolean } = {},
): Promise<PDFDocument> {
  // Prefer async read for large files
  const bytes = await fs.promises.readFile(filePath);
  try {
    return await PDFDocument.load(bytes, {
      ignoreEncryption: opts.ignoreEncryption === true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load failed';
    if (/encrypt|password|security/i.test(msg)) {
      throw pdfError('PASSWORD_REQUIRED', 'Password required: this PDF is encrypted');
    }
    throw pdfError('CORRUPTED_PDF', `Corrupted PDF: ${sanitizeUserError(msg)}`);
  }
}

export async function validateAndLoad(
  filePath: string,
  opts: {
    originalName?: string;
    declaredMime?: string;
    isCancelled?: () => boolean;
  } = {},
): Promise<{ doc: PDFDocument; inspect: PdfInspectResult }> {
  if (opts.isCancelled) throwIfCancelled(opts.isCancelled);
  const inspect = await validatePdfInput(filePath, {
    originalName: opts.originalName,
    declaredMime: opts.declaredMime,
  });
  if (opts.isCancelled) throwIfCancelled(opts.isCancelled);
  const doc = await loadPdfDocument(filePath);
  return { doc, inspect };
}
