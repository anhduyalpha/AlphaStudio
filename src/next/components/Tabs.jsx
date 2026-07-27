import React, { useId, useMemo, useRef, useState } from 'react';

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function getNextTabIndex(items, currentIndex, key) {
  if (!KEYS.has(key) || items.length === 0) return currentIndex;
  const enabled = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.disabled)
    .map(({ index }) => index);
  if (enabled.length === 0) return currentIndex;
  if (key === 'Home') return enabled[0];
  if (key === 'End') return enabled[enabled.length - 1];
  const enabledPosition = enabled.indexOf(currentIndex);
  const start = enabledPosition >= 0 ? enabledPosition : 0;
  const delta = key === 'ArrowRight' ? 1 : -1;
  return enabled[(start + delta + enabled.length) % enabled.length];
}

export default function Tabs({
  items = [],
  value,
  defaultValue,
  onChange,
  variant = 'underline',
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}) {
  const generatedId = useId().replace(/:/g, '');
  const refs = useRef([]);
  const firstEnabled = useMemo(() => items.find((item) => !item.disabled)?.id, [items]);
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? firstEnabled);
  const selectedValue = controlled ? value : internalValue;

  function select(item) {
    if (item.disabled) return;
    if (!controlled) setInternalValue(item.id);
    onChange?.(item.id, item);
  }

  function handleTablistKeyDown(event) {
    const currentIndex = refs.current.indexOf(event.target);
    const nextIndex = getNextTabIndex(items, currentIndex, event.key);
    if (nextIndex === currentIndex || !KEYS.has(event.key)) return;
    event.preventDefault();
    const item = items[nextIndex];
    select(item);
    refs.current[nextIndex]?.focus();
  }

  const safeVariant = variant === 'segmented' ? 'segmented' : 'underline';

  return (
    <div className={['tabs', `tabs--${safeVariant}`, className].filter(Boolean).join(' ')}>
      <div
        className="tabs__list"
        role="tablist"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onKeyDown={handleTablistKeyDown}
      >
        {items.map((item, index) => {
          const selected = item.id === selectedValue;
          const tabId = `${generatedId}-tab-${item.id}`;
          const panelId = `${generatedId}-panel-${item.id}`;
          const hasPanel = item.panel !== undefined;
          return (
            <button
              key={item.id}
              ref={(node) => { refs.current[index] = node; }}
              id={tabId}
              type="button"
              role="tab"
              className="tabs__tab"
              aria-selected={selected}
              aria-controls={hasPanel ? panelId : undefined}
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(item)}
            >
              {item.icon ? <span className="tabs__icon">{item.icon}</span> : null}
              <span>{item.label}</span>
              {item.badge ? <span className="tabs__badge">{item.badge}</span> : null}
            </button>
          );
        })}
      </div>
      {items.map((item) => item.panel !== undefined ? (
        <div
          key={item.id}
          id={`${generatedId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${generatedId}-tab-${item.id}`}
          hidden={item.id !== selectedValue}
          tabIndex={0}
          className="tabs__panel"
        >
          {item.panel}
        </div>
      ) : null)}
    </div>
  );
}
