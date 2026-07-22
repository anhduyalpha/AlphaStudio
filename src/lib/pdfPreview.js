import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export const PDF_PREVIEW_BYTE_LIMIT = positiveInteger(
  import.meta.env.VITE_PDF_PREVIEW_MAX_BYTES,
  32 * 1024 * 1024,
  { min: 1024 * 1024 },
);

export const PDF_PREVIEW_PAGE_LIMIT = positiveInteger(
  import.meta.env.VITE_PDF_PREVIEW_MAX_PAGES,
  200,
  { max: 2000 },
);

export const PDF_PREVIEW_WINDOW_SIZE = positiveInteger(
  import.meta.env.VITE_PDF_PREVIEW_WINDOW_SIZE,
  12,
  { max: 40 },
);

export const PDF_PREVIEW_RENDER_CONCURRENCY = positiveInteger(
  import.meta.env.VITE_PDF_PREVIEW_RENDER_CONCURRENCY,
  2,
  { max: 4 },
);

let pdfJsPromise = null;

/** Load PDF.js once and point it at Vite's bundled, same-origin worker asset. */
export function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist')
      .then((pdfjs) => {
        const worker = new URL(pdfWorkerUrl, window.location.href);
        if (worker.origin !== window.location.origin) {
          throw new Error('PDF preview worker must be served from the application origin');
        }
        pdfjs.GlobalWorkerOptions.workerSrc = worker.href;
        return pdfjs;
      })
      .catch((error) => {
        pdfJsPromise = null;
        throw error;
      });
  }
  return pdfJsPromise;
}

export function formatPreviewBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
