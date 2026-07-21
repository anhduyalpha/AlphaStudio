/**
 * Lightweight client-side page organizer for Reorder / Rotate / Extract / Delete / Duplicate.
 * Uses browser PDF.js via dynamic import; falls back to page-count list without base64 upload.
 *
 * Lifecycle:
 * - Generation token ignores stale async completions after file change / unmount.
 * - loadingTask cancelled + PDFDocumentProxy.destroy() on cleanup.
 * - Thumbnails cleared immediately when the selected file identity changes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SecondaryButton, StatusBadge } from '../Common';

const PREVIEW_PAGE_LIMIT = 40;

/** Stable identity for a browser File (reference changes even for same content). */
function fileIdentity(file) {
  if (!file) return '';
  return `${file.name}|${file.size}|${file.lastModified || 0}`;
}

export default function PdfPageOrganizer({
  file,
  operation,
  pages,
  onPagesChange,
  onPlanChange,
  angle,
  onAngleChange,
  disabled,
}) {
  const [pageCount, setPageCount] = useState(0);
  const [thumbs, setThumbs] = useState([]); // { index, url }[]
  const [selected, setSelected] = useState(() => new Set());
  const [order, setOrder] = useState([]); // zero-based display order
  const [rotations, setRotations] = useState({}); // index -> extra degrees
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);

  const genRef = useRef(0);
  const docRef = useRef(null);
  const taskRef = useRef(null);
  const identity = fileIdentity(file);

  // Load page count + lazy thumbs; full cleanup on identity change / unmount
  useEffect(() => {
    const gen = ++genRef.current;
    let cancelled = false;

    // Tear down previous document immediately so stale renders cannot finish into state
    const prevDoc = docRef.current;
    const prevTask = taskRef.current;
    docRef.current = null;
    taskRef.current = null;
    try {
      prevTask?.destroy?.();
    } catch {
      /* ignore */
    }
    try {
      prevDoc?.destroy?.();
    } catch {
      /* ignore */
    }

    setThumbs([]);
    setSelected(new Set());
    setOrder([]);
    setRotations({});
    setPageCount(0);
    setError('');
    setTruncated(false);

    if (!file) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    async function load() {
      try {
        const buf = await file.arrayBuffer();
        if (cancelled || gen !== genRef.current) return;

        let count = 0;
        try {
          const pdfjs = await import('pdfjs-dist');
          if (cancelled || gen !== genRef.current) return;

          // Vite resolves this to a correct asset URL in dev and production builds.
          if (pdfjs.GlobalWorkerOptions) {
            const workerUrl = new URL(
              'pdfjs-dist/build/pdf.worker.min.mjs',
              import.meta.url,
            ).toString();
            pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
          }

          const data = new Uint8Array(buf);
          const loadingTask = pdfjs.getDocument({
            data,
            isEvalSupported: false,
            useSystemFonts: true,
            disableAutoFetch: true,
            disableStream: true,
          });
          taskRef.current = loadingTask;
          const doc = await loadingTask.promise;
          if (cancelled || gen !== genRef.current) {
            try {
              await doc.destroy();
            } catch {
              /* ignore */
            }
            return;
          }
          docRef.current = doc;
          count = doc.numPages || 0;
          const limit = Math.min(count, PREVIEW_PAGE_LIMIT);
          if (gen === genRef.current && !cancelled) {
            setTruncated(count > PREVIEW_PAGE_LIMIT);
            setPageCount(count);
            setOrder(Array.from({ length: count }, (_, i) => i));
          }

          const nextThumbs = [];
          for (let i = 1; i <= limit; i++) {
            if (cancelled || gen !== genRef.current) break;
            const page = await doc.getPage(i);
            if (cancelled || gen !== genRef.current) {
              try {
                page.cleanup?.();
              } catch {
                /* ignore */
              }
              break;
            }
            const viewport = page.getViewport({ scale: 0.25 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const ctx2d = canvas.getContext('2d', { alpha: false });
            const renderTask = page.render({ canvasContext: ctx2d, viewport, canvas });
            try {
              await renderTask.promise;
            } catch (renderErr) {
              if (cancelled || gen !== genRef.current) break;
              throw renderErr;
            }
            const url = canvas.toDataURL('image/jpeg', 0.7);
            // Drop canvas backing store promptly
            canvas.width = 0;
            canvas.height = 0;
            try {
              page.cleanup?.();
            } catch {
              /* ignore */
            }
            nextThumbs.push({ index: i - 1, url });
            if (i % 4 === 0 && gen === genRef.current && !cancelled) {
              setThumbs([...nextThumbs]);
            }
          }
          if (gen === genRef.current && !cancelled) {
            setThumbs(nextThumbs);
            setError('');
          }
        } catch (pdfErr) {
          if (cancelled || gen !== genRef.current) return;
          // Fallback: best-effort /Type /Page count (no thumbnails)
          const text = new TextDecoder('latin1').decode(
            buf.slice(0, Math.min(buf.byteLength, 2_000_000)),
          );
          const matches = text.match(/\/Type\s*\/Page(?!s)/g);
          count = matches && matches.length ? matches.length : 1;
          setPageCount(count);
          setOrder(Array.from({ length: count }, (_, i) => i));
          setTruncated(count > PREVIEW_PAGE_LIMIT);
          setThumbs([]);
          setError(
            pdfErr instanceof Error
              ? `Thumbnail render limited: ${pdfErr.message}`
              : 'Thumbnail render limited; page list only',
          );
        }
      } catch (e) {
        if (!cancelled && gen === genRef.current) {
          setError(e instanceof Error ? e.message : 'Preview failed');
          setPageCount(0);
          setThumbs([]);
        }
      } finally {
        if (!cancelled && gen === genRef.current) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      genRef.current += 1; // invalidate in-flight work
      try {
        taskRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      try {
        docRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      taskRef.current = null;
      docRef.current = null;
    };
  }, [identity, file]);

  // Publish plan to parent (include pageCount for client validation e.g. delete-all)
  useEffect(() => {
    if (!onPlanChange) return;
    if (operation === 'reorder') {
      const order1 = order.map((i) => i + 1).join(',');
      onPlanChange({ order: order1, pages: order1, pageCount });
      onPagesChange?.(order1);
    } else if (selected.size) {
      const list = [...selected].sort((a, b) => a - b).map((i) => i + 1).join(',');
      onPlanChange({ pages: list, pageCount });
    } else if (pageCount) {
      onPlanChange({ pageCount });
    }
  }, [order, selected, operation, onPlanChange, onPagesChange, pageCount]);

  const toggle = useCallback((idx) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const rotateSelected = () => {
    const a = Number(angle) || 90;
    setRotations((prev) => {
      const next = { ...prev };
      for (const i of selected) {
        next[i] = ((next[i] || 0) + a) % 360;
      }
      return next;
    });
    onAngleChange?.(String(a));
  };

  const applySelectionToPages = () => {
    if (!selected.size) return;
    const list = [...selected].sort((a, b) => a - b).map((i) => i + 1).join(',');
    onPagesChange?.(list);
    onPlanChange?.({ pages: list, pageCount });
  };

  const onDragStart = (idx) => setDragIdx(idx);
  const onDrop = (targetIdx) => {
    if (dragIdx == null || dragIdx === targetIdx) return;
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(dragIdx, 1);
      next.splice(targetIdx, 0, item);
      return next;
    });
    setDragIdx(null);
  };

  const displayList = useMemo(() => {
    if (operation === 'reorder') return order;
    return Array.from({ length: Math.min(pageCount, PREVIEW_PAGE_LIMIT) }, (_, i) => i);
  }, [operation, order, pageCount]);

  const thumbMap = useMemo(() => {
    const m = new Map();
    for (const t of thumbs) m.set(t.index, t.url);
    return m;
  }, [thumbs]);

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
          <h3>
            {loading && !pageCount ? '…' : pageCount || '…'} page{pageCount === 1 ? '' : 's'}
          </h3>
        </div>
        <StatusBadge tone="cyan">{selected.size} selected</StatusBadge>
      </div>

      {loading ? <p className="helper-note" role="status">Loading preview…</p> : null}
      {error ? (
        <p className="helper-note" role="alert">
          {error}
        </p>
      ) : null}
      {truncated ? (
        <p className="helper-note">
          Preview limited to first {PREVIEW_PAGE_LIMIT} pages for performance. The backend still
          processes the full document.
        </p>
      ) : null}

      <div
        className="pdf-page-organizer-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
          gap: '0.5rem',
          maxHeight: '360px',
          overflowY: 'auto',
        }}
      >
        {displayList.map((pageIndex, displayPos) => {
          const url = thumbMap.get(pageIndex);
          const isSel = selected.has(pageIndex);
          const rot = rotations[pageIndex] || 0;
          return (
            <div
              key={`${identity}-${pageIndex}-${displayPos}`}
              draggable={operation === 'reorder' && !disabled}
              onDragStart={() => onDragStart(displayPos)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(displayPos)}
              onClick={() => !disabled && toggle(pageIndex)}
              style={{
                border: isSel ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border, #333)',
                borderRadius: 8,
                padding: 4,
                cursor: disabled ? 'default' : 'pointer',
                background: isSel ? 'rgba(59,130,246,0.12)' : 'transparent',
                textAlign: 'center',
                fontSize: 12,
              }}
            >
              {url ? (
                <img
                  src={url}
                  alt={`Page ${pageIndex + 1}`}
                  style={{
                    width: '100%',
                    height: 'auto',
                    transform: rot ? `rotate(${rot}deg)` : undefined,
                    transition: 'transform 0.15s',
                  }}
                />
              ) : (
                <div style={{ height: 80, display: 'grid', placeItems: 'center', opacity: 0.6 }}>
                  {loading ? '…' : pageIndex + 1}
                </div>
              )}
              <div>p.{pageIndex + 1}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
        <SecondaryButton type="button" disabled={disabled || !selected.size} onClick={applySelectionToPages}>
          Use selection as pages
        </SecondaryButton>
        {operation === 'rotate' ? (
          <SecondaryButton type="button" disabled={disabled || !selected.size} onClick={rotateSelected}>
            Mark rotate {angle}°
          </SecondaryButton>
        ) : null}
        {operation === 'reorder' ? (
          <SecondaryButton
            type="button"
            disabled={disabled || !order.length}
            onClick={() => {
              const order1 = order.map((i) => i + 1).join(',');
              onPagesChange?.(order1);
              onPlanChange?.({ order: order1, pages: order1, pageCount });
            }}
          >
            Apply order
          </SecondaryButton>
        ) : null}
      </div>
      <p className="helper-note" style={{ marginTop: '0.5rem' }}>
        Plan: {pages || '(all / none)'} — server validates the final plan. No full-PDF base64 upload.
      </p>
    </article>
  );
}

export { fileIdentity, PREVIEW_PAGE_LIMIT };
