/**
 * Lightweight client-side page organizer for Reorder / Rotate / Extract / Delete / Duplicate.
 * Uses browser PDF.js via dynamic import when available; falls back to page-count list
 * without embedding the full PDF as base64.
 *
 * Does NOT send the full PDF to the server as base64 — edit plans are page indices only.
 * Backend remains the authority for validation.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SecondaryButton, StatusBadge } from '../Common';

const PREVIEW_PAGE_LIMIT = 40;

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

  // Load page count + lazy thumbs via pdfjs if present, else file size heuristic skip
  useEffect(() => {
    let cancelled = false;
    let urls = [];
    async function load() {
      if (!file) return;
      setLoading(true);
      setError('');
      setThumbs([]);
      setSelected(new Set());
      try {
        const buf = await file.arrayBuffer();
        // Try pdfjs from CDN-less dynamic — package may not be installed; use minimal header parse
        let count = 0;
        try {
          // pdfjs-dist (Apache-2.0): client-side page count + lazy thumbnails only.
          // Never uploads the PDF as base64; edit plans are page indices for the job API.
          const pdfjs = await import('pdfjs-dist');
          if (pdfjs.GlobalWorkerOptions) {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
              'pdfjs-dist/build/pdf.worker.min.mjs',
              import.meta.url,
            ).toString();
          }
          const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(buf),
            isEvalSupported: false,
            useSystemFonts: true,
          });
          const doc = await loadingTask.promise;
          count = doc.numPages;
          const limit = Math.min(count, PREVIEW_PAGE_LIMIT);
          setTruncated(count > PREVIEW_PAGE_LIMIT);
          const nextThumbs = [];
          for (let i = 1; i <= limit; i++) {
            if (cancelled) break;
            const page = await doc.getPage(i);
            const viewport = page.getViewport({ scale: 0.25 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx2d = canvas.getContext('2d');
            await page.render({ canvasContext: ctx2d, viewport }).promise;
            const url = canvas.toDataURL('image/jpeg', 0.7);
            urls.push(url);
            nextThumbs.push({ index: i - 1, url });
            if (i % 4 === 0) setThumbs([...nextThumbs]);
          }
          if (!cancelled) setThumbs(nextThumbs);
        } catch {
          // Fallback: count /Type /Page occurrences (best-effort, no dependency)
          const text = new TextDecoder('latin1').decode(
            buf.slice(0, Math.min(buf.byteLength, 2_000_000)),
          );
          const matches = text.match(/\/Type\s*\/Page(?!s)/g);
          count = matches && matches.length ? matches.length : 1;
          setTruncated(count > PREVIEW_PAGE_LIMIT);
        }
        if (cancelled) return;
        setPageCount(count);
        setOrder(Array.from({ length: count }, (_, i) => i));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      // object URLs from data: do not need revoke; keep clean
      void urls;
    };
  }, [file]);

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
    <article className="surface-card content-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Page organizer</p>
          <h3>
            {pageCount || '…'} page{pageCount === 1 ? '' : 's'}
          </h3>
        </div>
        <StatusBadge tone="cyan">{selected.size} selected</StatusBadge>
      </div>

      {loading ? <p className="helper-note">Loading preview…</p> : null}
      {error ? <p className="helper-note">{error}</p> : null}
      {truncated ? (
        <p className="helper-note">
          Preview limited to first {PREVIEW_PAGE_LIMIT} pages for performance. The backend still
          processes the full document.
        </p>
      ) : null}

      <div
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
              key={`${pageIndex}-${displayPos}`}
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
                  {pageIndex + 1}
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
            disabled={disabled}
            onClick={() => {
              const order1 = order.map((i) => i + 1).join(',');
              onPagesChange?.(order1);
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
