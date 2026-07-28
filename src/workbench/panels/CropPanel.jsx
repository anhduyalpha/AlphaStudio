import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  clampCropRect,
  clientToNatural,
  defaultCropRect,
  naturalToDisplayPercent,
} from '../../lib/imageCrop.js';

function useObjectUrl(file) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

export default function CropPanel({ state = {}, dispatch = () => {} }) {
  const {
    file = null,
    previewFile = null,
    previewStatus = 'idle',
    previewError = '',
    crop = null,
    dimensions = null,
    disabled = false,
    visible = false,
  } = state || {};
  const [imageError, setImageError] = useState('');
  const [dragStart, setDragStart] = useState(null);
  const imageRef = useRef(null);
  const sourceUrl = useObjectUrl(previewFile);
  const natural = {
    naturalWidth: Number(dimensions?.width) || 1,
    naturalHeight: Number(dimensions?.height) || 1,
  };

  useEffect(() => {
    setImageError('');
    setDragStart(null);
  }, [sourceUrl]);

  if (!visible) return null;

  const publish = (next) => {
    if (!dimensions?.width || !dimensions?.height) return;
    dispatch({
      type: 'set-crop',
      value: clampCropRect(next, natural),
    });
  };

  const onImageLoad = (event) => {
    const nextDimensions = {
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight,
    };
    dispatch({ type: 'set-dimensions', value: nextDimensions });
    if (!crop) {
      dispatch({
        type: 'set-crop',
        value: defaultCropRect({
          naturalWidth: nextDimensions.width,
          naturalHeight: nextDimensions.height,
        }),
      });
    }
  };

  const pointerPosition = (event) => {
    const image = imageRef.current;
    if (!image || !dimensions?.width || !dimensions?.height) return null;
    return clientToNatural(
      image.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      natural,
    );
  };

  const overlay = crop && dimensions?.width && dimensions?.height
    ? naturalToDisplayPercent(crop, natural)
    : null;

  return (
    <section className="crop-panel" data-crop-panel="true">
      <header className="crop-panel__header">
        <div>
          <p className="view-eyebrow">Crop editor</p>
          <h3>{file?.originalName || file?.name || 'Choose an image'}</h3>
        </div>
        <StatusBadge tone={imageError || previewStatus === 'error' ? 'danger' : crop ? 'success' : 'neutral'}>
          {imageError || previewStatus === 'error' ? 'Preview unavailable' : crop ? `${crop.width} × ${crop.height}` : 'Waiting for image'}
        </StatusBadge>
      </header>

      {!file ? (
        <EmptyState
          variant="compact"
          visual={<Icon name="crop" />}
          title="No image selected"
          description="Select one image to draw a crop region in natural pixels."
        />
      ) : null}
      {file && previewStatus === 'loading' ? (
        <Skeleton variant="row" lines={3} label="Loading crop preview" />
      ) : null}
      {file && (previewStatus === 'error' || imageError) ? (
        <ErrorState
          title="Could not render the crop canvas"
          message={previewError || imageError || 'The image could not be decoded.'}
          actionLabel="Retry preview"
          onAction={() => dispatch({ type: 'retry-preview' })}
        />
      ) : null}

      {sourceUrl && previewStatus === 'ready' && !imageError ? (
        <div
          className={['crop-panel__stage', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}
          onPointerDown={(event) => {
            if (disabled) return;
            const point = pointerPosition(event);
            if (!point) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDragStart(point);
          }}
          onPointerMove={(event) => {
            if (disabled || !dragStart) return;
            const point = pointerPosition(event);
            if (!point) return;
            publish({
              left: Math.min(dragStart.x, point.x),
              top: Math.min(dragStart.y, point.y),
              width: Math.max(1, Math.abs(point.x - dragStart.x)),
              height: Math.max(1, Math.abs(point.y - dragStart.y)),
            });
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            setDragStart(null);
          }}
        >
          <img
            ref={imageRef}
            src={sourceUrl}
            alt="Crop source"
            draggable="false"
            onLoad={onImageLoad}
            onError={() => setImageError('The browser rejected the image')}
          />
          {overlay ? (
            <span
              className="crop-panel__selection"
              style={{
                left: `${overlay.left}%`,
                top: `${overlay.top}%`,
                width: `${overlay.width}%`,
                height: `${overlay.height}%`,
              }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      ) : null}

      {crop ? (
        <div className="crop-panel__fields">
          {[
            ['left', 'Left'],
            ['top', 'Top'],
            ['width', 'Width'],
            ['height', 'Height'],
          ].map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={String(crop[key])}
              disabled={disabled}
              inputMode="numeric"
              onChange={(event) => publish({ ...crop, [key]: Number(event.currentTarget.value) })}
            />
          ))}
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !dimensions?.width}
            onClick={() => publish(defaultCropRect(natural))}
          >
            Reset to centered 50%
          </Button>
        </div>
      ) : null}
    </section>
  );
}
