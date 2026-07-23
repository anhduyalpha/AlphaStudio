import React, { useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge, TextField, Panel } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave, CapabilityBanner } from '../components/Workbench';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';

const OPS = [
  { id: 'inspect', label: 'Inspect', capability: 'media.inspect' },
  { id: 'trim', label: 'Trim', capability: 'media.trim' },
  { id: 'transcode', label: 'Transcode', capability: 'media.transcode' },
  { id: 'extract-audio', label: 'Extract audio', capability: 'media.extract-audio' },
];

export default function MediaView({ notify }) {
  const [files, setFiles] = useState([]);
  const [operation, setOperation] = useState('inspect');
  const [format, setFormat] = useState('mp4');
  const [start, setStart] = useState('0');
  const [duration, setDuration] = useState('10');
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);
  const { isAvailable, reason } = useCapabilities();

  const opMeta = OPS.find((o) => o.id === operation) || OPS[0];
  const unavailable = isAvailable(opMeta.capability) === false;

  const startJob = async () => {
    if (unavailable) {
      notify(`Unavailable: ${reason(opMeta.capability) || 'ffmpeg/ffprobe required'}`);
      return;
    }
    if (!files.length) {
      notify('Open a media file first');
      return;
    }
    try {
      await run('media', {
        files: files.slice(0, 1),
        options: { operation, format, start, duration },
        autoDownload: false,
      });
    } catch {
      /* handled */
    }
  };

  const mediaUrl = files[0] ? URL.createObjectURL(files[0]) : null;

  return (
    <div className="view-stack media-timeline-workspace family-media" data-testid="media-timeline-workspace">
      <WorkspaceHeader
        meta="Core tools / Media Toolkit"
        title="Media timeline"
        description="Player and clip bounds first. Transcode and extract actions stay capability-honest."
        family="media"
        status={(
          <StatusBadge tone={unavailable ? 'neutral' : 'pink'} status={unavailable ? 'unavailable' : busy ? 'converting' : 'completed'} live={busy}>
            {unavailable ? 'ffmpeg missing' : busy ? status || 'Running' : operation}
          </StatusBadge>
        )}
      />

      {unavailable ? (
        <CapabilityBanner title="Media tools unavailable" reason={reason(opMeta.capability) || 'ffmpeg/ffprobe required'} />
      ) : null}

      <WorkbenchLayout
        family="media"
        stage={(
          <Panel title="Timeline stage" actions={<StatusBadge tone="pink">{files.length ? 'Loaded' : 'Empty'}</StatusBadge>}>
            <FilePicker accept="video/*,audio/*" multiple={false} files={files} onChange={setFiles} disabled={busy} title="Open media" />
            {mediaUrl && files[0]?.type?.startsWith('video/') ? (
              <video controls src={mediaUrl} style={{ width: '100%', marginTop: 16, borderRadius: 12 }} />
            ) : null}
            {mediaUrl && files[0]?.type?.startsWith('audio/') ? (
              <audio controls src={mediaUrl} style={{ width: '100%', marginTop: 16 }} />
            ) : null}
            {!files.length ? (
              <EmptyState type="noResults" compact title="No media loaded" description="Open a video or audio file to scrub and process." />
            ) : null}
            {busy ? <ProgressWave value={progress} label="Media job" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <Panel title="Clip tools">
            <div className="form-grid">
              <SelectField label="Operation" value={operation} onChange={(e) => setOperation(e.target.value)}>
                {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </SelectField>
              <SelectField label="Output format" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="mp4">MP4</option>
                <option value="webm">WEBM</option>
                <option value="mp3">MP3</option>
                <option value="wav">WAV</option>
              </SelectField>
              <TextField label="Start (seconds or timestamp)" value={start} onChange={(e) => setStart(e.target.value)} />
              <TextField label="Duration (seconds)" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{opMeta.label}</strong>
              <span>{unavailable ? 'Blocked' : busy ? `${progress}%` : 'Ready'}</span>
            </div>
            <div className="hero-button-row">
              {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
              <PrimaryButton icon="play" onClick={startJob} disabled={busy || unavailable} busy={busy}>
                {unavailable ? 'Unavailable' : 'Run media job'}
              </PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}
