import React, { useMemo, useState } from 'react';
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
  buildArchiveTree,
  countTreeNodes,
  filterArchiveTree,
  flattenTree,
} from '../../lib/archiveTree.js';

const MAX_RENDERED_ENTRIES = 500;

export default function ArchiveTreePanel({ state = {}, dispatch = () => {} }) {
  const [query, setQuery] = useState('');
  const entries = Array.isArray(state.entries) ? state.entries : [];
  const tree = useMemo(() => buildArchiveTree(entries), [entries]);
  const filtered = useMemo(() => filterArchiveTree(tree, query), [query, tree]);
  const nodes = useMemo(
    () => flattenTree(filtered, [], MAX_RENDERED_ENTRIES),
    [filtered],
  );
  const total = useMemo(() => countTreeNodes(tree), [tree]);

  if (state.visible === false) return null;
  if (state.status === 'loading') {
    return <Skeleton variant="row" lines={5} label="Loading archive contents" />;
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title="Archive contents are unavailable"
        message={state.error || 'The archive listing could not be read.'}
        actionLabel="Retry listing"
        onAction={() => dispatch({ type: 'retry-listing' })}
      />
    );
  }

  return (
    <section className="archive-tree-panel" aria-label="Archive contents">
      <header className="archive-tree-panel__header">
        <div>
          <p className="view-eyebrow">Archive inspector</p>
          <h3>Contents tree</h3>
        </div>
        <StatusBadge tone={entries.length ? 'success' : 'neutral'}>
          {entries.length ? `${total} entries` : 'Waiting'}
        </StatusBadge>
      </header>
      {!entries.length ? (
        <EmptyState
          variant="compact"
          visual={<Icon name="archive" />}
          title="No archive listing yet"
          description="Select an archive and run Inspect to render its bounded contents tree."
        />
      ) : (
        <>
          <Field
            label="Filter archive entries"
            value={query}
            placeholder="Search paths"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {!nodes.length ? (
            <EmptyState
              variant="compact"
              visual={<Icon name="search" />}
              title="No matching entries"
              description="Try a broader filename or path."
              action={<Button size="sm" variant="ghost" onClick={() => setQuery('')}>Clear filter</Button>}
            />
          ) : (
            <ul className="archive-tree-panel__list" aria-label="Archive entry tree">
              {nodes.map((node) => {
                const depth = Math.max(0, String(node.path || '').split('/').length - 1);
                return (
                  <li
                    key={`${node.isDir ? 'dir' : 'file'}:${node.path}`}
                    className="archive-tree-panel__entry"
                    style={{ '--archive-depth': depth }}
                  >
                    <Icon name={node.isDir ? 'layers' : 'file'} size={16} />
                    <span>{node.name}</span>
                    {!node.isDir && Number.isFinite(node.size) ? (
                      <small>{node.size.toLocaleString()} B</small>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {total > MAX_RENDERED_ENTRIES ? (
            <p className="archive-tree-panel__limit">
              Showing the first {MAX_RENDERED_ENTRIES.toLocaleString()} entries.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
