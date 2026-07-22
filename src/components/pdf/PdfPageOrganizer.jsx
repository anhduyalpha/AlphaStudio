/**
 * Bounded client-side page organizer for Reorder / Rotate / Extract / Delete / Duplicate.
 * PDF.js is initialized once through src/lib/pdfPreview.js with a same-origin Vite worker.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SecondaryButton, StatusBadge } from '../Common';
import {
  PDF_PREVIEW_BYTE_LIMIT,
  PDF_PREVIEW_PAGE_LIMIT,
  PDF_PREVIEW_RENDER_CONCURRENCY,
  PDF_PREVIEW_WINDOW_SIZE,
  formatPreviewBytes,
  getPdfJs,
} from '../../lib/pdfPreview';

/** Stable identity for a browser File (reference changes even for same content). */
function fileIdentity(file) {
  if (!file) return '';
  return `${file.name}|${file.size}|${file.lastModified || 0}`;
}

function cancelTask(task) {
  try {
    task?.cancel?.();
  } catch {
    /* already completed */
  }
}

function destroyTask(task) {
  try {
    const result = task?.destroy?.();
    if (result && typeof result.catch === 'function') void result.catch(() => {});
  } catch {
    /* already destroyed */
  }
}

export default function PdfPageOrganizer({
  file,
  operation,
  pages,
  onPagesChange,
  onPlanChange,
  angle,
  disabled,
}) {
  const [pageCount, setPageCount] = useState(0);
  const [thumbs, setThumbs] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [order, setOrder] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [limitMessage, setLimitMessage] = useState('');
  const [windowStart, setWindowStart] = useState(0);
  const [dragPosition, setDragPosition] = useState(null);
  const [documentVersion, setDocumentVersion] = useState(0);

  const loadGenerationRef = useRef(0);
  const renderGenerationRef = useRef(0);
  const docRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const renderTasksRef = useRef(new Set());
  const identity = fileIdentity(file);

  const cancelRenders = useCallback(() => {
    renderGenerationRef.current += 1;
    for (const task of renderTasksRef.current) cancelTask(task);
    renderTasksRef.current.clear();
  }, []);

  const destroyDocument = useCallback(() => {
    cancelRenders();
    const loadingTask = loadingTaskRef.current;
    const doc = docRef.current;
    loadingTaskRef.current = null;
    docRef.current = null;
    destroyTask(loadingTask);
    destroyTask(doc);
  }, [cancelRenders]);

  // Load only documents within the byte limit. File and operation changes both invalidate work.
  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    let cancelled = false;
    destroyDocument();

    setThumbs([]);
    setSelected(new Set());
    setOrder([]);
    setPageCount(0);
    setWindowStart(0);
    setDragPosition(null);
    setError('');
    setLimitMessage('');
    onPlanChange?.(null);

    if (!file) {
      setLoading(false);
      return undefined;
    }

    if (file.size > PDF_PREVIEW_BYTE_LIMIT) {
      setLoading(false);
      setLimitMessage(
        `Preview is disabled because this file exceeds the ${formatPreviewBytes(PDF_PREVIEW_BYTE_LIMIT)} preview limit. ` +
          'Backend processing is still available; enter pages manually above.',
      );
      return undefined;
    }

    setLoading(true);
    void (async () => {
      try {
        const buffer = await file.arrayBuffer();
        if (cancelled || generation !== loadGenerationRef.current) return;

        const pdfjs = await getPdfJs();
        if (cancelled || generation !== loadGenerationRef.current) return;

        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(buffer),
          isEvalSupported: false,
          useSystemFonts: true,
          disableAutoFetch: true,
          disableStream: true,
        });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled || generation !== loadGenerationRef.current) {
          destroyTask(doc);
          return;
        }

        loadingTaskRef.current = null;
        const count = doc.numPages || 0;
        setPageCount(count);

        if (count > PDF_PREVIEW_PAGE_LIMIT) {
          destroyTask(doc);
          setLimitMessage(
            `Preview is disabled because this document has ${count} pages (limit ${PDF_PREVIEW_PAGE_LIMIT}). ` +
              'Backend processing is still available; enter pages or order manually above.',
          );
          return;
        }

        docRef.current = doc;
        setOrder(Array.from({ length: count }, (_, index) => index));
        setDocumentVersion((value) => value + 1);
      } catch (previewError) {
        if (cancelled || generation !== loadGenerationRef.current) return;
        setError(previewError instanceof Error ? previewError.message : 'Preview failed');
        setPageCount(0);
        setThumbs([]);
      } finally {
        if (!cancelled && generation === loadGenerationRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
      destroyDocument();
    };
  }, [destroyDocument, file, identity, onPlanChange, operation]);

  const visibleEntries = useMemo(() => {
    if (!pageCount || limitMessage) return [];
    if (operation === 'reorder') {
      return order
        .slice(windowStart, windowStart + PDF_PREVIEW_WINDOW_SIZE)
        .map((pageIndex, offset) => ({ pageIndex, orderPosition: windowStart + offset }));
    }
    const end = Math.min(pageCount, windowStart + PDF_PREVIEW_WINDOW_SIZE);
    return Array.from({ length: Math.max(0, end - windowStart) }, (_, offset) => ({
      pageIndex: windowStart + offset,
      orderPosition: windowStart + offset,
    }));
  }, [limitMessage, operation, order, pageCount, windowStart]);

  // Render only the current page window with bounded concurrency; cancel every task on invalidation.
  useEffect(() => {
    const doc = docRef.current;
    cancelRenders();
    setThumbs([]);
    if (!doc || !visibleEntries.length || limitMessage) {
      setRendering(false);
      return undefined;
    }

    const generation = renderGenerationRef.current;
    let cancelled = false;
    let cursor = 0;
    setError('');
    setRendering(true);

    const renderWorker = async () => {
      while (!cancelled && generation === renderGenerationRef.current) {
        const entryIndex = cursor;
        cursor += 1;
        if (entryIndex >= visibleEntries.length) return;
        const { pageIndex } = visibleEntries[entryIndex];
        let page = null;
        let canvas = null;
        let renderTask = null;
        try {
          page = await doc.getPage(pageIndex + 1);
          if (cancelled || generation !== renderGenerationRef.current) return;
          const viewport = page.getViewport({ scale: 0.25 });
          canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const canvasContext = canvas.getContext('2d', { alpha: false });
          renderTask = page.render({ canvasContext, viewport, canvas });
          renderTasksRef.current.add(renderTask);
          await renderTask.promise;
          if (cancelled || generation !== renderGenerationRef.current) return;
          const url = canvas.toDataURL('image/jpeg', 0.7);
          setThumbs((current) => [...current.filter((thumb) => thumb.index !== pageIndex), { index: pageIndex, url }]);
        } catch (renderError) {
          if (!cancelled && generation === renderGenerationRef.current && renderError?.name !== 'RenderingCancelledException') {
            setError(renderError instanceof Error ? renderError.message : 'Thumbnail render failed');
          }
        } finally {
          if (renderTask) renderTasksRef.current.delete(renderTask);
          try {
            page?.cleanup?.();
          } catch {
            /* already cleaned */
          }
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }
    };

    void Promise.all(
      Array.from(
        { length: Math.min(PDF_PREVIEW_RENDER_CONCURRENCY, visibleEntries.length) },
        () => renderWorker(),
      ),
    ).finally(() => {
      if (!cancelled && generation === renderGenerationRef.current) setRendering(false);
    });

    return () => {
      cancelled = true;
      cancelRenders();
    };
  }, [cancelRenders, documentVersion, limitMessage, visibleEntries]);

  // The text field is authoritative. This keeps editPlan synchronized after manual edits.
  useEffect(() => {
    const manualPages = String(pages || '').trim();
    if (operation === 'reorder') {
      onPlanChange?.(manualPages ? { order: manualPages, pages: manualPages, pageCount } : pageCount ? { pageCount } : null);
    } else {
      onPlanChange?.(manualPages ? { pages: manualPages, pageCount } : pageCount ? { pageCount } : null);
    }
  }, [onPlanChange, operation, pageCount, pages]);

  const publishPages = useCallback(
    (value) => {
      onPagesChange?.(value);
      onPlanChange?.(value ? { pages: value, pageCount } : pageCount ? { pageCount } : null);
    },
    [onPagesChange, onPlanChange, pageCount],
  );

  const publishOrder = useCallback(
    (nextOrder) => {
      const value = nextOrder.map((index) => index + 1).join(',');
      onPagesChange?.(value);
      onPlanChange?.({ order: value, pages: value, pageCount });
    },
    [onPagesChange, onPlanChange, pageCount],
  );

  const toggle = useCallback((pageIndex) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pageIndex)) next.delete(pageIndex);
      else next.add(pageIndex);
      return next;
    });
  }, []);

  const applySelectionToPages = () => {
    if (!selected.size) return;
    publishPages([...selected].sort((a, b) => a - b).map((index) => index + 1).join(','));
  };

  const moveOrder = (from, to) => {
    if (from < 0 || to < 0 || from >= order.length || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    publishOrder(next);
  };

  const onDrop = (targetPosition) => {
    if (dragPosition == null) return;
    moveOrder(dragPosition, targetPosition);
    setDragPosition(null);
  };

  const thumbMap = useMemo(() => new Map(thumbs.map((thumb) => [thumb.index, thumb.url])), [thumbs]);
  const totalWindows = Math.max(1, Math.ceil(pageCount / PDF_PREVIEW_WINDOW_SIZE));
  const currentWindow = Math.min(totalWindows, Math.floor(windowStart / PDF_PREVIEW_WINDOW_SIZE) + 1);
  const canPage = !limitMessage && pageCount > PDF_PREVIEW_WINDOW_SIZE;

  if (!file) {
    return (
      <article className="surface-card content-card">
        <p className="helper-note">Select a PDF to preview pages.</p>
      </article>
    );
  }

  return (
    <article className="surface-card content-card" data-pdf-organizer="true">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Page organizer</p>
          <h3>{loading && !pageCount ? '…' : pageCount || 'Preview unavailable'}{pageCount ? ` page${pageCount === 1 ? '' : 's'}` : ''}</h3>
        </div>
        <StatusBadge tone="cyan">{operation === 'reorder' ? 'Reorder pages' : `${selected.size} selected`}</StatusBadge>
      </div>

      {loading || rendering ? <p className="helper-note" role="status">{loading ? 'Loading document…' : 'Rendering visible pages…'}</p> : null}
      {error ? <p className="helper-note" role="alert">Preview unavailable: {error}. Backend processing and manual page input remain available.</p> : null}
      {limitMessage ? <p className="helper-note" role="status">{limitMessage}</p> : null}

      {canPage ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <SecondaryButton type="button" disabled={disabled || currentWindow <= 1} onClick={() => setWindowStart(Math.max(0, windowStart - PDF_PREVIEW_WINDOW_SIZE))}>
            Previous pages
          </SecondaryButton>
          <span className="helper-note" role="status">Page set {currentWindow} of {totalWindows}</span>
          <SecondaryButton type="button" disabled={disabled || currentWindow >= totalWindows} onClick={() => setWindowStart(Math.min((totalWindows - 1) * PDF_PREVIEW_WINDOW_SIZE, windowStart + PDF_PREVIEW_WINDOW_SIZE))}>
            Next pages
          </SecondaryButton>
        </div>
      ) : null}

      {visibleEntries.length ? (
        <div
          className="pdf-page-organizer-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: '0.5rem' }}
        >
          {visibleEntries.map(({ pageIndex, orderPosition }) => {
            const url = thumbMap.get(pageIndex);
            const isSelected = selected.has(pageIndex);
            const rotation = operation === 'rotate' && isSelected ? Number(angle) || 90 : 0;
            return (
              <div
                key={`${identity}-${pageIndex}`}
                draggable={operation === 'reorder' && !disabled}
                onDragStart={() => setDragPosition(orderPosition)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onDrop(orderPosition)}
                style={{ border: isSelected ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border, #333)', borderRadius: 8, padding: 4, background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent', textAlign: 'center', fontSize: 12 }}
              >
                <button
                  type="button"
                  disabled={disabled || operation === 'reorder'}
                  aria-pressed={operation === 'reorder' ? undefined : isSelected}
                  aria-label={operation === 'reorder' ? `Page ${pageIndex + 1}` : `Page ${pageIndex + 1}${isSelected ? ', selected' : ''}`}
                  onClick={() => operation !== 'reorder' && toggle(pageIndex)}
                  style={{ width: '100%', border: 0, padding: 0, color: 'inherit', background: 'transparent', cursor: disabled || operation === 'reorder' ? 'default' : 'pointer' }}
                >
                  {url ? (
                    <img src={url} alt="" style={{ width: '100%', height: 'auto', transform: rotation ? `rotate(${rotation}deg)` : undefined, transition: 'transform 0.15s' }} />
                  ) : (
                    <span style={{ height: 80, display: 'grid', placeItems: 'center', opacity: 0.6 }}>{rendering ? '…' : pageIndex + 1}</span>
                  )}
                  <span style={{ display: 'block' }}>p.{pageIndex + 1}</span>
                </button>
                {operation === 'reorder' ? (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 4 }}>
                    <SecondaryButton type="button" disabled={disabled || orderPosition === 0} onClick={() => moveOrder(orderPosition, orderPosition - 1)} aria-label={`Move page ${pageIndex + 1} earlier`}>
                      ←
                    </SecondaryButton>
                    <SecondaryButton type="button" disabled={disabled || orderPosition === order.length - 1} onClick={() => moveOrder(orderPosition, orderPosition + 1)} aria-label={`Move page ${pageIndex + 1} later`}>
                      →
                    </SecondaryButton>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
        {operation !== 'reorder' ? (
          <SecondaryButton type="button" disabled={disabled || !selected.size} onClick={applySelectionToPages}>
            Use selection as pages
          </SecondaryButton>
        ) : null}
        {operation === 'reorder' && order.length ? (
          <SecondaryButton type="button" disabled={disabled} onClick={() => publishOrder(order)}>
            Apply order
          </SecondaryButton>
        ) : null}
      </div>
      {operation === 'rotate' ? <p className="helper-note" style={{ marginTop: '0.5rem' }}>All selected pages use the single global rotation angle shown above.</p> : null}
      <p className="helper-note" style={{ marginTop: '0.5rem' }}>
        Plan: {pages || '(all / none)'} — server validates the final plan. No full-PDF base64 upload.
      </p>
    </article>
  );
}

export { fileIdentity, PDF_PREVIEW_PAGE_LIMIT as PREVIEW_PAGE_LIMIT };
