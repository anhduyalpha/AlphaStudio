import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampCropRect,
  clientToNatural,
  defaultCropRect,
  naturalToDisplayPercent,
} from '../../lib/imageCrop';

/**
 * Interactive crop overlay on a displayed image.
 * Emits natural-pixel crop rect via onChange.
 */
export default function CropSelector({
  src,
  crop,
  onChange,
  disabled = false,
  naturalWidth,
  naturalHeight,
}) {
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [localDims, setLocalDims] = useState({
    naturalWidth: naturalWidth || 0,
    naturalHeight: naturalHeight || 0,
  });

  const dims = {
    naturalWidth: naturalWidth || localDims.naturalWidth || 1,
    naturalHeight: naturalHeight || localDims.naturalHeight || 1,
  };

  useEffect(() => {
    if (!src) return;
    if (naturalWidth && naturalHeight) return;
    const img = new Image();
    img.onload = () => setLocalDims({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.src = src;
  }, [src, naturalWidth, naturalHeight]);

  useEffect(() => {
    if (!dims.naturalWidth || !dims.naturalHeight) return;
    if (crop && crop.width > 0 && crop.height > 0) return;
    onChange?.(defaultCropRect(dims));
  }, [dims.naturalWidth, dims.naturalHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  const rect = crop && crop.width
    ? clampCropRect(crop, dims)
    : defaultCropRect(dims);
  const pct = naturalToDisplayPercent(rect, dims);

  const beginMove = useCallback((e) => {
    if (disabled) return;
    e.preventDefault();
    const imgEl = imgRef.current;
    if (!imgEl) return;
    const bound = imgEl.getBoundingClientRect();
    const pt = clientToNatural(bound, e.clientX, e.clientY, dims);
    dragRef.current = {
      mode: 'move',
      originX: pt.x,
      originY: pt.y,
      start: { ...rect },
    };
  }, [disabled, dims, rect]);

  const beginResize = useCallback((e, corner) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const imgEl = imgRef.current;
    if (!imgEl) return;
    const bound = imgEl.getBoundingClientRect();
    const pt = clientToNatural(bound, e.clientX, e.clientY, dims);
    dragRef.current = {
      mode: 'resize',
      corner,
      originX: pt.x,
      originY: pt.y,
      start: { ...rect },
    };
  }, [disabled, dims, rect]);

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d || !imgRef.current) return;
      const bound = imgRef.current.getBoundingClientRect();
      const pt = clientToNatural(bound, e.clientX, e.clientY, dims);
      const dx = pt.x - d.originX;
      const dy = pt.y - d.originY;
      if (d.mode === 'move') {
        onChange?.(clampCropRect({
          left: d.start.left + dx,
          top: d.start.top + dy,
          width: d.start.width,
          height: d.start.height,
        }, dims));
        return;
      }
      // resize from bottom-right primarily; corners adjust opposite edge
      let { left, top, width, height } = d.start;
      if (d.corner.includes('e')) width = d.start.width + dx;
      if (d.corner.includes('s')) height = d.start.height + dy;
      if (d.corner.includes('w')) {
        left = d.start.left + dx;
        width = d.start.width - dx;
      }
      if (d.corner.includes('n')) {
        top = d.start.top + dy;
        height = d.start.height - dy;
      }
      onChange?.(clampCropRect({ left, top, width, height }, dims));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dims, onChange]);

  if (!src) return null;

  return (
    <div
      className={`crop-selector${disabled ? ' is-disabled' : ''}`}
      ref={wrapRef}
      data-testid="image-crop-selector"
    >
      <img
        ref={imgRef}
        src={src}
        alt="Crop source"
        className="crop-selector-img"
        draggable={false}
      />
      <div
        className="crop-selector-rect"
        style={{
          left: `${pct.left}%`,
          top: `${pct.top}%`,
          width: `${pct.width}%`,
          height: `${pct.height}%`,
        }}
        onPointerDown={beginMove}
        role="presentation"
      >
        <span className="crop-handle nw" onPointerDown={(e) => beginResize(e, 'nw')} />
        <span className="crop-handle ne" onPointerDown={(e) => beginResize(e, 'ne')} />
        <span className="crop-handle sw" onPointerDown={(e) => beginResize(e, 'sw')} />
        <span className="crop-handle se" onPointerDown={(e) => beginResize(e, 'se')} />
      </div>
      <p className="helper-note crop-selector-meta">
        Crop {rect.width}×{rect.height} at ({rect.left}, {rect.top})
      </p>
    </div>
  );
}
