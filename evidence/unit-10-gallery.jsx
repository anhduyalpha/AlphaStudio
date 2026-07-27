import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import '../src/styles/primitives.css';
import {
  Button,
  Dropzone,
  ErrorState,
  FileList,
  FileRow,
  ProgressBar,
  ResumeStrip,
  RunBar,
  Toast,
  ToastRegion,
} from '../src/next/components/index.jsx';
import './unit-10-gallery.css';

const query = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = query.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.motion = query.get('motion') === 'reduced' ? 'reduced' : 'full';
const activePanel = query.get('panel') || 'all';
const activePart = query.get('part') || 'all';

function Panel({ name, children }) {
  return activePanel === 'all' || activePanel === name ? children : null;
}

function Section({ eyebrow, title, children, wide = false }) {
  return (
    <section className={wide ? 'flow-section flow-section--wide' : 'flow-section'}>
      <header className="flow-section__header">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function StateTile({ label, className = '', part, children }) {
  if (activePart !== 'all' && part && activePart !== part) return null;
  return (
    <div className={['flow-state', className].filter(Boolean).join(' ')}>
      <span className="flow-state__label">{label}</span>
      {children}
    </div>
  );
}

const uploadSessions = [{
  id: 'up-01',
  originalName: 'campaign-master.mov',
  receivedBytes: 58720256,
  size: 125829120,
  href: '#/media?mode=convert',
}];

const jobs = [{
  id: 'job-01',
  label: 'Quarterly document batch',
  status: 'queued',
  progress: 18,
  href: '#/documents?mode=convert',
}];

function StateMatrix() {
  return (
    <main className="flow-shell">
      <header className="flow-hero">
        <div>
          <p className="flow-kicker">C3 · interaction proof</p>
          <h1>File &amp; flow state matrix</h1>
          <p>Required interaction, loading, error, empty and disabled treatments.</p>
        </div>
      </header>

      <div className="flow-grid">
        <Panel name="dropzone">
        <Section eyebrow="Dropzone" title="D · H · F · A · X · E" wide>
          <div className="flow-state-grid flow-state-grid--three">
            <StateTile label="Default / populated" part="a"><Dropzone empty={false} /></StateTile>
            <StateTile label="Empty" part="a"><Dropzone /></StateTile>
            <StateTile label="Hover" className="force-hover" part="c"><Dropzone title="Ready for files" /></StateTile>
            <StateTile label="Focus" className="force-focus" part="c"><Dropzone title="Keyboard ready" /></StateTile>
            <StateTile label="Drag-over" className="force-drag" part="b"><Dropzone title="Release to add" /></StateTile>
            <StateTile label="Paste" part="b"><Dropzone variant="paste" /></StateTile>
            <StateTile label="Disabled" part="b"><Dropzone disabled /></StateTile>
          </div>
        </Section>
        </Panel>

        <Panel name="files">
        <Section eyebrow="FileRow" title="D · H · F · S · L · Er · X" wide>
          <div className="flow-state-grid flow-state-grid--two">
            <StateTile label="Default" part="a"><FileRow name="recording.wav" size={4831838} /></StateTile>
            <StateTile label="Hover" className="force-row-hover" part="a"><FileRow name="presentation.pdf" size={2122318} /></StateTile>
            <StateTile label="Focus" className="force-row-focus" part="a"><FileRow name="archive.zip" size={9017754} actions={<Button size="sm">Open</Button>} /></StateTile>
            <StateTile label="Selected" part="a"><FileRow name="brand-assets.zip" size={6738142} selected /></StateTile>
            <StateTile label="Loading" part="b"><FileRow name="interview.mov" size={125829120} status="uploading" progress={47} /></StateTile>
            <StateTile label="Error" part="b"><FileRow name="damaged-document.pdf" status="failed" meta="Source could not be decoded" actions={<Button size="sm">Remove</Button>} /></StateTile>
            <StateTile label="Disabled" part="b"><FileRow name="managed-file.pdf" size={718221} disabled /></StateTile>
            <StateTile label="List empty" part="b"><FileList items={[]} /></StateTile>
          </div>
        </Section>
        </Panel>

        <Panel name="progress">
        <Section eyebrow="Progress" title="Determinate · indeterminate · silent aggregate">
          <div className="flow-stack">
            <StateTile label="42%"><ProgressBar value={42} label="Upload progress" /></StateTile>
            <StateTile label="Indeterminate"><ProgressBar variant="indeterminate" label="Inspecting file" /></StateTile>
            <StateTile label="Reduced static"><ProgressBar variant="indeterminate" reduced label="Reduced-motion progress" /></StateTile>
            <StateTile label="Complete"><ProgressBar value={100} label="Complete" /></StateTile>
          </div>
        </Section>

        <Section eyebrow="Recovery" title="Persistent named action">
          <ErrorState
            title="Conversion failed"
            message="The source appears to be truncated. Retry the same file or remove it."
            actionLabel="Retry conversion"
            onAction={() => {}}
          />
        </Section>
        </Panel>

        <Panel name="resume">
        <Section eyebrow="ResumeStrip" title="Full · uploads-only · empty" wide>
          <div className="flow-stack">
            <ResumeStrip uploadSessions={uploadSessions} jobs={jobs} onResume={() => {}} onDiscard={() => {}} />
            <ResumeStrip variant="uploads-only" uploadSessions={uploadSessions} onResume={() => {}} onDiscard={() => {}} />
            <ResumeStrip />
          </div>
        </Section>
        </Panel>

        <Panel name="run">
        <Section eyebrow="RunBar" title="Default · loading · disabled" wide>
          <div className="flow-stack flow-stack--runbars">
            <RunBar status="2 files ready" primaryAction={<Button variant="primary">Convert files</Button>} />
            <RunBar
              busy
              status="Converting 2 of 4 files"
              progress={54}
              secondaryAction={<Button>Cancel</Button>}
              primaryAction={<Button variant="primary" busy>Converting</Button>}
            />
            <RunBar disabled status="Add a supported file to continue" primaryAction={<Button variant="primary" disabled>Convert files</Button>} />
          </div>
        </Section>

        <Section eyebrow="Toast" title="Notice · success · danger" wide>
          <div className="flow-toast-proof">
            <ToastRegion className="flow-toast-proof" aria-label="Notification live region">
              <Toast tone="notice" autoDismiss={false}>Preferences saved on this device.</Toast>
              <Toast tone="success" autoDismiss={false}>3 outputs are ready to download.</Toast>
              <Toast tone="danger" autoDismiss={false}>Could not copy the link.</Toast>
            </ToastRegion>
          </div>
        </Section>
        </Panel>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StateMatrix />);
