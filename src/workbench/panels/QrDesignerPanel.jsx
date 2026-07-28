import React from 'react';
import {
  Button,
  Dropzone,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Skeleton,
  StatusBadge,
} from '../../next/components/index.jsx';
import { QR_ECC_LEVELS, QR_FORMATS } from '../../lib/qrJobOptions.js';

export default function QrDesignerPanel({ state = {}, dispatch = () => {} }) {
  const form = state.form || {};
  const operation = form.operation || 'generate';
  const update = (id, value) => dispatch({ type: 'set-form', id, value });

  return (
    <section className="qr-designer-panel" aria-label="QR designer">
      <header className="qr-designer-panel__header">
        <div>
          <p className="view-eyebrow">QR designer</p>
          <h3>{operation === 'decode' ? 'Decode an image' : 'Encode content'}</h3>
        </div>
        <StatusBadge tone={state.status === 'loading' ? 'live' : state.status === 'error' ? 'danger' : 'neutral'}>
          {state.status === 'loading' ? 'Working' : state.status === 'error' ? 'Needs attention' : operation}
        </StatusBadge>
      </header>

      {operation === 'generate' ? (
        <>
          <div className="qr-designer-panel__preview">
            {state.previewUrl ? (
              <img src={state.previewUrl} alt="Generated QR preview" />
            ) : (
              <div className="qr-designer-panel__placeholder" aria-label="QR preview placeholder">
                <Icon name="qr" size={48} />
                <strong>{String(form.content || '').trim() ? 'Ready to generate' : 'Enter content'}</strong>
              </div>
            )}
          </div>
          <div className="qr-designer-panel__grid">
            <Field
              label="Dark modules"
              variant="color"
              value={form.dark || '#0f172a'}
              onChange={(event) => update('dark', event.currentTarget.value)}
            />
            <Field
              label="Light modules"
              variant="color"
              value={form.light || '#ffffff'}
              onChange={(event) => update('light', event.currentTarget.value)}
            />
            <Field
              label="Error correction"
              variant="select"
              options={QR_ECC_LEVELS}
              value={form.ecc || 'M'}
              onChange={(event) => update('ecc', event.currentTarget.value)}
            />
            <Field
              label="Output format"
              variant="select"
              options={QR_FORMATS}
              value={form.format || 'png'}
              onChange={(event) => update('format', event.currentTarget.value)}
            />
            <Field
              label="Size"
              variant="range"
              min={64}
              max={2048}
              step={64}
              value={form.size || '512'}
              hint={`${form.size || 512} px`}
              onChange={(event) => update('size', event.currentTarget.value)}
            />
            <Field
              label="Quiet-zone margin"
              variant="range"
              min={0}
              max={16}
              step={1}
              value={form.margin || '2'}
              hint={`${form.margin || 0} modules`}
              onChange={(event) => update('margin', event.currentTarget.value)}
            />
          </div>
        </>
      ) : (
        <>
          <Dropzone
            variant="paste"
            accept={state.accept}
            multiple={false}
            title="Paste or add a QR image"
            description="Press Ctrl+V here, drop an image, or browse from your device."
            onFiles={(files) => dispatch({ type: 'paste-files', files })}
          />
          {state.status === 'loading' ? (
            <Skeleton variant="row" lines={3} label="Decoding QR image" />
          ) : state.status === 'error' ? (
            <ErrorState
              title="QR decode failed"
              message={state.error || 'No QR content could be read from this image.'}
              actionLabel="Choose another image"
              onAction={() => dispatch({ type: 'choose-image' })}
            />
          ) : state.decodedText ? (
            <div className="qr-designer-panel__decoded">
              <span>Decoded content</span>
              <pre>{state.decodedText}</pre>
              <Button
                size="sm"
                variant="secondary"
                icon="copy"
                onClick={() => dispatch({ type: 'copy-decoded' })}
              >
                Copy decoded text
              </Button>
            </div>
          ) : (
            <EmptyState
              variant="compact"
              visual={<Icon name="scan" />}
              title="No decoded content yet"
              description="Select or paste a raster QR image, then run Decode image."
            />
          )}
        </>
      )}
    </section>
  );
}
