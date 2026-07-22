/**
 * Standardized PDF error codes and helpers.
 * Messages are user-safe (no local paths / stack traces).
 */
import { AppError } from '../lib/errors.js';
import { sanitizeUserError } from '../lib/sanitize.js';

export type PdfErrorCode =
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'CORRUPTED_PDF'
  | 'EMPTY_PDF'
  | 'MIME_MISMATCH'
  | 'PAGE_RANGE_INVALID'
  | 'PAGE_OUT_OF_RANGE'
  | 'NO_EXTRACTABLE_TEXT'
  | 'OCR_UNAVAILABLE'
  | 'RASTERIZER_UNAVAILABLE'
  | 'REPAIR_UNAVAILABLE'
  | 'COMPRESSION_UNAVAILABLE'
  | 'OUTPUT_VALIDATION_FAILED'
  | 'PDF_TOO_LARGE'
  | 'PDF_PAGE_LIMIT_EXCEEDED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'UNSUPPORTED_CONVERSION'
  | 'INVALID_PDF'
  | 'DECRYPT_UNAVAILABLE';

/** HTTP status mapping for PDF codes (client input → 4xx, availability → 503). */
const STATUS: Partial<Record<PdfErrorCode, number>> = {
  PASSWORD_REQUIRED: 400,
  INVALID_PASSWORD: 400,
  CORRUPTED_PDF: 400,
  EMPTY_PDF: 400,
  MIME_MISMATCH: 400,
  PAGE_RANGE_INVALID: 400,
  PAGE_OUT_OF_RANGE: 400,
  NO_EXTRACTABLE_TEXT: 400,
  OUTPUT_VALIDATION_FAILED: 400,
  PDF_TOO_LARGE: 413,
  PDF_PAGE_LIMIT_EXCEEDED: 400,
  CANCELLED: 400,
  TIMEOUT: 408,
  OCR_UNAVAILABLE: 503,
  RASTERIZER_UNAVAILABLE: 503,
  REPAIR_UNAVAILABLE: 503,
  COMPRESSION_UNAVAILABLE: 503,
  DECRYPT_UNAVAILABLE: 503,
  UNSUPPORTED_CONVERSION: 503,
  INVALID_PDF: 400,
};

export function pdfError(
  code: PdfErrorCode,
  message: string,
  statusCode?: number,
  details?: Record<string, unknown>,
): AppError {
  const status = statusCode ?? STATUS[code] ?? 400;
  const safe = sanitizeUserError(message);
  const err = new AppError(status, code, safe, {
    pdfCode: code,
    ...(details || {}),
  });
  return err;
}

export function throwIfCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) {
    throw pdfError('CANCELLED', 'Job cancelled');
  }
}
