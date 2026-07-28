import React from 'react';
import { Field, StatusBadge } from '../../next/components/index.jsx';

export function normalizeTimelineRange({ total, start, duration }) {
  const round = (value) => Math.round(value * 1000) / 1000;
  const safeTotal = round(Math.max(0.05, Number(total) || 10));
  const safeStart = round(Math.max(0, Math.min(safeTotal - 0.05, Number(start) || 0)));
  const safeDuration = round(Math.max(
    0.05,
    Math.min(safeTotal - safeStart, Number(duration) || safeTotal - safeStart),
  ));
  return {
    total: safeTotal,
    start: safeStart,
    end: round(safeStart + safeDuration),
    duration: safeDuration,
  };
}

export default function TimelinePanel({ state = {}, dispatch = () => {} }) {
  const {
    visible = false,
    total = 0,
    start = 0,
    duration = 10,
    disabled = false,
  } = state || {};
  if (!visible) return null;

  const range = normalizeTimelineRange({ total, start, duration });
  const publish = (nextStart, nextEnd) => {
    const next = normalizeTimelineRange({
      total: range.total,
      start: nextStart,
      duration: Math.max(0.05, nextEnd - nextStart),
    });
    dispatch({ type: 'set-range', value: next });
  };
  const left = (range.start / range.total) * 100;
  const width = (range.duration / range.total) * 100;

  return (
    <section className="timeline-panel" aria-label="Trim timeline">
      <header className="timeline-panel__header">
        <div>
          <p className="view-eyebrow">Timeline</p>
          <h3>Trim selection</h3>
        </div>
        <StatusBadge tone="neutral">{range.duration.toFixed(2)}s selected</StatusBadge>
      </header>
      <div className="timeline-panel__track" aria-hidden="true">
        <span style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
      <div className="timeline-panel__sliders">
        <input
          type="range"
          min={0}
          max={range.total}
          step={0.01}
          value={range.start}
          disabled={disabled}
          aria-label="Trim start"
          onChange={(event) => publish(
            Math.min(Number(event.currentTarget.value), range.end - 0.05),
            range.end,
          )}
        />
        <input
          type="range"
          min={0.05}
          max={range.total}
          step={0.01}
          value={range.end}
          disabled={disabled}
          aria-label="Trim end"
          onChange={(event) => publish(
            range.start,
            Math.max(Number(event.currentTarget.value), range.start + 0.05),
          )}
        />
      </div>
      <div className="timeline-panel__fields">
        <Field
          label="Start (seconds)"
          value={range.start.toFixed(2)}
          disabled={disabled}
          inputMode="decimal"
          onChange={(event) => publish(
            Math.min(Number(event.currentTarget.value) || 0, range.end - 0.05),
            range.end,
          )}
        />
        <Field
          label="End (seconds)"
          value={range.end.toFixed(2)}
          disabled={disabled}
          inputMode="decimal"
          onChange={(event) => publish(
            range.start,
            Math.max(Number(event.currentTarget.value) || 0.05, range.start + 0.05),
          )}
        />
      </div>
      <p className="timeline-panel__summary">
        {range.start.toFixed(2)}s – {range.end.toFixed(2)}s of {range.total.toFixed(2)}s
      </p>
    </section>
  );
}
