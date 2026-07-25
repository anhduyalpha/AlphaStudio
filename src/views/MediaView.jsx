import React, { useEffect, useMemo, useRef, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge, Panel, ToggleRow } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave, CapabilityBanner } from '../components/Workbench';
import { SegmentedControl, TimelineRange, FileRow } from '../components/StudioPrimitives';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';
import {
  buildMediaJobOptions,
  describeAudioQuality,
  showsFormatControl,
  showsQualityControl,
} from '../lib/mediaJobOptions';

const OPS = [
  { id: 'inspect', label: 'Inspect', capability: 'media.inspect' },
  { id: 'trim', label: 'Trim', capability: 'media.trim' },
  { id: 'transcode', label: 'Transcode', capability: 'media.transcode' },
  { id: 'extract-audio', label: 'Extract audio', capability: 'media.extract-audio' },
];

const VIDEO_FORMATS = [
  { id: 'mp4', label: 'MP4' },
  { id: 'webm', label: 'WEBM' },
  { id: 'mkv', label: 'MKV' },
];

const AUDIO_FORMATS = [
  { id: 'mp3', label: 'MP3' },
  { id: 'wav', label: 'WAV' },
  { id: 'm4a', label: 'M4A' },
  { id: 'ogg', label: 'OGG' },
];

export default function MediaView({ notify }) {
  const [files, setFiles] = useState([]);
  const [operation, setOperation] = useState('trim');
  const [format, setFormat] = useState('mp4');
  const [quality, setQuality] = useState('balanced');
  const [reencodeOnTrim, setReencodeOnTrim] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 10, duration: 10 });
  const mediaRef = useRef(null);
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);
  const { isAvailable, reason, loading: capsLoading } = useCapabilities();

  const opMeta = OPS.find((o) => o.id === operation) || OPS[0];
  const unavailable = capsLoading ? false : isAvailable(opMeta.capability) === false;
  const file = files[0] || null;
  const mediaUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);

  const showFormat = showsFormatControl(operation, { reencodeOnTrim });
  const showQuality = showsQualityControl(operation, { reencodeOnTrim });
  const formatList = operation === 'extract-audio' ? AUDIO_FORMATS : VIDEO_FORMATS;
  const qInfo = describeAudioQuality(quality);

  useEffect(() => {
    setMediaDuration(0);
    setRange({ start: 0, end: 10, duration: 10 });
  }, [file]);

  useEffect(() => {
    // Default format when switching ops
    if (operation === 'extract-audio') setFormat((f) => (AUDIO_FORMATS.some((x) => x.id === f) ? f : 'mp3'));
    else if (operation === 'transcode' || (operation === 'trim' && reencodeOnTrim)) {
      setFormat((f) => (VIDEO_FORMATS.some((x) => x.id === f) ? f : 'mp4'));
    }
  }, [operation, reencodeOnTrim]);

  const onLoadedMetadata = () => {
    const el = mediaRef.current;
    const d = Number(el?.duration) || 0;
    if (!d || !Number.isFinite(d)) return;
    setMediaDuration(d);
    setRange({ start: 0, end: Math.min(d, 10), duration: Math.min(d, 10) });
  };

  const startJob = async () => {
    if (unavailable) {
      notify(`Unavailable: ${reason(opMeta.capability) || 'ffmpeg/ffprobe required'}`);
      return;
    }
    if (!file) {
      notify('Open a media file first');
      return;
    }
    const options = buildMediaJobOptions({
      operation,
      format,
      quality,
      start: range.start,
      duration: range.duration,
      reencodeOnTrim,
    });
    try {
      await run('media', {
        files: [file],
        options,
        autoDownload: false,
      });
    } catch {
      /* handled */
    }
  };

  const isVideo = file?.type?.startsWith('video/');
  const isAudio = file?.type?.startsWith('audio/');

  return (
    <div className="view-stack media-timeline-workspace family-media" data-testid="media-timeline-workspace">
      <WorkspaceHeader
        meta="Core tools / Media Toolkit"
        title="Media timeline"
        description="Player and editable trim range first. Transcode and extract stay capability-honest."
        family="media"
        status={(
          <StatusBadge tone={unavailable ? 'neutral' : 'pink'} status={unavailable ? 'unavailable' : busy ? 'converting' : 'completed'} live={busy}>
            {unavailable ? 'ffmpeg missing' : busy ? status || 'Running' : operation}
          </StatusBadge>
        )}
      />

      <SegmentedControl
        label="Media operations"
        value={operation}
        onChange={setOperation}
        options={OPS.map((o) => ({ id: o.id, label: o.label }))}
      />

      {unavailable ? (
        <CapabilityBanner title="Media tools unavailable" reason={reason(opMeta.capability) || 'ffmpeg/ffprobe required'} />
      ) : null}

      <WorkbenchLayout
        family="media"
        stage={(
          <Panel title="Player & timeline" actions={<StatusBadge tone="pink">{file ? 'Loaded' : 'Empty'}</StatusBadge>}>
            <FilePicker accept="video/*,audio/*" multiple={false} files={files} onChange={setFiles} disabled={busy} title="Open media" />
            {file ? (
              <FileRow
                name={file.name}
                meta={`${file.type || 'media'} · ${(file.size / 1024 / 1024).toFixed(2)} MB${mediaDuration ? ` · ${mediaDuration.toFixed(1)}s` : ''}`}
                status="ready"
              />
            ) : null}
            {mediaUrl && isVideo ? (
              <video ref={mediaRef} controls src={mediaUrl} style={{ width: '100%', marginTop: 16, borderRadius: 12 }} onLoadedMetadata={onLoadedMetadata} />
            ) : null}
            {mediaUrl && isAudio ? (
              <audio ref={mediaRef} controls src={mediaUrl} style={{ width: '100%', marginTop: 16 }} onLoadedMetadata={onLoadedMetadata} />
            ) : null}
            {!file ? (
              <EmptyState type="noResults" compact title="No media loaded" description="Open a video or audio file to set clip bounds." />
            ) : null}
            {(operation === 'trim' || mediaDuration > 0) && file ? (
              <TimelineRange
                duration={mediaDuration || Math.max(range.end, 30)}
                start={range.start}
                end={range.end}
                disabled={busy}
                onChange={setRange}
              />
            ) : null}
            {busy ? <ProgressWave value={progress} label="Media job" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <Panel title={`${opMeta.label} settings`}>
            {operation === 'trim' ? (
              <>
                <p className="workspace-description" style={{ margin: 0 }} data-testid="media-trim-copy-note">
                  Default trim is stream-copy and keeps the source container. Format is not applied unless you re-encode.
                </p>
                <div className="toggle-stack" style={{ marginTop: 12 }}>
                  <ToggleRow
                    title="Re-encode on trim"
                    description="Convert container/codecs while trimming."
                    checked={reencodeOnTrim}
                    onChange={(e) => setReencodeOnTrim(e.target.checked)}
                  />
                </div>
              </>
            ) : null}
            {operation === 'inspect' ? (
              <p className="workspace-description" style={{ margin: 0 }}>
                Inspect writes media-info JSON via ffprobe (duration, codecs, streams). No output format.
              </p>
            ) : null}
            {showFormat ? (
              <div className="form-grid" data-testid="media-format-controls">
                <SelectField label="Output format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  {formatList.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </SelectField>
              </div>
            ) : null}
            {showQuality ? (
              <div className="form-grid" style={{ marginTop: showFormat ? 12 : 0 }} data-testid="media-quality-controls">
                <SelectField label="Quality preset" value={quality} onChange={(e) => setQuality(e.target.value)}>
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">High</option>
                </SelectField>
              </div>
            ) : null}
            <div className="preview-info-list" style={{ marginTop: 12 }}>
              <div><span>Selection</span><strong>{range.start.toFixed(2)}s – {range.end.toFixed(2)}s</strong></div>
              <div><span>Clip length</span><strong>{range.duration.toFixed(2)}s</strong></div>
              {operation === 'trim' && !reencodeOnTrim ? (
                <div><span>Container</span><strong>Preserved (stream-copy)</strong></div>
              ) : null}
              {showQuality && operation === 'extract-audio' ? (
                <>
                  <div><span>Sample rate</span><strong>{qInfo.sampleRate} Hz</strong></div>
                  <div><span>Channels</span><strong>{qInfo.channels === 1 ? 'Mono' : 'Stereo'}</strong></div>
                  <div><span>Bitrate target</span><strong>{qInfo.bitrate}</strong></div>
                </>
              ) : null}
              <div><span>Engine</span><strong>{unavailable ? 'Unavailable' : 'Local ffmpeg'}</strong></div>
            </div>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{opMeta.label}</strong>
              <span>{unavailable ? 'Blocked' : busy ? `${progress}%` : file ? 'Ready' : 'Need a file'}</span>
            </div>
            <div className="hero-button-row">
              {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
              <PrimaryButton icon="play" onClick={startJob} disabled={busy || unavailable || !file} busy={busy}>
                {unavailable ? 'Unavailable' : 'Run media job'}
              </PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}
