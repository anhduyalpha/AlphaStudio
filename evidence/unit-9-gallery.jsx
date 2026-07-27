import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import '../src/styles/primitives.css';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Skeleton,
  StatusBadge,
  Tabs,
  Toggle,
} from '../src/next/components/index.jsx';
import './unit-9-gallery.css';

const query = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = query.get('theme') === 'light' ? 'light' : 'dark';

function Section({ eyebrow, title, children, wide = false }) {
  return (
    <section className={wide ? 'proof-section proof-section--wide' : 'proof-section'}>
      <header className="proof-section__header">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function StateTile({ state, label, className = '', children }) {
  return (
    <div className={['proof-state', `proof-state--${state}`, className].filter(Boolean).join(' ')}>
      <span className="proof-state__label">{label}</span>
      <div className="proof-state__sample">{children}</div>
    </div>
  );
}

function StateProof() {
  const stateTabs = [
    { id: 'first', label: 'Convert' },
    { id: 'second', label: 'Inspect' },
    { id: 'disabled', label: 'Unavailable', disabled: true },
  ];

  return (
    <main className="proof-shell proof-shell--states">
      <header className="proof-hero">
        <div>
          <p className="proof-kicker">C2 · interaction proof</p>
          <h1>Required state matrix</h1>
          <p>Each treatment remains distinct without changing layout bounds.</p>
        </div>
        <StatusBadge tone="live">Live</StatusBadge>
      </header>

      <div className="proof-state-sections">
        <Section eyebrow="Button" title="Default · hover · focus · pressed · loading · disabled" wide>
          <div className="proof-state-grid proof-state-grid--six">
            <StateTile state="default" label="Default"><Button variant="secondary">Action</Button></StateTile>
            <StateTile state="hover" label="Hover"><Button variant="secondary">Action</Button></StateTile>
            <StateTile state="focus" label="Focus"><Button variant="ghost">Action</Button></StateTile>
            <StateTile state="active" label="Pressed"><Button variant="danger">Delete</Button></StateTile>
            <StateTile state="loading" label="Loading"><Button variant="primary" busy>Running</Button></StateTile>
            <StateTile state="disabled" label="Disabled"><Button disabled>Action</Button></StateTile>
          </div>
        </Section>

        <Section eyebrow="Field" title="Default · focus · error · disabled" wide>
          <div className="proof-state-grid proof-state-grid--four">
            <StateTile state="default" label="Default"><Field label="Name" defaultValue="report.pdf" /></StateTile>
            <StateTile state="focus" label="Focus"><Field label="Name" defaultValue="report.pdf" /></StateTile>
            <StateTile state="error" label="Error"><Field label="Name" defaultValue="report.exe" error="Use a supported extension." /></StateTile>
            <StateTile state="disabled" label="Disabled"><Field label="Name" defaultValue="Managed by policy" disabled /></StateTile>
          </div>
        </Section>

        <Section eyebrow="Tabs" title="Default · hover · focus · selected · disabled" wide>
          <div className="proof-state-grid proof-state-grid--tabs">
            <StateTile state="default" label="Default"><Tabs aria-label="Default tabs" items={stateTabs} value="first" /></StateTile>
            <StateTile state="hover" label="Hover"><Tabs aria-label="Hover tabs" items={stateTabs} value="first" /></StateTile>
            <StateTile state="focus" label="Focus"><Tabs aria-label="Focus tabs" items={stateTabs} value="first" /></StateTile>
            <StateTile state="selected" label="Selected + disabled"><Tabs aria-label="Selected tabs" items={stateTabs} value="second" variant="segmented" /></StateTile>
          </div>
        </Section>

        <Section eyebrow="Toggle" title="Default · focus · selected · disabled" wide>
          <div className="proof-state-grid proof-state-grid--four">
            <StateTile state="default" label="Default"><Toggle label="Auto-save" /></StateTile>
            <StateTile state="focus" label="Focus"><Toggle label="Auto-save" /></StateTile>
            <StateTile state="selected" label="Selected"><Toggle label="Auto-save" checked /></StateTile>
            <StateTile state="disabled" label="Disabled"><Toggle label="Auto-save" disabled /></StateTile>
          </div>
        </Section>

        <Section eyebrow="Loading" title="Skeleton block · row" wide>
          <div className="proof-state-grid proof-state-grid--two">
            <StateTile state="loading" label="Block"><Skeleton variant="block" /></StateTile>
            <StateTile state="loading" label="Rows"><Skeleton variant="row" lines={3} /></StateTile>
          </div>
        </Section>
      </div>
    </main>
  );
}

function App() {
  const tabs = [
    { id: 'convert', label: 'Convert', icon: <Icon name="converter" /> },
    { id: 'inspect', label: 'Inspect', icon: <Icon name="eye" />, badge: '4' },
    { id: 'locked', label: 'Unavailable', disabled: true },
  ];

  return (
    <main className="proof-shell">
      <header className="proof-hero">
        <div>
          <p className="proof-kicker">AlphaStudio · component foundation</p>
          <h1>Controls &amp; status primitives</h1>
          <p>Opaque utility surfaces, precise interaction states, semantic outcomes.</p>
        </div>
        <StatusBadge tone="live">3 active jobs</StatusBadge>
      </header>

      <div className="proof-grid">
        <Section eyebrow="01" title="Actions" wide>
          <div className="proof-row">
            <Button variant="primary" icon="sparkles">Run workflow</Button>
            <Button variant="secondary" icon="upload">Add files</Button>
            <Button variant="ghost">View details</Button>
            <Button variant="danger" icon="trash">Delete</Button>
            <Button variant="icon" icon="refresh" aria-label="Refresh" />
            <Button variant="primary" busy>Exporting</Button>
            <Button variant="secondary" disabled>Unavailable</Button>
            <Button variant="secondary" size="sm">Compact</Button>
          </div>
        </Section>

        <Section eyebrow="02" title="Inputs">
          <div className="proof-stack">
            <Field label="Output name" placeholder="presentation.pdf" hint="Keep the original extension." />
            <Field label="Format" variant="select" defaultValue="pdf" options={[
              { value: 'pdf', label: 'PDF document' },
              { value: 'png', label: 'PNG images' },
            ]} />
            <Field label="Notes" variant="textarea" defaultValue="Preserve vector layers." />
            <Field label="Broken input" defaultValue="report.exe" error="Choose a supported output extension." />
            <div className="proof-field-pair">
              <Field label="Accent" variant="color" defaultValue="#9b7cff" />
              <Field label="Quality" variant="range" defaultValue="72" />
            </div>
            <Field label="Keep document metadata" variant="checkbox" defaultChecked />
            <Field label="Locked setting" disabled defaultValue="Managed by policy" />
          </div>
        </Section>

        <Section eyebrow="03" title="Selection">
          <div className="proof-stack proof-stack--loose">
            <Tabs aria-label="Workspace mode" items={tabs} defaultValue="convert" variant="underline" />
            <Tabs aria-label="Compact mode" items={tabs.slice(0, 2)} defaultValue="inspect" variant="segmented" />
            <Toggle label="Keep original files" description="Retain source files after export." checked />
            <Toggle label="Cloud sync" description="Unavailable while offline." disabled />
          </div>
        </Section>

        <Section eyebrow="04" title="Status language" wide>
          <div className="proof-row">
            <StatusBadge>Draft</StatusBadge>
            <StatusBadge tone="live">Uploading</StatusBadge>
            <StatusBadge tone="success">Completed</StatusBadge>
            <StatusBadge tone="warning">Tool missing</StatusBadge>
            <StatusBadge tone="danger">Failed</StatusBadge>
          </div>
          <div className="proof-stack proof-stack--banner">
            <Banner title="Local processing">
              Files remain on this device unless a workflow explicitly says otherwise.
            </Banner>
            <Banner tone="warning" title="FFmpeg unavailable" icon={<Icon name="warning" />}>
              Install the runtime to enable media conversion.
            </Banner>
          </div>
        </Section>

        <Section eyebrow="05" title="Surfaces">
          <div className="proof-stack">
            <Card
              title="Output package"
              subtitle="12 files · 84.2 MB"
              actions={<StatusBadge tone="success">Ready</StatusBadge>}
            >
              Everything is ready to download.
            </Card>
            <Card variant="flat" title="Interactive card" subtitle="Hover or focus this surface" interactive>
              Open recent workspace
            </Card>
          </div>
        </Section>

        <Section eyebrow="06" title="Empty & loading">
          <div className="proof-stack">
            <EmptyState
              variant="compact"
              visual={<Icon name="upload" size={24} />}
              title="No files yet"
              description="Drop files here or browse from your device."
              action={<Button size="sm" variant="secondary">Browse</Button>}
            />
            <Card variant="flat" title="Preparing workspace">
              <Skeleton variant="row" lines={3} />
            </Card>
          </div>
        </Section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(query.has('states') ? <StateProof /> : <App />);
