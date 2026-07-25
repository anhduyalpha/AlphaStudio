import React, { useMemo } from 'react';
import { diffLines, diffWords, summarizeDiff } from '../../lib/textDiff';

export default function DiffView({ left = '', right = '', wordLevel = true }) {
  const hunks = useMemo(() => diffLines(left, right), [left, right]);
  const summary = useMemo(() => summarizeDiff(hunks), [hunks]);

  return (
    <div className="text-diff-view" data-testid="text-diff-view">
      <div className="preview-info-list" style={{ marginBottom: 12 }}>
        <div><span>Added lines</span><strong>{summary.added}</strong></div>
        <div><span>Removed lines</span><strong>{summary.removed}</strong></div>
        <div><span>Unchanged</span><strong>{summary.equal}</strong></div>
        <div><span>Status</span><strong>{summary.identical ? 'Identical' : 'Different'}</strong></div>
      </div>
      <div className="text-diff-hunks" role="list" aria-label="Line diff">
        {hunks.map((h, idx) => {
          if (h.type === 'equal') {
            return (
              <div key={idx} className="diff-line is-equal" role="listitem">
                <span className="diff-gutter">{h.leftLine}</span>
                <span className="diff-code">{h.text || ' '}</span>
              </div>
            );
          }
          if (h.type === 'remove') {
            return (
              <div key={idx} className="diff-line is-remove" role="listitem">
                <span className="diff-gutter">−{h.leftLine}</span>
                <span className="diff-code">{h.text || ' '}</span>
              </div>
            );
          }
          // add — optionally show word-level vs previous remove
          const prev = hunks[idx - 1];
          const showWords = wordLevel && prev && prev.type === 'remove';
          const tokens = showWords ? diffWords(prev.text, h.text) : null;
          return (
            <div key={idx} className="diff-line is-add" role="listitem">
              <span className="diff-gutter">+{h.rightLine}</span>
              <span className="diff-code">
                {tokens
                  ? tokens.map((t, i) => (
                    <span key={i} className={`diff-token is-${t.type}`}>{t.text}</span>
                  ))
                  : (h.text || ' ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
