import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Icon, Skeleton, StatusBadge } from '../../components/index.jsx';

export const WAVEFORM_BAR_COUNT = 56;

export function waveformPeaks(channel, barCount = WAVEFORM_BAR_COUNT) {
  const safeCount = Math.max(8, Math.min(128, Math.floor(Number(barCount) || WAVEFORM_BAR_COUNT)));
  if (!channel?.length) return [];
  const block = Math.max(1, Math.floor(channel.length / safeCount));
  return Array.from({ length: safeCount }, (_, index) => {
    let peak = 0;
    const start = index * block;
    const end = Math.min(channel.length, start + block);
    for (let cursor = start; cursor < end; cursor += 1) {
      peak = Math.max(peak, Math.abs(channel[cursor] || 0));
    }
    return Math.max(0.08, Math.min(1, peak));
  });
}

function fallbackPeaks(count = WAVEFORM_BAR_COUNT) {
  return Array.from({ length: count }, (_, index) => 0.18 + ((index * 17) % 52) / 100);
}

export default function WaveformPanel({ state = {} }) {
  const {
    previewFile = null,
    previewStatus = 'idle',
    progress = 0,
    visible = false,
  } = state || {};
  const [peaks, setPeaks] = useState([]);
  const [status, setStatus] = useState('idle');
  const generationRef = useRef(0);
  const identity = useMemo(
    () => previewFile
      ? `${previewFile.name}|${previewFile.size}|${previewFile.lastModified || 0}`
      : '',
    [previewFile],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    let context = null;
    let cancelled = false;
    setPeaks([]);
    if (!visible || previewStatus !== 'ready' || !previewFile) {
      setStatus('idle');
      return undefined;
    }
    setStatus('loading');
    void (async () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Web Audio is unavailable');
        context = new AudioContextClass();
        const bytes = await previewFile.arrayBuffer();
        const decoded = await context.decodeAudioData(bytes.slice(0));
        if (cancelled || generation !== generationRef.current) return;
        const next = waveformPeaks(decoded.getChannelData(0));
        if (!next.length) throw new Error('Audio has no decoded samples');
        setPeaks(next);
        setStatus('ready');
      } catch {
        if (!cancelled && generation === generationRef.current) {
          setPeaks(fallbackPeaks());
          setStatus('fallback');
        }
      } finally {
        try {
          await context?.close?.();
        } catch {
          // Context already closed.
        }
      }
    })();
    return () => {
      cancelled = true;
      generationRef.current += 1;
      try {
        void context?.close?.();
      } catch {
        // Context already closed.
      }
    };
  }, [identity, previewFile, previewStatus, visible]);

  if (!visible) return null;
  if (!previewFile && previewStatus !== 'loading') {
    return (
      <EmptyState
        variant="compact"
        visual={<Icon name="audio" />}
        title="Waveform waiting for audio"
        description="Select an audio file to analyze its samples in the browser."
      />
    );
  }
  if (previewStatus === 'loading' || status === 'loading') {
    return <Skeleton variant="row" lines={3} label="Analyzing audio waveform" />;
  }

  const playhead = Math.max(0, Math.min(100, Number(progress) || 0));
  const bars = peaks.length ? peaks : fallbackPeaks();
  return (
    <section className="waveform-panel" aria-label="Audio waveform">
      <header className="waveform-panel__header">
        <div>
          <p className="view-eyebrow">Waveform</p>
          <h3>Decoded audio envelope</h3>
        </div>
        <StatusBadge tone={status === 'ready' ? 'success' : 'warning'}>
          {status === 'ready' ? `${bars.length} peaks` : 'Static fallback'}
        </StatusBadge>
      </header>
      <div className="waveform-panel__plot" role="img" aria-label={status === 'ready' ? 'Audio waveform peaks' : 'Static waveform fallback'}>
        {bars.map((peak, index) => (
          <i key={index} style={{ height: `${Math.max(8, peak * 100)}%` }} />
        ))}
        <span className="waveform-panel__playhead" style={{ left: `${playhead}%` }} aria-hidden="true" />
      </div>
      <p className="waveform-panel__note">
        {status === 'ready'
          ? 'Waveform analysis stays in the browser.'
          : 'The browser could not decode samples; playback and backend processing remain available.'}
      </p>
    </section>
  );
}
