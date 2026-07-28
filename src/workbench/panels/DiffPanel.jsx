import React, { useMemo } from 'react';
import { EmptyState, Icon, StatusBadge } from '../../next/components/index.jsx';
import { boundedDiffLines, summarizeDiff } from '../../lib/textDiff.js';

const MAX_RENDERED_HUNKS = 240;

export default function DiffPanel({ state = {} }) {
  const {
    visible = false,
    left = '',
    right = '',
  } = state || {};
  const diff = useMemo(() => boundedDiffLines(left, right), [left, right]);
  const summary = useMemo(() => summarizeDiff(diff.hunks), [diff.hunks]);
  if (!visible) return null;

  return (
    <section className="diff-panel" aria-label="Text line diff">
      <header className="diff-panel__header">
        <div>
          <p className="view-eyebrow">Line diff</p>
          <h3>{summary.identical ? 'Texts are identical' : 'Changes detected'}</h3>
        </div>
        <StatusBadge tone={summary.identical ? 'success' : 'warning'}>
          {summary.identical ? `${summary.equal} equal` : `+${summary.added} / −${summary.removed}`}
        </StatusBadge>
      </header>
      {!left && !right ? (
        <EmptyState
          variant="compact"
          visual={<Icon name="layers" />}
          title="Nothing to compare"
          description="Enter editor text and a comparison value to render a bounded local diff."
        />
      ) : (
        <>
          <ol className="diff-panel__hunks" aria-label="Diff lines">
            {diff.hunks.slice(0, MAX_RENDERED_HUNKS).map((hunk, index) => (
              <li key={`${hunk.type}-${hunk.leftLine || 0}-${hunk.rightLine || 0}-${index}`} data-diff-type={hunk.type}>
                <span>{hunk.type === 'add' ? '+' : hunk.type === 'remove' ? '−' : ' '}</span>
                <code>{hunk.text || ' '}</code>
              </li>
            ))}
          </ol>
          {diff.truncated || diff.hunks.length > MAX_RENDERED_HUNKS ? (
            <p className="diff-panel__note">
              Preview bounded to {MAX_RENDERED_HUNKS} rendered changes and 400 source lines per side.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
