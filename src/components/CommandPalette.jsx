import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import EmptyState from './EmptyState';
import Icon from './Icon';
import Modal from './Modal';

export function buildPaletteItems(navigation = []) {
  return navigation.flatMap((item) => {
    const label = item.label || item.name || item.id;
    const href = item.href || `#/${item.id}`;
    const hub = {
      id: item.id,
      label,
      context: item.group || 'Navigation',
      icon: item.icon || 'dashboard',
      href,
      keywords: item.keywords || '',
    };
    const modes = (item.modes || []).map((mode) => ({
      id: `${item.id}:${mode.id}`,
      label: mode.label || mode.name || mode.id,
      context: label,
      icon: mode.icon || item.icon || 'dashboard',
      href: `${href}?mode=${encodeURIComponent(mode.id)}`,
      keywords: mode.keywords || '',
    }));
    return [hub, ...modes];
  });
}

export function filterPaletteItems(items, query) {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) => (
    `${item.label} ${item.context} ${item.keywords} ${item.id}`
      .toLocaleLowerCase()
      .includes(normalized)
  ));
}

export function getNextPaletteIndex(length, current, key) {
  if (length <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowDown') return (current + 1 + length) % length;
  if (key === 'ArrowUp') return (current - 1 + length) % length;
  return Math.min(Math.max(current, 0), length - 1);
}

export function getPaletteInputEntryIndex(length, key) {
  if (length <= 0) return -1;
  return key === 'ArrowUp' || key === 'End' ? length - 1 : 0;
}

export default function CommandPalette({
  open,
  navigation = [],
  onClose,
  onNavigate,
  initialQuery = '',
}) {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const resultsId = useId();
  const items = useMemo(() => buildPaletteItems(navigation), [navigation]);
  const results = useMemo(() => filterPaletteItems(items, query), [items, query]);

  useEffect(() => {
    if (!open) setQuery(initialQuery);
    setActiveIndex(results.length ? 0 : -1);
  }, [initialQuery, open, query, results.length]);

  const focusResult = (index) => {
    if (index < 0) return;
    setActiveIndex(index);
    requestAnimationFrame(() => {
      resultsRef.current?.querySelector(`[data-palette-index="${index}"]`)?.focus();
    });
  };

  const navigate = (item) => {
    onNavigate?.(item.href, item);
    onClose?.();
  };

  const handleListKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    focusResult(getNextPaletteIndex(results.length, activeIndex, event.key));
  };

  return (
    <Modal
      open={open}
      variant="palette"
      ariaLabel="Search AlphaStudio"
      onClose={onClose}
      initialFocusRef={inputRef}
      className="command-palette-layer"
    >
      <div className="command-palette">
        <label className="command-palette__search">
          <Icon name="search" />
          <span className="sr-only">Search tools and modes</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                focusResult(getPaletteInputEntryIndex(results.length, event.key));
              }
            }}
            placeholder="Search tools and modes…"
            aria-controls={resultsId}
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </label>
        {results.length ? (
          <div
            ref={resultsRef}
            id={resultsId}
            className="command-palette__results"
            role="listbox"
            aria-label="Matching tools and modes"
            onKeyDown={handleListKeyDown}
          >
            {results.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={index === activeIndex ? 0 : -1}
                className={index === activeIndex ? 'is-selected' : ''}
                data-palette-index={index}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => navigate(item)}
              >
                <Icon name={item.icon} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.context}</small>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        ) : (
          <div className="command-palette__empty">
            <EmptyState
              variant="compact"
              title="No tools or modes found"
              description="Try a hub name, mode, or workflow."
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
