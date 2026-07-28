import React from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Skeleton,
  StatusBadge,
} from '../../next/components/index.jsx';

function Swatches({ colors = [], onSelect }) {
  if (!colors.length) return null;
  return (
    <div className="color-lab-panel__swatches" aria-label="Color palette">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Select ${color}`}
          title={color}
          style={{ background: color }}
          onClick={() => onSelect(color)}
        />
      ))}
    </div>
  );
}

export default function ColorLabPanel({ state = {}, dispatch = () => {} }) {
  const form = state.form || {};
  const result = state.result || {};
  const colorMode = form.colorMode || 'picker';
  const update = (id, value) => dispatch({ type: 'set-form', id, value });
  const colors = result.palette || [];

  return (
    <section className="color-lab-panel" aria-label="Color lab">
      <header className="color-lab-panel__header">
        <div>
          <p className="view-eyebrow">Browser color lab</p>
          <h3>{colorMode === 'image' ? 'Image palette' : colorMode}</h3>
        </div>
        <StatusBadge tone={state.status === 'loading' ? 'live' : state.status === 'error' ? 'danger' : 'neutral'}>
          {state.status === 'loading' ? 'Sampling' : state.status === 'error' ? 'Needs attention' : 'Local'}
        </StatusBadge>
      </header>

      {colorMode === 'picker' || colorMode === 'palette' ? (
        <>
          <div className="color-lab-panel__canvas" style={{ background: result.hex }} />
          <div className="color-lab-panel__grid">
            <Field
              label="Color"
              variant="color"
              value={form.hex}
              onChange={(event) => update('hex', event.currentTarget.value)}
            />
            <Field
              label="Hex"
              value={form.hex}
              onChange={(event) => update('hex', event.currentTarget.value)}
            />
          </div>
          <div className="color-lab-panel__metrics">
            <span>RGB</span>
            <strong>{result.rgb ? `${result.rgb.r}, ${result.rgb.g}, ${result.rgb.b}` : '—'}</strong>
          </div>
          {colorMode === 'palette' ? (
            <Swatches
              colors={colors}
              onSelect={(color) => dispatch({ type: 'select-swatch', value: color })}
            />
          ) : null}
        </>
      ) : null}

      {colorMode === 'contrast' ? (
        <>
          <div
            className="color-lab-panel__contrast"
            style={{
              color: result.contrast?.foreground,
              background: result.contrast?.background,
            }}
          >
            <strong>Readable interface copy</strong>
            <span>
              {result.contrast?.ratio ? `${result.contrast.ratio.toFixed(2)}:1` : 'Invalid color pair'}
            </span>
          </div>
          <div className="color-lab-panel__grid">
            <Field
              label="Foreground"
              variant="color"
              value={form.foreground}
              onChange={(event) => update('foreground', event.currentTarget.value)}
            />
            <Field
              label="Background"
              variant="color"
              value={form.background}
              onChange={(event) => update('background', event.currentTarget.value)}
            />
          </div>
          <div className="color-lab-panel__grades">
            <StatusBadge tone={result.contrast?.grade?.aaBody ? 'success' : 'danger'}>
              AA body {result.contrast?.grade?.aaBody ? 'pass' : 'fail'}
            </StatusBadge>
            <StatusBadge tone={result.contrast?.grade?.aaaBody ? 'success' : 'warning'}>
              AAA body {result.contrast?.grade?.aaaBody ? 'pass' : 'fail'}
            </StatusBadge>
          </div>
        </>
      ) : null}

      {colorMode === 'gradient' ? (
        <>
          <div className="color-lab-panel__gradient" style={{ background: result.gradient }} />
          <div className="color-lab-panel__grid">
            <Field
              label="Gradient start"
              variant="color"
              value={form.gradientStart}
              onChange={(event) => update('gradientStart', event.currentTarget.value)}
            />
            <Field
              label="Gradient end"
              variant="color"
              value={form.gradientEnd}
              onChange={(event) => update('gradientEnd', event.currentTarget.value)}
            />
          </div>
          <code className="color-lab-panel__code">{result.gradient}</code>
        </>
      ) : null}

      {colorMode === 'image' ? (
        <>
          {state.status === 'loading' ? (
            <Skeleton variant="row" lines={4} label="Sampling image pixels" />
          ) : state.status === 'error' ? (
            <ErrorState
              title="Palette extraction failed"
              message={state.error || 'The image pixels could not be sampled.'}
              actionLabel="Retry extraction"
              onAction={() => dispatch({ type: 'extract-palette' })}
            />
          ) : colors.length ? (
            <>
              {state.previewUrl ? <img className="color-lab-panel__image" src={state.previewUrl} alt="Palette source" /> : null}
              <Swatches
                colors={colors}
                onSelect={(color) => dispatch({ type: 'select-swatch', value: color })}
              />
            </>
          ) : (
            <EmptyState
              variant="compact"
              visual={<Icon name="palette" />}
              title="No image palette yet"
              description="Add one image; AlphaStudio samples real pixels in this browser."
            />
          )}
          <div className="color-lab-panel__actions">
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              disabled={!state.hasImage || state.status === 'loading'}
              onClick={() => dispatch({ type: 'extract-palette' })}
            >
              Extract palette
            </Button>
          </div>
        </>
      ) : null}

      <div className="color-lab-panel__actions">
        <Button
          size="sm"
          variant="secondary"
          icon="copy"
          disabled={!colors.length && !result.gradient && !result.contrast?.ratio}
          onClick={() => dispatch({ type: 'copy-result' })}
        >
          Copy result
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="download"
          disabled={!colors.length}
          onClick={() => dispatch({ type: 'export-palette' })}
        >
          Export palette
        </Button>
      </div>
    </section>
  );
}
