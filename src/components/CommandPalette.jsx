import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

export default function CommandPalette({ open, navigation, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);

  const results = useMemo(
    () => navigation.filter((item) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q) || item.id.includes(q);
    }),
    [navigation, query],
  );

  const go = (id) => {
    onNavigate(id);
    onClose();
  };

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return undefined;
    }

    const root = dialogRef.current;
    const previous = document.activeElement;

    const getFocusable = () => {
      if (!root) return [];
      return Array.from(
        root.querySelectorAll(
          'button:not([disabled]):not(.modal-scrim), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    };

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (results.length === 0) return;
        event.preventDefault();
        setActiveIndex((idx) => {
          if (event.key === 'ArrowDown') return (idx + 1) % results.length;
          return (idx - 1 + results.length) % results.length;
        });
        return;
      }

      if (event.key === 'Enter' && results[activeIndex]) {
        // Prefer activating highlighted result when focus is in the search input.
        if (document.activeElement === inputRef.current) {
          event.preventDefault();
          go(results[activeIndex].id);
          return;
        }
      }

      if (event.key !== 'Tab' || !root) return;
      const list = getFocusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || !root.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !root.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous && typeof previous.focus === 'function') {
        try {
          previous.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open, onClose, onNavigate, results, activeIndex]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  return (
    <div className="modal-layer" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search AlphaStudio">
      <button
        className="modal-scrim"
        type="button"
        tabIndex={-1}
        onClick={onClose}
        aria-label="Close search"
      />
      <div className="command-palette" data-testid="command-palette">
        <div className="command-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspaces and settings…"
            aria-label="Search workspaces and settings"
            aria-controls="command-palette-results"
            aria-autocomplete="list"
            autoComplete="off"
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
