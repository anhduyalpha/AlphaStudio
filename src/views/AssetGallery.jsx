import React, { useState } from 'react';
import {
  Banner,
  Button,
  Card,
  CommandPalette,
  Dropzone,
  EmptyState,
  ErrorState,
  Field,
  FileList,
  FileRow,
  Icon,
  iconNames,
  Modal,
  ProgressBar,
  ResumeStrip,
  RunBar,
  Skeleton,
  StatusBadge,
  Tabs,
  Toast,
  ToastRegion,
  Toggle,
} from '../components/index.jsx';
import { brandAssets } from '../assets/registry';
import { navigationItems } from '../hubs/index';

function Section({ id, eyebrow, title, contract, wide = false, children }) {
  return (
    <section
      id={id}
      className={['gallery-section', wide ? 'gallery-section--wide' : ''].filter(Boolean).join(' ')}
      aria-labelledby={`${id}-title`}
    >
      <header className="gallery-section__header">
        <div>
          <span>{eyebrow}</span>
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <code>{contract}</code>
      </header>
      {children}
    </section>
  );
}

function State({ label, className = '', children, ...props }) {
  return (
    <div {...props} className={['gallery-state', className].filter(Boolean).join(' ')}>
      <span className="gallery-state__label">{label}</span>
      {children}
    </div>
  );
}

function Vis({ component, variant = 'base', state, children }) {
  return (
    <State
      label={`${variant} · ${state}`}
      data-vis={`${component}/${variant}/${state}`}
    >
      {children}
    </State>
  );
}

const tabItems = [
  { id: 'source', label: 'Source', panel: <p>Source controls</p> },
  { id: 'output', label: 'Output', badge: '3', panel: <p>Output controls</p> },
  { id: 'advanced', label: 'Advanced', panel: <p>Advanced controls</p> },
];

const uploadSessions = [{
  id: 'upload-gallery',
  originalName: 'campaign-master.mov',
  receivedBytes: 58720256,
  size: 125829120,
  href: '#/media?mode=video',
}];

const activeJobs = [{
  id: 'job-gallery',
  label: 'Quarterly document batch',
  status: 'running',
  progress: 58,
  href: '#/convert?mode=documents',
}];

const captureTabs = [
  { id: 'first', label: 'First', panel: <p>First panel</p> },
  { id: 'second', label: 'Second', panel: <p>Second panel</p> },
  { id: 'disabled', label: 'Disabled', disabled: true, panel: <p>Disabled panel</p> },
];

function fieldCaptureProps(variant) {
  if (variant === 'select') {
    return {
      defaultValue: 'first',
      options: [
        { value: 'first', label: 'First choice' },
        { value: 'second', label: 'Second choice' },
      ],
    };
  }
  if (variant === 'textarea') return { defaultValue: 'A short note.' };
  if (variant === 'color') return { defaultValue: '#765fff' };
  if (variant === 'range') return { min: '0', max: '100', defaultValue: '62' };
  if (variant === 'checkbox') return { defaultChecked: true };
  return { defaultValue: 'Example value' };
}

/**
 * Deterministic production-component instances consumed by visual/capture.
 * Interaction states reuse each component's default instance and are driven
 * by Playwright, so only instance states are rendered here.
 */
function VisualCaptureMatrix() {
  const buttonVariants = ['primary', 'secondary', 'ghost', 'danger', 'icon'];
  const tabVariants = ['underline', 'segmented'];
  const fieldVariants = ['text', 'select', 'textarea', 'color', 'range', 'checkbox'];
  const dropzoneVariants = ['files', 'paste'];
  const badgeTones = ['neutral', 'live', 'success', 'warning', 'danger'];

  return (
    <section className="gallery-section gallery-section--wide" aria-label="Visual capture matrix">
      <header className="gallery-section__header">
        <div>
          <span>Automated visual contract</span>
          <h2>Deterministic capture instances</h2>
        </div>
        <code>visual/manifest.mjs</code>
      </header>
      <div className="gallery-state-grid gallery-state-grid--three">
        {buttonVariants.flatMap((variant) => [
          <Vis key={`button-${variant}-default`} component="button" variant={variant} state="default">
            <Button
              variant={variant}
              icon={variant === 'icon' ? 'plus' : undefined}
              aria-label={variant === 'icon' ? 'Add item' : undefined}
            >
              {variant === 'icon' ? null : 'Action'}
            </Button>
          </Vis>,
          <Vis key={`button-${variant}-loading`} component="button" variant={variant} state="loading">
            <Button variant={variant} busy>Working</Button>
          </Vis>,
          <Vis key={`button-${variant}-disabled`} component="button" variant={variant} state="disabled">
            <Button variant={variant} disabled>Unavailable</Button>
          </Vis>,
        ])}

        {tabVariants.flatMap((variant) => [
          <Vis key={`tabs-${variant}-default`} component="tabs" variant={variant} state="default">
            <Tabs variant={variant} aria-label={`${variant} default tabs`} items={captureTabs} />
          </Vis>,
          <Vis key={`tabs-${variant}-selected`} component="tabs" variant={variant} state="selected">
            <Tabs variant={variant} aria-label={`${variant} selected tabs`} items={captureTabs} value="second" />
          </Vis>,
          <Vis key={`tabs-${variant}-disabled`} component="tabs" variant={variant} state="disabled">
            <Tabs
              variant={variant}
              aria-label={`${variant} disabled tabs`}
              items={captureTabs.map((item) => ({ ...item, disabled: true }))}
            />
          </Vis>,
        ])}

        {fieldVariants.flatMap((variant) => [
          <Vis key={`field-${variant}-default`} component="field" variant={variant} state="default">
            <Field label={`${variant} field`} variant={variant} {...fieldCaptureProps(variant)} />
          </Vis>,
          <Vis key={`field-${variant}-error`} component="field" variant={variant} state="error">
            <Field
              label={`${variant} field`}
              variant={variant}
              error="Check this value."
              {...fieldCaptureProps(variant)}
            />
          </Vis>,
          <Vis key={`field-${variant}-disabled`} component="field" variant={variant} state="disabled">
            <Field label={`${variant} field`} variant={variant} disabled {...fieldCaptureProps(variant)} />
          </Vis>,
        ])}

        <Vis component="toggle" state="default"><Toggle label="Default toggle" /></Vis>
        <Vis component="toggle" state="selected"><Toggle label="Selected toggle" defaultChecked /></Vis>
        <Vis component="toggle" state="disabled"><Toggle label="Disabled toggle" disabled /></Vis>

        {dropzoneVariants.flatMap((variant) => [
          <Vis key={`dropzone-${variant}-default`} component="dropzone" variant={variant} state="default">
            <Dropzone variant={variant} empty={false} />
          </Vis>,
          <Vis key={`dropzone-${variant}-disabled`} component="dropzone" variant={variant} state="disabled">
            <Dropzone variant={variant} disabled />
          </Vis>,
          <Vis key={`dropzone-${variant}-empty`} component="dropzone" variant={variant} state="empty">
            <Dropzone variant={variant} />
          </Vis>,
        ])}

        <Vis component="filerow" state="default"><FileRow name="source-file.pdf" size={2122318} tabIndex={0} /></Vis>
        <Vis component="filerow" state="selected"><FileRow name="selected-file.pdf" size={6738142} selected /></Vis>
        <Vis component="filerow" state="loading">
          <FileRow name="uploading-file.mov" size={125829120} status="uploading" progress={47} />
        </Vis>
        <Vis component="filerow" state="error">
          <FileRow name="damaged-file.pdf" status="failed" meta="Source could not be decoded" />
        </Vis>
        <Vis component="filerow" state="disabled"><FileRow name="managed-file.pdf" size={718221} disabled /></Vis>
        <Vis component="filelist" state="empty"><FileList items={[]} /></Vis>

        <Vis component="progressbar" variant="determinate" state="loading">
          <ProgressBar value={42} label="Determinate progress" />
        </Vis>
        <Vis component="progressbar" variant="indeterminate" state="loading">
          <ProgressBar variant="indeterminate" label="Indeterminate progress" />
        </Vis>

        {badgeTones.map((tone) => (
          <Vis key={`badge-${tone}`} component="statusbadge" variant={tone} state="default">
            <StatusBadge tone={tone}>{tone}</StatusBadge>
          </Vis>
        ))}

        <Vis component="emptystate" variant="default" state="empty">
          <EmptyState title="No files yet" description="Add a source file to begin." />
        </Vis>
        <Vis component="emptystate" variant="compact" state="empty">
          <EmptyState variant="compact" title="No matches" description="Clear the current filters." />
        </Vis>
        <Vis component="errorstate" state="error">
          <ErrorState title="Conversion failed" message="The source could not be decoded." actionLabel="Retry" onAction={() => {}} />
        </Vis>

        <Vis component="banner" variant="neutral" state="default">
          <Banner title="Local processing">Files remain in your local workspace.</Banner>
        </Vis>
        <Vis component="banner" variant="warning" state="default">
          <Banner tone="warning" title="Large batch">Keep this tab open while uploading.</Banner>
        </Vis>

        <Vis component="card" variant="panel" state="default">
          <Card title="Panel card">Primary grouped content.</Card>
        </Vis>
        <Vis component="card" variant="flat" state="default">
          <Card variant="flat" title="Flat card">Nested supporting content.</Card>
        </Vis>
        <Vis component="skeleton" variant="block" state="loading"><Skeleton /></Vis>
        <Vis component="skeleton" variant="row" state="loading"><Skeleton variant="row" lines={3} /></Vis>

        <Vis component="runbar" state="default">
          <RunBar status="2 files ready" primaryAction={<Button variant="primary">Convert</Button>} />
        </Vis>
        <Vis component="runbar" state="loading">
          <RunBar busy status="Converting files" progress={54} primaryAction={<Button busy>Converting</Button>} />
        </Vis>
        <Vis component="runbar" state="disabled">
          <RunBar disabled status="Add a file" primaryAction={<Button disabled>Convert</Button>} />
        </Vis>

        <Vis component="resumestrip" variant="full" state="default">
          <ResumeStrip uploadSessions={uploadSessions} jobs={activeJobs} onResume={() => {}} onDiscard={() => {}} />
        </Vis>
        <Vis component="resumestrip" variant="full" state="empty"><ResumeStrip /></Vis>
        <Vis component="resumestrip" variant="uploads-only" state="default">
          <ResumeStrip variant="uploads-only" uploadSessions={uploadSessions} onResume={() => {}} onDiscard={() => {}} />
        </Vis>
        <Vis component="resumestrip" variant="uploads-only" state="empty"><ResumeStrip variant="uploads-only" /></Vis>
      </div>
    </section>
  );
}

export default function AssetGallery({ theme = 'dark' }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [toggleOn, setToggleOn] = useState(true);
  const [selectedTab, setSelectedTab] = useState('source');

  return (
    <div className="asset-gallery" data-vis-gallery>
      <header className="asset-gallery__intro">
        <div>
          <p className="view-eyebrow">D2 · live component reference</p>
          <h2>Every primitive, in every required state.</h2>
          <p>
            This development-only route renders the production components.
            Switch the shell theme to verify the complete matrix in dark and light.
          </p>
        </div>
        <div className="asset-gallery__meta">
          <StatusBadge tone="success">Matrix complete</StatusBadge>
          <span>{theme === 'dark' ? 'Dark theme' : 'Light theme'}</span>
        </div>
      </header>

      <nav className="asset-gallery__index" aria-label="Asset Gallery sections">
        {[
          ['buttons', 'Actions'],
          ['inputs', 'Inputs'],
          ['files', 'File flow'],
          ['feedback', 'Feedback'],
          ['surfaces', 'Surfaces'],
          ['workflow', 'Workflow'],
          ['icons', 'Icons'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start' })}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="asset-gallery__grid">
        <Section id="buttons" eyebrow="Button" title="Action hierarchy" contract="D · H · F · A · L · X" wide>
          <div className="gallery-state-grid gallery-state-grid--six">
            <State label="Default"><Button variant="primary" icon="wand">Run tool</Button></State>
            <State label="Hover" className="force-button-hover"><Button variant="secondary">Hover</Button></State>
            <State label="Focus" className="force-button-focus"><Button variant="ghost">Focus</Button></State>
            <State label="Active" className="force-button-active"><Button variant="primary">Active</Button></State>
            <State label="Loading"><Button variant="primary" busy>Running</Button></State>
            <State label="Disabled"><Button variant="primary" disabled>Unavailable</Button></State>
          </div>
        </Section>

        <Section id="tabs" eyebrow="Tabs" title="Underline and segmented" contract="D · H · F · S · X" wide>
          <div className="gallery-split">
            <State label="Underline / selected">
              <Tabs aria-label="Underline tab states" items={tabItems} defaultValue="output" />
            </State>
            <State label="Segmented / controlled">
              <Tabs
                aria-label="Segmented tab states"
                variant="segmented"
                items={[...tabItems, { id: 'locked', label: 'Locked', disabled: true }]}
                value={selectedTab}
                onChange={setSelectedTab}
              />
            </State>
            <State label="Hover" className="force-tab-hover">
              <Tabs aria-label="Hover tab state" items={tabItems} />
            </State>
            <State label="Focus" className="force-tab-focus">
              <Tabs aria-label="Focus tab state" variant="segmented" items={tabItems} />
            </State>
          </div>
        </Section>

        <Section id="inputs" eyebrow="Field · Toggle" title="Input states" contract="D · F · Er · S · X" wide>
          <div className="gallery-field-grid">
            <Field label="Project name" defaultValue="July campaign" hint="Used for the output folder." />
            <Field className="force-field-focus" label="Focused field" defaultValue="Keyboard ready" />
            <Field label="Invalid field" defaultValue="archive" error="Include a file extension." />
            <Field label="Disabled field" defaultValue="Managed setting" disabled />
            <Field
              label="Output format"
              variant="select"
              defaultValue="webp"
              options={[
                { value: 'webp', label: 'WebP' },
                { value: 'png', label: 'PNG' },
              ]}
            />
            <Field label="Notes" variant="textarea" defaultValue="Preserve source metadata." />
            <Field label="Accent preview" variant="color" defaultValue="#765fff" />
            <Field label="Quality" variant="range" min="0" max="100" defaultValue="82" />
            <Field label="Preserve metadata" variant="checkbox" defaultChecked />
            <div className="gallery-toggle-stack">
              <Toggle label="Default" description="A switch at rest." />
              <Toggle
                label="Selected"
                description="A controlled selected state."
                checked={toggleOn}
                onChange={setToggleOn}
              />
              <Toggle className="force-toggle-focus" label="Focused" />
              <Toggle label="Disabled" disabled />
            </div>
          </div>
        </Section>

        <Section id="dropzones" eyebrow="Dropzone" title="Acquisition states" contract="D · H · F · drag · X · E" wide>
          <div className="gallery-state-grid gallery-state-grid--three">
            <State label="Default / populated"><Dropzone empty={false} /></State>
            <State label="Empty"><Dropzone /></State>
            <State label="Hover" className="force-drop-hover"><Dropzone title="Ready for files" /></State>
            <State label="Focus" className="force-drop-focus"><Dropzone title="Keyboard ready" /></State>
            <State label="Drag-over" className="force-drop-drag"><Dropzone title="Release to add" /></State>
            <State label="Paste variant"><Dropzone variant="paste" /></State>
            <State label="Disabled"><Dropzone disabled /></State>
          </div>
        </Section>

        <Section id="files" eyebrow="FileRow · FileList" title="File lifecycle" contract="D · H · F · S · L · Er · X · empty" wide>
          <div className="gallery-state-grid gallery-state-grid--two">
            <State label="Default"><FileRow name="recording.wav" size={4831838} /></State>
            <State label="Hover" className="force-row-hover"><FileRow name="presentation.pdf" size={2122318} /></State>
            <State label="Focus" className="force-row-focus">
              <FileRow name="archive.zip" size={9017754} actions={<Button size="sm">Open</Button>} />
            </State>
            <State label="Selected"><FileRow name="brand-assets.zip" size={6738142} selected /></State>
            <State label="Loading">
              <FileRow name="interview.mov" size={125829120} status="uploading" progress={47} />
            </State>
            <State label="Error">
              <FileRow
                name="damaged-document.pdf"
                status="failed"
                meta="Source could not be decoded"
                actions={<Button size="sm">Remove</Button>}
              />
            </State>
            <State label="Disabled"><FileRow name="managed-file.pdf" size={718221} disabled /></State>
            <State label="List empty"><FileList items={[]} /></State>
          </div>
        </Section>

        <Section id="progress" eyebrow="ProgressBar" title="Progress semantics" contract="determinate · loading · reduced">
          <div className="gallery-stack">
            <State label="42%"><ProgressBar value={42} label="Upload progress" /></State>
            <State label="Indeterminate"><ProgressBar variant="indeterminate" label="Inspecting file" /></State>
            <State label="Reduced static"><ProgressBar variant="indeterminate" reduced label="Reduced progress" /></State>
            <State label="Complete"><ProgressBar value={100} label="Complete" /></State>
          </div>
        </Section>

        <Section id="badges" eyebrow="StatusBadge" title="Status tones" contract="neutral · live · success · warning · danger">
          <div className="gallery-badges">
            <StatusBadge tone="neutral">Waiting</StatusBadge>
            <StatusBadge tone="live">2 active jobs</StatusBadge>
            <StatusBadge tone="success">Completed</StatusBadge>
            <StatusBadge tone="warning">Needs review</StatusBadge>
            <StatusBadge tone="danger">Failed</StatusBadge>
          </div>
        </Section>

        <Section id="feedback" eyebrow="EmptyState · ErrorState" title="Recovery and absence" contract="default · compact · live · action" wide>
          <div className="gallery-split">
            <EmptyState
              visual={<Icon name="file" size={28} />}
              title="No files yet"
              description="Add a source file to begin."
              action={<Button size="sm" icon="plus">Add file</Button>}
            />
            <EmptyState
              variant="compact"
              live
              title="No matching jobs"
              description="Clear the filters to see all activity."
            />
            <ErrorState
              title="Conversion failed"
              message="The source appears truncated. Retry the same file."
              actionLabel="Retry conversion"
              onAction={() => {}}
            />
          </div>
        </Section>

        <Section id="banners" eyebrow="Banner" title="Inline guidance" contract="neutral · warning" wide>
          <div className="gallery-stack">
            <Banner
              title="Local processing"
              icon={<Icon name="lock" />}
              actions={<Button variant="ghost" size="sm">Learn more</Button>}
            >
              Files remain in your local workspace.
            </Banner>
            <Banner tone="warning" title="Large batch" icon={<Icon name="warning" />}>
              Keep this tab open while the upload completes.
            </Banner>
          </div>
        </Section>

        <Section id="surfaces" eyebrow="Card · Skeleton" title="Surface hierarchy" contract="panel · flat · interactive · block · row" wide>
          <div className="gallery-card-grid">
            <Card title="Panel card" subtitle="Raised workspace surface">Primary grouped content.</Card>
            <Card variant="flat" title="Flat card">Nested supporting content.</Card>
            <Card interactive aria-label="Open recent workflow">
              <strong>Interactive card</strong>
              <p>One native button target owns the entire surface.</p>
            </Card>
            <State label="Block skeleton"><Skeleton /></State>
            <State label="Row skeleton"><Skeleton variant="row" lines={3} /></State>
          </div>
        </Section>

        <Section id="overlays" eyebrow="Modal · CommandPalette · Toast" title="Overlay and notification states" contract="D · E · S · enter · exit · live" wide>
          <div className="gallery-overlay-launchers">
            <Button
              variant="secondary"
              data-vis-trigger="modal/dialog/default"
              onClick={() => setDialogOpen(true)}
            >
              Open dialog
            </Button>
            <Button
              variant="secondary"
              icon="search"
              data-vis-trigger="modal/palette/default"
              data-vis-command-default="true"
              data-vis-command-selected="true"
              onClick={() => {
                setPaletteQuery('');
                setPaletteOpen(true);
              }}
            >
              Open selected palette
            </Button>
            <Button
              variant="ghost"
              data-vis-command-empty="true"
              onClick={() => {
                setPaletteQuery('missing workflow');
                setPaletteOpen(true);
              }}
            >
              Open empty palette
            </Button>
          </div>
          <div className="gallery-split">
            <State label="Dialog default"><div className="gallery-overlay-diagram"><Icon name="layers" /><span>Named dialog + close + actions</span></div></State>
            <State label="Palette empty"><div className="gallery-overlay-diagram"><Icon name="search" /><span>No matches → compact empty state</span></div></State>
            <State label="Palette selected"><div className="gallery-overlay-diagram"><Icon name="check" /><span>Roving selected result</span></div></State>
          </div>
          <ToastRegion className="gallery-toast-proof" aria-label="Gallery notification live region">
            <Toast data-vis="toast/notice/default" tone="notice" autoDismiss={false}>Preferences saved on this device.</Toast>
            <Toast data-vis="toast/success/default" tone="success" autoDismiss={false}>3 outputs are ready to download.</Toast>
            <Toast data-vis="toast/danger/default" tone="danger" autoDismiss={false}>Could not copy the link.</Toast>
            <Toast tone="notice" autoDismiss={false} className="toast--exit">Exit motion proof.</Toast>
          </ToastRegion>
        </Section>

        <VisualCaptureMatrix />

        <Section id="workflow" eyebrow="RunBar · ResumeStrip" title="Workflow continuity" contract="D · L · X · full · uploads-only · E" wide>
          <div className="gallery-stack gallery-runbars">
            <RunBar status="2 files ready" primaryAction={<Button variant="primary">Convert files</Button>} />
            <RunBar
              busy
              status="Converting 2 of 4 files"
              progress={54}
              secondaryAction={<Button>Cancel</Button>}
              primaryAction={<Button variant="primary" busy>Converting</Button>}
            />
            <RunBar
              disabled
              status="Add a supported file to continue"
              primaryAction={<Button variant="primary" disabled>Convert files</Button>}
            />
            <ResumeStrip
              uploadSessions={uploadSessions}
              jobs={activeJobs}
              onResume={() => {}}
              onDiscard={() => {}}
            />
            <ResumeStrip
              variant="uploads-only"
              uploadSessions={uploadSessions}
              onResume={() => {}}
              onDiscard={() => {}}
            />
            <ResumeStrip />
          </div>
        </Section>

        <Section id="chrome" eyebrow="Sidebar · Topbar" title="Shell chrome states" contract="D · H · F · S · mobile trap" wide>
          <div className="gallery-chrome-proof">
            <img
              src={theme === 'light' ? brandAssets.horizontalLight : brandAssets.horizontal}
              alt="AlphaStudio contrast-safe brand lockup"
            />
            <div>
              <StatusBadge tone="live">2 active jobs</StatusBadge>
              <span>Current route, mobile drawer focus trap, theme-aware brand.</span>
            </div>
          </div>
        </Section>

        <Section id="icons" eyebrow="Icon" title="Registry and fallback" contract="registry · decorative · meaningful · fallback" wide>
          <div className="gallery-icon-grid">
            {iconNames.map((name) => (
              <div key={name}>
                <Icon name={name} />
                <code>{name}</code>
              </div>
            ))}
            <div>
              <Icon name="not-in-registry" label="Unknown icon fallback" />
              <code>fallback</code>
            </div>
          </div>
        </Section>
      </div>

      <Modal
        open={dialogOpen}
        title="Export settings"
        description="Choose how this local batch should be packaged."
        onClose={() => setDialogOpen(false)}
        actions={(
          <>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDialogOpen(false)}>Export 3 files</Button>
          </>
        )}
      >
        <div className="gallery-stack">
          <Field label="Archive name" defaultValue="deliverables.zip" />
          <Field
            label="Compression"
            variant="select"
            defaultValue="balanced"
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'balanced', label: 'Balanced' },
            ]}
          />
        </div>
      </Modal>
      <CommandPalette
        open={paletteOpen}
        navigation={navigationItems}
        initialQuery={paletteQuery}
        onClose={() => setPaletteOpen(false)}
        onNavigate={() => setPaletteOpen(false)}
      />
    </div>
  );
}
