import React, { useEffect, useMemo, useRef, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge, Panel } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave, CapabilityBanner } from '../components/Workbench';
import { SegmentedControl, TimelineRange, WaveformStrip, FileRow } from '../components/StudioPrimitives';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';

const MODES = [
  { id: 'convert', label: 'Convert', icon: 'swap', capability: 'audio.convert' },
  { id: 'trim', label: 'Trim', icon: 'scissors', capability: 'audio.trim' },
  { id: 'normalize', label: 'Normalize', icon: 'audio', capability: 'audio.normalize' },
  { id: 'inspect', label: 'Inspect', icon: 'eye', capability: 'media.inspect' },
];

const FORMATS = [
  { id: 'mp3', label: 'MP3' },
  { id: 'wav', label: 'WAV' },
  { id: 'flac', label: 'FLAC' },
  { id: 'aac', label: 'AAC' },
  { id: 'ogg', label: 'OGG' },
  { id: 'm4a', label: 'M4A' },
];

export default function AudioView({ notify }) {
  const [mode, setMode] = useState('convert');
  const [files, setFiles] = useState([]);
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState('balanced');
  const [mediaDuration, setMediaDuration] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 30, duration: 30 });
  const [playhead, setPlayhead] = useState(0);
  const audioRef = useRef(null);
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);
  const { isAvailable, reason, loading: capsLoading } = useCapabilities();

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const capOk = capsLoading ? null : isAvailable(modeMeta.capability);
  const unavailable = capOk === false;
  const file = files[0] || null;
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  useEffect(() => {
    setPlayhead(0);
    setMediaDuration(0);
    setRange({ start: 0, end: 30, duration: 30 });
  }, [file]);

  const onLoadedMetadata = () => {
    const d = Number(audioRef.current?.duration) || 0;
    if (!d || !Number.isFinite(d)) return;
    setMediaDuration(d);
    setRange({ start: 0, end: d, duration: d });
  };

  const onTimeUpdate = () => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    setPlayhead((el.currentTime / el.duration) * 100);
  };

  const startJob = async () => {
    if (unavailable) {
      notify(`Unavailable: ${reason(modeMeta.capability) || modeMeta.capability}`);
      return;
    }
    if (!file) {
      notify('Open an audio file first');
      return;
    }
    const options = {
      operation: mode,
      family: 'audio',
      format,
      quality,
    };
    if (mode === 'trim') {
      options.start = String(range.start);
      options.duration = String(Math.max(0.05, range.duration));
    }
    try {
      await run('media', {
        files: [file],
        options,
        autoDownload: false,
      });
    } catch {
      /* hook notifies */
    }
  };

  return (
    <div className="view-stack audio-workspace family-audio" data-testid="audio-workspace">
      <WorkspaceHeader
        meta="More tools / Audio Lab"
        title="Audio workspace"
        description="Player and waveform first. Convert, trim, and normalize map to local ffmpeg when available."
        family="audio"
        status={(
          <StatusBadge
            tone={unavailable ? 'neutral' : busy ? 'cyan' : 'pink'}
            status={unavailable ? 'unavailable' : busy ? 'converting' : 'completed'}
            live={busy}
          >
            {unavailable ? 'ffmpeg missing' : busy ? status || 'Running' : mode}
          </StatusBadge>
        )}
      />

      <SegmentedControl
        label="Audio modes"
        value={mode}
        onChange={setMode}
        options={MODES.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))}
      />

      {unavailable ? (
        <CapabilityBanner
          title="Audio tools unavailable"
          reason={reason(modeMeta.capability) || 'ffmpeg/ffprobe required for this mode.'}
        />
      ) : null}

      <WorkbenchLayout
        family="audio"
        stage={(
          <Panel title="Player stage" actions={<StatusBadge tone="pink">{file ? file.name : 'Empty'}</StatusBadge>}>
            <FilePicker
              accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac"
              multiple={false}
              files={files}
              onChange={setFiles}
              disabled={busy}
              title="Open audio"
              subtitle="Waveform is generated in the browser; processing runs on the local API"
            />
            {file ? (
              <FileRow name={file.name} meta={`${file.type || 'audio'} · ${(file.size / 1024).toFixed(1)} KB`} status="ready" />
            ) : (
              <EmptyState type="noResults" compact title="No audio loaded" description="Drop a track to preview waveform and set a trim range." />
            )}
            {objectUrl ? (
              <audio
                ref={audioRef}
                controls
                src={objectUrl}
                style={{ width: '100%', marginTop: 12 }}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
              />
            ) : null}
            <WaveformStrip file={file} progress={playhead} />
            {(mode === 'trim' || mediaDuration > 0) ? (
              <TimelineRange
                duration={mediaDuration || Math.max(range.end, 30)}
                start={range.start}
                end={range.end}
                disabled={busy || !file}
                onChange={setRange}
              />
            ) : null}
            {busy ? <ProgressWave value={progress} label="Audio job" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <Panel title={modeMeta.label}>
            {mode === 'convert' || mode === 'trim' ? (
              <div className="form-grid">
                <SelectField label="Output format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </SelectField>
                <SelectField label="Quality preset" value={quality} onChange={(e) => setQuality(e.target.value)}>
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">High</option>
                </SelectField>
              </div>
            ) : null}
            {mode === 'normalize' ? (
              <p className="workspace-description" style={{ margin: 0 }}>
                Loudness normalization via ffmpeg. Bitrate and sample rate follow the balanced audio encode preset.
              </p>
            ) : null}
            {mode === 'inspect' ? (
              <p className="workspace-description" style={{ margin: 0 }}>
                Produces media-info JSON (streams, duration, codecs) using ffprobe.
              </p>
            ) : null}
            <div className="preview-info-list" style={{ marginTop: 12 }}>
              <div><span>Mode</span><strong>{modeMeta.label}</strong></div>
              <div><span>File</span><strong>{file?.name || '—'}</strong></div>
              <div><span>Duration</span><strong>{mediaDuration ? `${mediaDuration.toFixed(2)}s` : '—'}</strong></div>
              {mode === 'trim' ? (
                <div><span>Selection</span><strong>{range.start.toFixed(2)}s – {range.end.toFixed(2)}s</strong></div>
              ) : null}
              <div><span>Engine</span><strong>{unavailable ? 'Unavailable' : 'Local ffmpeg'}</strong></div>
            </div>
            <p className="helper-note" style={{ marginTop: 12 }}>
              Vocal separation and other ML features are not supported in this local build.
            </p>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{modeMeta.label}</strong>
              <span>{unavailable ? 'Blocked' : busy ? `${progress}%` : file ? 'Ready' : 'Need a file'}</span>
            </div>
            <div className="hero-button-row">
              {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
              <PrimaryButton icon="audio" onClick={startJob} disabled={busy || unavailable || !file} busy={busy}>
                {unavailable ? 'Unavailable' : `Run ${modeMeta.label.toLowerCase()}`}
              </PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}
