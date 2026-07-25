import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import StatusIcon from './StatusIcon';

/** Horizontal mode switcher for purpose-built workspaces */
export function SegmentedControl({
  options = [],
  value,
  onChange,
  label = 'Mode',
  className = '',
}) {
  return (
    <div className={`segmented-control ${className}`.trim()} role="tablist" aria-label={label}>
      {options.map((opt) => {
        const id = opt.id || opt.value || opt;
        const text = opt.label || opt.title || String(opt);
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`segmented-item${selected ? ' is-active' : ''}`}
            onClick={() => onChange?.(id)}
          >
            {opt.icon ? <Icon name={opt.icon} size={16} /> : null}
            <span>{text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Dual-handle time range (start + duration or start + end) in seconds */
export function TimelineRange({
  duration = 0,
  start = 0,
  end,
  onChange,
  disabled = false,
  label = 'Timeline range',
}) {
  const max = Math.max(Number(duration) || 0, 0.01);
  const startVal = Math.min(Math.max(0, Number(start) || 0), max);
  const endVal = end == null
    ? max
    : Math.min(Math.max(startVal, Number(end) || max), max);
  const span = Math.max(endVal - startVal, 0);

  const setStart = (v) => {
    const next = Math.min(Math.max(0, Number(v) || 0), endVal);
    onChange?.({ start: next, end: endVal, duration: endVal - next });
  };
  const setEnd = (v) => {
    const next = Math.min(Math.max(startVal, Number(v) || 0), max);
    onChange?.({ start: startVal, end: next, duration: next - startVal });
  };

  const leftPct = (startVal / max) * 100;
  const widthPct = (span / max) * 100;

  return (
    <div className={`timeline-range${disabled ? ' is-disabled' : ''}`} aria-label={label}>
      <div className="timeline-range-track" aria-hidden="true">
        <div className="timeline-range-fill" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
      </div>
      <div className="timeline-range-inputs">
        <label className="field-group">
          <span className="field-label">Start (s)</span>
          <input
            type="number"
            min={0}
            max={max}
            step={0.1}
            value={Number(startVal.toFixed(2))}
            disabled={disabled}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="field-group">
          <span className="field-label">End (s)</span>
          <input
            type="number"
            min={0}
            max={max}
            step={0.1}
            value={Number(endVal.toFixed(2))}
            disabled={disabled}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <div className="timeline-range-meta">
          <span>Duration</span>
          <strong>{span.toFixed(2)}s</strong>
        </div>
      </div>
      <div className="timeline-range-sliders">
        <input
          type="range"
          min={0}
          max={max}
          step={0.05}
          value={startVal}
          disabled={disabled}
          aria-label="Range start"
          onChange={(e) => setStart(e.target.value)}
        />
        <input
          type="range"
          min={0}
          max={max}
          step={0.05}
          value={endVal}
          disabled={disabled}
          aria-label="Range end"
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * Client-side waveform peaks from a File/Blob.
 * Falls back to static bars when Web Audio is unavailable or decode fails.
 */
export function WaveformStrip({
  file,
  peaks: externalPeaks,
  progress = 0,
  className = '',
  barCount = 48,
}) {
  const [peaks, setPeaks] = useState(() => externalPeaks || []);
  const [mode, setMode] = useState(externalPeaks?.length ? 'ready' : 'idle');
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  useEffect(() => {
    if (externalPeaks?.length) {
      setPeaks(externalPeaks);
      setMode('ready');
      return undefined;
    }
    if (!file) {
      setPeaks([]);
      setMode('idle');
      return undefined;
    }
    let cancelled = false;
    setMode('loading');
    (async () => {
      try {
        if (typeof window === 'undefined' || !window.AudioContext && !window.webkitAudioContext) {
          throw new Error('no-audio-context');
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const buffer = await file.arrayBuffer();
        const audio = await ctx.decodeAudioData(buffer.slice(0));
        const channel = audio.getChannelData(0);
        const block = Math.floor(channel.length / barCount) || 1;
        const next = [];
        for (let i = 0; i < barCount; i += 1) {
          let sum = 0;
          const offset = i * block;
          for (let j = 0; j < block; j += 1) sum += Math.abs(channel[offset + j] || 0);
          next.push(Math.min(1, (sum / block) * 3.2));
        }
        if (!cancelled) {
          setPeaks(next);
          setMode('ready');
        }
        await ctx.close?.();
      } catch {
        if (!cancelled) {
          setPeaks(Array.from({ length: barCount }, (_, i) => 0.25 + ((i * 17) % 40) / 100));
          setMode('fallback');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [file, externalPeaks, barCount]);

  const bars = peaks.length ? peaks : Array.from({ length: barCount }, () => 0.2);
  const playhead = Math.max(0, Math.min(100, Number(progress) || 0));

  return (
    <div
      className={`waveform-strip mode-${mode} ${className}`.trim()}
      role="img"
      aria-label={mode === 'fallback' ? 'Waveform unavailable; showing static bars' : 'Audio waveform'}
    >
      <div className="waveform" data-playing={playhead > 0 && playhead < 100 ? 'true' : 'false'}>
        {bars.map((p, i) => (
          <i key={i} style={{ height: `${Math.max(12, p * 100)}%` }} />
        ))}
      </div>
      <div className="waveform-playhead" style={{ left: `${playhead}%` }} aria-hidden="true" />
      {mode === 'loading' ? <span className="waveform-status">Analyzing audio…</span> : null}
      {mode === 'fallback' ? <span className="waveform-status">Static waveform (decode unavailable)</span> : null}
    </div>
  );
}

/** Compact file row for queues / boards */
export function FileRow({
  name,
  meta,
  status,
  progress,
  selected = false,
  onSelect,
  onRemove,
  actions,
  leading,
}) {
  return (
    <div
      className={`studio-file-row${selected ? ' is-selected' : ''}${status ? ` status-${status}` : ''}`}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={onSelect ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      } : undefined}
    >
      <div className="studio-file-leading">
        {leading || (status ? <StatusIcon status={status} /> : <Icon name="file" size={18} />)}
      </div>
      <div className="studio-file-main">
        <strong>{name}</strong>
        {meta ? <span>{meta}</span> : null}
        {progress != null && progress >= 0 && progress < 100 ? (
          <div className="studio-file-progress" aria-hidden="true">
            <i style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>
      <div className="studio-file-actions">
        {actions}
        {onRemove ? (
          <button
            type="button"
            className="icon-button liquid-press"
            aria-label={`Remove ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function FileRowList({ children, label = 'Files', empty }) {
  return (
    <div className="studio-file-list" role="list" aria-label={label}>
      {React.Children.count(children) ? children : empty}
    </div>
  );
}

/** Compare slider for image before/after */
export function CompareSlider({ beforeSrc, afterSrc, beforeLabel = 'Before', afterLabel = 'After' }) {
  const [pos, setPos] = useState(50);
  const ref = useRef(null);
  if (!beforeSrc) return null;

  return (
    <div className="compare-slider" ref={ref}>
      <div className="compare-layer compare-after">
        {afterSrc ? <img src={afterSrc} alt={afterLabel} /> : <div className="compare-placeholder">{afterLabel}</div>}
      </div>
      <div className="compare-layer compare-before" style={{ width: `${pos}%` }}>
        <img src={beforeSrc} alt={beforeLabel} />
      </div>
      <input
        className="compare-range"
        type="range"
        min={0}
        max={100}
        value={pos}
        aria-label="Compare before and after"
        onChange={(e) => setPos(Number(e.target.value))}
      />
      <div className="compare-labels">
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
    </div>
  );
}
