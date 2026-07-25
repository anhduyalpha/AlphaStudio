import React, { useMemo, useState } from 'react';
import Icon from '../Icon';
import { buildArchiveTree, countTreeNodes, filterArchiveTree } from '../../lib/archiveTree';

function TreeNode({ node, depth, expanded, toggle }) {
  if (!node) return null;
  const isDir = node.isDir;
  const open = expanded.has(node.path);
  const pad = { paddingLeft: `${8 + depth * 14}px` };

  if (isDir) {
    return (
      <div className="archive-tree-node">
        <button
          type="button"
          className="archive-tree-row"
          style={pad}
          onClick={() => toggle(node.path)}
          aria-expanded={open}
        >
          <span className="archive-tree-twist" aria-hidden="true">{open ? '▼' : '▶'}</span>
          <span className="archive-tree-name">{node.name || '/'}</span>
          <small>{node.children?.length || 0}</small>
        </button>
        {open ? (node.children || []).map((c) => (
          <TreeNode key={c.path} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} />
        )) : null}
      </div>
    );
  }

  return (
    <div className="archive-tree-row is-file" style={pad} role="listitem">
      <Icon name="file" size={14} />
      <span className="archive-tree-name" title={node.path}>{node.name}</span>
      {node.size != null ? <small>{node.size} B</small> : null}
    </div>
  );
}

/**
 * Hierarchical archive browser with expand/collapse + search.
 * @param {Array} entries - flat inspect listing
 * @param {number} [maxVisible=400] - soft cap for rendering after filter
 */
export default function ArchiveTree({ entries = [], maxVisible = 400 }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set(['']));

  const root = useMemo(() => buildArchiveTree(entries), [entries]);
  const filtered = useMemo(() => filterArchiveTree(root, query), [root, query]);
  const total = useMemo(() => countTreeNodes(root), [root]);
  const visibleCount = useMemo(() => countTreeNodes(filtered), [filtered]);

  const toggle = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Auto-expand when searching
  const expandedEffective = useMemo(() => {
    if (!query.trim()) return expanded;
    const all = new Set(['']);
    const walk = (n) => {
      if (!n) return;
      if (n.isDir) all.add(n.path);
      (n.children || []).forEach(walk);
    };
    walk(filtered);
    return all;
  }, [query, expanded, filtered]);

  return (
    <div className="archive-tree-browser" data-testid="archive-tree-browser">
      <label className="field-group">
        <span className="field-label">Search entries</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by path…"
          data-testid="archive-tree-search"
        />
      </label>
      <p className="helper-note">
        {total} entries
        {query.trim() ? ` · ${visibleCount} match` : ''}
        {visibleCount > maxVisible ? ` · rendering capped for performance` : ''}
      </p>
      <div className="archive-tree-scroll" role="tree" aria-label="Archive contents">
        {(filtered.children || []).length ? (
          filtered.children.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={0}
              expanded={expandedEffective}
              toggle={toggle}
            />
          ))
        ) : (
          <p className="helper-note">No matching entries.</p>
        )}
      </div>
    </div>
  );
}
