import React, { useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import { PageIntro, PrimaryButton, SecondaryButton, SelectField, StatusBadge, TextField } from '../components/Common';
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
      // Inspect also downloads the probe JSON so the user gets a real artifact.
      await run('media', {
        files: files.slice(0, 1),
        options: {
          operation,
          format,
          start,
          duration,
        },
        autoDownload: false,
      });
    } catch {
      /* handled */
    }
  };

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Tools / Media Toolkit"
        title="Prepare clips and audio from a local editor UI."
        description="Inspect, trim, transcode, and extract audio when ffmpeg is installed. Otherwise tools show Unavailable."
        actions={
          <>
            {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
            <PrimaryButton icon="play" onClick={startJob} disabled={busy || unavailable}>
              {unavailable ? 'Unavailable' : busy ? `${progress}%` : 'Run media job'}
            </PrimaryButton>
          </>
        }
      />

      <section className="workspace-grid">
        <div className="workspace-primary">
          <article className="surface-card content-card">
            <div className="card-heading">
              <div><p className="eyebrow">Source</p><h3>Media file</h3></div>
              <StatusBadge tone={unavailable ? 'neutral' : 'pink'}>{unavailable ? 'ffmpeg missing' : 'ffmpeg'}</StatusBadge>
            </div>
            <FilePicker accept="video/*,audio/*" multiple={false} files={files} onChange={setFiles} disabled={busy} title="Open media" />
            {files[0]?.type?.startsWith('video/') ? (
              <video controls src={URL.createObjectURL(files[0])} style={{ width: '100%', marginTop: 16, borderRadius: 12 }} />
            ) : null}
          </article>
          <article className="surface-card content-card">
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
          </article>
        </div>
        <aside className="workspace-sidebar">
          <article className="surface-card content-card sticky-card">
            <p className="eyebrow">Status</p>
            <h3>{unavailable ? 'Unavailable' : busy ? status : 'Ready'}</h3>
            {unavailable ? <p className="helper-note">{reason(opMeta.capability)}</p> : null}
            <PrimaryButton icon="play" onClick={startJob} disabled={busy || unavailable || !files.length}>
              {unavailable ? 'Unavailable' : 'Process'}
            </PrimaryButton>
          </article>
        </aside>
      </section>
      <JobOutputCard job={job} notify={notify} title="Processed media" />
    </div>
  );
}
