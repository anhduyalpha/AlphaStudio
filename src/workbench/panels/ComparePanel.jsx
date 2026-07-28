import React from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Skeleton,
  StatusBadge,
} from '../../components/index.jsx';

export default function ComparePanel({ state = {}, dispatch = () => {} }) {
  const {
    visible = false,
    variant = 'editor',
    input = '',
    comparison = '',
    stats = { words: 0, characters: 0, lines: 0 },
    output = '',
    outputStatus = 'idle',
    outputError = '',
  } = state || {};
  if (!visible) return null;

  if (variant === 'developer') {
    return (
      <section className="compare-panel compare-panel--output" aria-label="Developer utility output">
        <header className="compare-panel__header">
          <div>
            <p className="view-eyebrow">Latest output</p>
            <h3>Utility result preview</h3>
          </div>
          <StatusBadge tone={outputError ? 'danger' : output ? 'success' : 'neutral'}>
            {outputError ? 'Unavailable' : output ? 'Ready' : 'Waiting'}
          </StatusBadge>
        </header>
        {outputStatus === 'loading' ? (
          <Skeleton variant="row" lines={4} label="Loading utility output" />
        ) : null}
        {outputError ? (
          <ErrorState
            title="Could not load utility output"
            message={outputError}
            actionLabel="Run the utility again"
            onAction={() => dispatch({ type: 'clear-output-error' })}
          />
        ) : null}
        {!output && outputStatus !== 'loading' && !outputError ? (
          <EmptyState
            variant="compact"
            visual={<Icon name="code" />}
            title="No utility output yet"
            description="Run the selected server utility to preview its UTF-8 result here."
          />
        ) : null}
        {output ? (
          <>
            <pre className="compare-panel__output" aria-label="Latest utility output">{output}</pre>
            <Button
              size="sm"
              variant="secondary"
              icon="copy"
              onClick={() => dispatch({ type: 'copy-output' })}
            >
              Copy output
            </Button>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section className="compare-panel" aria-label="Editor tools">
      <header className="compare-panel__header">
        <div>
          <p className="view-eyebrow">Editor</p>
          <h3>Measure and compare</h3>
        </div>
        <StatusBadge tone={input ? 'success' : 'neutral'}>
          {input ? `${stats.words} words` : 'Waiting'}
        </StatusBadge>
      </header>
      <div className="compare-panel__stats" aria-label="Editor statistics">
        <span><strong>{stats.words}</strong> words</span>
        <span><strong>{stats.characters}</strong> characters</span>
        <span><strong>{stats.lines}</strong> lines</span>
      </div>
      <Field
        label="Compare against"
        hint="The line diff below updates locally as you type."
        variant="textarea"
        value={comparison}
        onChange={(event) => dispatch({ type: 'set-comparison', value: event.currentTarget.value })}
      />
      <div className="compare-panel__actions">
        <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'apply-case', value: 'upper' })}>
          UPPER
        </Button>
        <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'apply-case', value: 'lower' })}>
          lower
        </Button>
        <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'apply-case', value: 'title' })}>
          Title
        </Button>
        <Button size="sm" variant="ghost" icon="copy" disabled={!input} onClick={() => dispatch({ type: 'copy-editor' })}>
          Copy
        </Button>
        <Button size="sm" variant="ghost" icon="download" disabled={!input} onClick={() => dispatch({ type: 'export-editor' })}>
          Export
        </Button>
        <Button size="sm" variant="ghost" icon="trash" disabled={!input} onClick={() => dispatch({ type: 'clear-editor' })}>
          Clear
        </Button>
      </div>
    </section>
  );
}
