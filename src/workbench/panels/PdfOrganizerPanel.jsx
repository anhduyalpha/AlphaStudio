import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Skeleton,
  StatusBadge,
} from '../../components/index.jsx';
import {
  PDF_PREVIEW_PAGE_LIMIT,
  PDF_PREVIEW_RENDER_CONCURRENCY,
  PDF_PREVIEW_WINDOW_SIZE,
  getPdfJs,
} from '../../lib/pdfPreview.js';

export function pdfOrganizerFileIdentity(file) {
  if (!file) return '';
  return `${file.name || ''}|${file.size || 0}|${file.lastModified || 0}`;
}

export function selectedPageSpec(selected) {
  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => index + 1)
    .join(',');
}

export function movePdfPage(order, from, to) {
  if (
    from < 0
    || to < 0
    || from >= order.length
    || to >= order.length
    || from === to
  ) {
    return order;
  }
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function cancelTask(task) {
  try {
    task?.cancel?.();
  } catch {
    // The render already completed.
  }
}

function destroyTask(task) {
  try {
    const result = task?.destroy?.();
    if (result && typeof result.catch === 'function') void result.catch(() => {});
  } catch {
    // The PDF.js task already released its resources.
  }
}

function operationHelp(operation) {
  if (operation === 'reorder') return 'Drag pages or use the arrow buttons, then apply the order.';
  if (operation === 'rotate') return 'Select pages and choose one clockwise rotation angle.';
  if (operation === 'extract') return 'Select the pages to copy into a new PDF.';
  if (operation === 'delete-pages') return 'Select pages to remove. At least one page must remain.';
  if (operation === 'duplicate-pages') return 'Select pages to duplicate after their originals.';
  return 'Choose a page operation.';
}

function ManualControls({
  operation,
  operations,
  pages,
  angle,
  disabled,
  pageCount,
  dispatch,
}) {
  const publishManualPages = (value) => {
    dispatch({ type: 'set-pages', value });
    dispatch({
      type: 'set-plan',
      plan: value
        ? {
            pages: value,
            ...(operation === 'reorder' ? { order: value } : {}),
            ...(pageCount ? { pageCount } : {}),
          }
        : pageCount ? { pageCount } : null,
    });
  };

  return (
    <div className="pdf-organizer__controls">
      <Field
        label="Page operation"
        variant="select"
        value={operation}
        disabled={disabled || !operations.length}
        options={operations}
        hint={operationHelp(operation)}
        onChange={(event) => dispatch({ type: 'set-operation', value: event.currentTarget.value })}
      />
      <Field
        label={operation === 'reorder' ? 'Page order' : 'Pages'}
        value={pages || ''}
        disabled={disabled}
        placeholder={operation === 'reorder' ? '3,1,2' : '1,3-5'}
        hint="Use 1-based page numbers and ranges. Thumbnail actions fill this field for you."
        onChange={(event) => publishManualPages(event.currentTarget.value)}
      />
      {operation === 'rotate' ? (
        <Field
          label="Clockwise angle"
          variant="select"
          value={String(angle || '90')}
          disabled={disabled}
          options={[
            { value: '90', label: '90°' },
            { value: '180', label: '180°' },
            { value: '270', label: '270°' },
          ]}
          onChange={(event) => dispatch({ type: 'set-angle', value: event.currentTarget.value })}
        />
      ) : null}
    </div>
  );
}

export default function PdfOrganizerPanel({ state = {}, dispatch = () => {} }) {
  const {
    file = null,
    previewFile = null,
    previewStatus = 'idle',
    previewError = '',
    operations = [],
    operation = 'reorder',
    pages = '',
    angle = '90',
    disabled = false,
  } = state || {};
  const [pageCount, setPageCount] = useState(0);
  const [thumbs, setThumbs] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [order, setOrder] = useState([]);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [previewFailure, setPreviewFailure] = useState('');
  const [limitMessage, setLimitMessage] = useState('');
  const [windowStart, setWindowStart] = useState(0);
  const [dragPosition, setDragPosition] = useState(null);
  const [documentVersion, setDocumentVersion] = useState(0);
  const dispatchRef = useRef(dispatch);
  const editorStateRef = useRef({ operation, pages });
  const loadGenerationRef = useRef(0);
  const renderGenerationRef = useRef(0);
  const docRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const renderTasksRef = useRef(new Set());
  const identity = pdfOrganizerFileIdentity(previewFile);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    editorStateRef.current = { operation, pages };
  }, [operation, pages]);

  const cancelRenders = useCallback(() => {
    renderGenerationRef.current += 1;
    for (const task of renderTasksRef.current) cancelTask(task);
    renderTasksRef.current.clear();
  }, []);

  const destroyDocument = useCallback(() => {
    cancelRenders();
    const loadingTask = loadingTaskRef.current;
    const documentTask = docRef.current;
    loadingTaskRef.current = null;
    docRef.current = null;
    destroyTask(loadingTask);
    destroyTask(documentTask);
  }, [cancelRenders]);

  useEffect(() => {
    setSelected(new Set());
    setDragPosition(null);
    if (operation !== 'reorder') return;
    setOrder(Array.from({ length: pageCount }, (_, index) => index));
  }, [operation, pageCount]);

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
    setPreviewFailure('');
    setLimitMessage('');

    if (previewStatus !== 'ready' || !previewFile) {
      setLoadingDocument(false);
      return undefined;
    }

    setLoadingDocument(true);
    void (async () => {
      try {
        const buffer = await previewFile.arrayBuffer();
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
        const documentTask = await loadingTask.promise;
        if (cancelled || generation !== loadGenerationRef.current) {
          destroyTask(documentTask);
          return;
        }
        loadingTaskRef.current = null;
        const count = documentTask.numPages || 0;
        const currentEditor = editorStateRef.current;
        setPageCount(count);
        dispatchRef.current({
          type: 'set-plan',
          plan: currentEditor.pages
            ? {
                pages: currentEditor.pages,
                ...(currentEditor.operation === 'reorder' ? { order: currentEditor.pages } : {}),
                pageCount: count,
              }
            : { pageCount: count },
        });
        if (count > PDF_PREVIEW_PAGE_LIMIT) {
          destroyTask(documentTask);
          setLimitMessage(
            `This document has ${count} pages; thumbnail preview is limited to ${PDF_PREVIEW_PAGE_LIMIT}. Manual page entry and backend processing remain available.`,
          );
          return;
        }
        docRef.current = documentTask;
        setOrder(Array.from({ length: count }, (_, index) => index));
        setDocumentVersion((value) => value + 1);
      } catch (error) {
        if (cancelled || generation !== loadGenerationRef.current) return;
        setPreviewFailure(error instanceof Error ? error.message : 'PDF preview failed');
      } finally {
        if (!cancelled && generation === loadGenerationRef.current) setLoadingDocument(false);
      }
    })();

    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
      destroyDocument();
    };
  }, [destroyDocument, identity, previewFile, previewStatus]);

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

  useEffect(() => {
    const documentTask = docRef.current;
    cancelRenders();
    setThumbs([]);
    if (!documentTask || !visibleEntries.length || limitMessage) {
      setRendering(false);
      return undefined;
    }

    const generation = renderGenerationRef.current;
    let cancelled = false;
    let cursor = 0;
    setPreviewFailure('');
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
          page = await documentTask.getPage(pageIndex + 1);
          if (cancelled || generation !== renderGenerationRef.current) return;
          const viewport = page.getViewport({ scale: 0.28 });
          canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const canvasContext = canvas.getContext('2d', { alpha: false });
          renderTask = page.render({ canvasContext, viewport, canvas });
          renderTasksRef.current.add(renderTask);
          await renderTask.promise;
          if (cancelled || generation !== renderGenerationRef.current) return;
          const url = canvas.toDataURL('image/jpeg', 0.72);
          setThumbs((current) => [
            ...current.filter((thumb) => thumb.index !== pageIndex),
            { index: pageIndex, url },
          ]);
        } catch (error) {
          if (
            !cancelled
            && generation === renderGenerationRef.current
            && error?.name !== 'RenderingCancelledException'
          ) {
            setPreviewFailure(error instanceof Error ? error.message : 'Thumbnail render failed');
          }
        } finally {
          if (renderTask) renderTasksRef.current.delete(renderTask);
          try {
            page?.cleanup?.();
          } catch {
            // The page already released its canvas resources.
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

  const publishPages = useCallback((value) => {
    dispatchRef.current({ type: 'set-pages', value });
    dispatchRef.current({
      type: 'set-plan',
      plan: value
        ? {
            pages: value,
            ...(operation === 'reorder' ? { order: value } : {}),
            pageCount,
          }
        : pageCount ? { pageCount } : null,
    });
  }, [operation, pageCount]);

  const publishOrder = useCallback((nextOrder) => {
    const value = nextOrder.map((index) => index + 1).join(',');
    dispatchRef.current({ type: 'set-pages', value });
    dispatchRef.current({
      type: 'set-plan',
      plan: { order: value, pages: value, pageCount },
    });
  }, [pageCount]);

  const moveOrder = (from, to) => {
    const next = movePdfPage(order, from, to);
    if (next === order) return;
    setOrder(next);
    publishOrder(next);
  };

  const togglePage = (pageIndex) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pageIndex)) next.delete(pageIndex);
      else next.add(pageIndex);
      return next;
    });
  };

  const applySelection = () => publishPages(selectedPageSpec(selected));
  const deleteWouldRemoveAll = operation === 'delete-pages'
    && pageCount > 0
    && selected.size === pageCount;
  const thumbMap = useMemo(
    () => new Map(thumbs.map((thumb) => [thumb.index, thumb.url])),
    [thumbs],
  );
  const totalWindows = Math.max(1, Math.ceil(pageCount / PDF_PREVIEW_WINDOW_SIZE));
  const currentWindow = Math.min(totalWindows, Math.floor(windowStart / PDF_PREVIEW_WINDOW_SIZE) + 1);
  const canPage = !limitMessage && pageCount > PDF_PREVIEW_WINDOW_SIZE;
  const previewBusy = previewStatus === 'loading' || loadingDocument;
  const statusTone = previewStatus === 'error' || previewFailure
    ? 'danger'
    : previewBusy || rendering
      ? 'live'
      : previewStatus === 'limited' || limitMessage
        ? 'warning'
        : pageCount
          ? 'success'
          : 'neutral';
  const statusText = previewStatus === 'error' || previewFailure
    ? 'Preview unavailable'
    : previewBusy
      ? 'Loading preview'
      : rendering
        ? 'Rendering pages'
        : previewStatus === 'limited' || limitMessage
          ? 'Manual mode'
          : pageCount
            ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`
            : 'Waiting for PDF';

  return (
    <section className="pdf-organizer" data-pdf-organizer="true">
      <div className="pdf-organizer__header">
        <div>
          <p className="view-eyebrow">Page organizer</p>
          <h3>{file?.originalName || file?.name || 'Choose a PDF'}</h3>
        </div>
        <StatusBadge tone={statusTone}>{statusText}</StatusBadge>
      </div>

      <ManualControls
        operation={operation}
        operations={operations}
        pages={pages}
        angle={angle}
        disabled={disabled}
        pageCount={pageCount}
        dispatch={dispatch}
      />

      {!file ? (
        <EmptyState
          variant="compact"
          visual={<Icon name="file" />}
          title="Select one PDF"
          description="Choose a PDF in Input to inspect and organize its pages."
        />
      ) : null}

      {file && previewBusy && !pageCount ? (
        <div className="pdf-organizer__loading">
          <Skeleton variant="row" lines={3} label="Loading PDF page preview" />
        </div>
      ) : null}

      {file && previewStatus === 'error' ? (
        <ErrorState
          title="Could not load the PDF preview"
          message={`${previewError || 'The file could not be read.'} You can still enter pages manually and run the backend operation.`}
          actionLabel="Retry preview"
          onAction={() => dispatch({ type: 'retry-preview' })}
        />
      ) : null}

      {file && previewFailure ? (
        <ErrorState
          title="Could not render PDF pages"
          message={`${previewFailure}. You can still enter pages manually and run the backend operation.`}
          actionLabel="Retry preview"
          onAction={() => dispatch({ type: 'retry-preview' })}
        />
      ) : null}

      {file && (previewStatus === 'limited' || limitMessage) ? (
        <div className="pdf-organizer__notice" role="status">
          <Icon name="warning" />
          <p>{previewError || limitMessage}</p>
        </div>
      ) : null}

      {pageCount && !limitMessage ? (
        <>
          <div className="pdf-organizer__toolbar">
            <div className="pdf-organizer__toolbar-group">
              {operation !== 'reorder' ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled || selected.size === pageCount}
                    onClick={() => setSelected(new Set(Array.from({ length: pageCount }, (_, index) => index)))}
                  >
                    Select all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled || !selected.size}
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </Button>
                </>
              ) : null}
            </div>
            {canPage ? (
              <div className="pdf-organizer__pager" aria-label="Thumbnail page sets">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled || currentWindow <= 1}
                  onClick={() => setWindowStart(Math.max(0, windowStart - PDF_PREVIEW_WINDOW_SIZE))}
                >
                  Previous
                </Button>
                <span role="status">Set {currentWindow} of {totalWindows}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled || currentWindow >= totalWindows}
                  onClick={() => setWindowStart(Math.min(
                    (totalWindows - 1) * PDF_PREVIEW_WINDOW_SIZE,
                    windowStart + PDF_PREVIEW_WINDOW_SIZE,
                  ))}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>

          <div className="pdf-organizer__grid" aria-label="PDF pages">
            {visibleEntries.map(({ pageIndex, orderPosition }) => {
              const url = thumbMap.get(pageIndex);
              const isSelected = selected.has(pageIndex);
              const rotation = operation === 'rotate' && isSelected ? Number(angle) || 90 : 0;
              return (
                <article
                  key={`${identity}-${pageIndex}`}
                  className={[
                    'pdf-organizer__page',
                    isSelected ? 'is-selected' : '',
                    operation === 'reorder' ? 'is-reorderable' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={operation === 'reorder' && !disabled}
                  onDragStart={() => setDragPosition(orderPosition)}
                  onDragEnd={() => setDragPosition(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragPosition != null) moveOrder(dragPosition, orderPosition);
                    setDragPosition(null);
                  }}
                >
                  <button
                    type="button"
                    className="pdf-organizer__page-button"
                    disabled={disabled || operation === 'reorder'}
                    aria-pressed={operation === 'reorder' ? undefined : isSelected}
                    aria-label={`Page ${pageIndex + 1}${isSelected ? ', selected' : ''}`}
                    onClick={() => operation !== 'reorder' && togglePage(pageIndex)}
                  >
                    <span className="pdf-organizer__thumb">
                      {url ? (
                        <img
                          src={url}
                          alt=""
                          style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
                        />
                      ) : (
                        <Skeleton label={`Rendering page ${pageIndex + 1}`} />
                      )}
                    </span>
                    <span>Page {pageIndex + 1}</span>
                  </button>
                  {operation === 'reorder' ? (
                    <div className="pdf-organizer__move">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled || orderPosition === 0}
                        aria-label={`Move page ${pageIndex + 1} earlier`}
                        onClick={() => moveOrder(orderPosition, orderPosition - 1)}
                      >
                        ←
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled || orderPosition === order.length - 1}
                        aria-label={`Move page ${pageIndex + 1} later`}
                        onClick={() => moveOrder(orderPosition, orderPosition + 1)}
                      >
                        →
                      </Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div className="pdf-organizer__apply">
            {operation === 'reorder' ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || !order.length}
                onClick={() => publishOrder(order)}
              >
                Apply page order
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || !selected.size || deleteWouldRemoveAll}
                onClick={applySelection}
              >
                Use {selected.size || 0} selected {selected.size === 1 ? 'page' : 'pages'}
              </Button>
            )}
            <span>
              {deleteWouldRemoveAll
                ? 'Keep at least one page in the PDF.'
                : pages ? `Plan: ${pages}` : 'No page plan applied yet.'}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
