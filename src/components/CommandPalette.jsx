import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

export default function CommandPalette({ open, navigation, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const results = useMemo(
    () => navigation.filter((item) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q) || item.id.includes(q);
    }),
    [navigation, query],
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return undefined;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const go = (id) => {
    onNavigate(id);
    onClose();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      go(results[activeIndex].id);
    }
  };

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Search AlphaStudio" onKeyDown={onKeyDown}>
      <button className="modal-scrim" type="button" onClick={onClose} aria-label="Close search" />
      <div className="command-palette" data-testid="command-palette">
        <div className="command-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspaces and settings…"
            aria-label="Search workspaces"
            aria-controls="command-palette-results"
            aria-autocomplete="list"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-results" id="command-palette-results" role="listbox" aria-label="Matching workspaces">
          {results.map((item, index) => (
            <button
              type="button"
              key={item.id}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => go(item.id)}
            >
              <span>
                <Icon name={item.icon} />
                <b>{item.label}</b>
              </span>
              <small>{item.group}</small>
            </button>
          ))}
          {results.length === 0 ? <p>No workspace found.</p> : null}
        </div>
      </div>
    </div>
  );
}
