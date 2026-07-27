import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import '../src/styles/primitives.css';
import {
  Button,
  Card,
  CommandPalette,
  Field,
  Modal,
  Sidebar,
  StatusBadge,
  Topbar,
} from '../src/next/components/index.jsx';
import './unit-11-gallery.css';

const query = new URLSearchParams(window.location.search);
const view = query.get('view') || 'chrome';
document.documentElement.dataset.theme = query.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.motion = query.get('motion') === 'reduced' ? 'reduced' : 'full';

const navigation = [
  { id: 'home', label: 'Home', icon: 'dashboard', href: '#/', group: 'Workspace' },
  { id: 'convert', label: 'Convert', icon: 'converter', href: '#/convert', group: 'Studios', modes: [
    { id: 'documents', name: 'Documents' },
    { id: 'images', name: 'Images' },
  ] },
  { id: 'pdf', label: 'PDF Studio', icon: 'pdf', href: '#/pdf', group: 'Studios', modes: [
    { id: 'organize', name: 'Organize' },
    { id: 'export', name: 'Export' },
  ] },
  { id: 'media', label: 'Media Studio', icon: 'media', href: '#/media', group: 'Studios', modes: [
    { id: 'video', name: 'Video' },
    { id: 'audio', name: 'Audio' },
    { id: 'image', name: 'Image' },
  ] },
  { id: 'security', label: 'Security', icon: 'security', href: '#/security', group: 'Studios', modes: [
    { id: 'archive', name: 'Archive' },
  ] },
  { id: 'activity', label: 'Activity', icon: 'activity', href: '#/activity', group: 'Account' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings', group: 'Account' },
  { id: 'profile', label: 'Profile', icon: 'profile', href: '#/profile', group: 'Account' },
];

function Shell({ mobileOpen = false }) {
  const headingRef = useRef(null);
  return (
    <div className="chrome-proof">
      <div className="chrome-proof__main">
        <Topbar
          ref={headingRef}
          title="Media Studio"
          subtitle="Audio workflows"
          theme={document.documentElement.dataset.theme}
          menuExpanded={mobileOpen}
          onMenuOpen={() => {}}
          onCommandOpen={() => {}}
          onThemeToggle={() => {}}
          apiStatus={{ tone: 'success', label: 'API online' }}
        />
        <main id="main-content" className="chrome-proof__content">
          <section className="chrome-proof__hero">
            <div>
              <p>Unified workspace</p>
              <h2>Everything in reach, nothing in the way.</h2>
            </div>
            <StatusBadge tone="live">3 active jobs</StatusBadge>
          </section>
          <div className="chrome-proof__cards">
            <Card title="Recent workflow" subtitle="Audio normalization">
              Continue a local batch without leaving the current workspace.
            </Card>
            <Card title="Keyboard first" subtitle="Press Ctrl K">
              Search every studio and mode from one command surface.
            </Card>
          </div>
        </main>
      </div>
      <Sidebar
        navigation={navigation}
        currentHref="#/media"
        mobileOpen={mobileOpen}
        onClose={() => {}}
        activeJobCount={3}
        footer={<span>Private · Local workspace</span>}
      />
    </div>
  );
}

function DialogProof() {
  const initialRef = useRef(null);
  const [open, setOpen] = useState(true);
  return (
    <>
      <Shell />
      {!open ? <Button className="proof-reopen" onClick={() => setOpen(true)}>Open dialog</Button> : null}
      <Modal
        open={open}
        title="Export settings"
        description="Choose how this local batch should be packaged."
        onClose={() => setOpen(false)}
        initialFocusRef={initialRef}
        actions={(
          <>
            <Button>Cancel</Button>
            <Button ref={initialRef} variant="primary">Export 3 files</Button>
          </>
        )}
      >
        <div className="modal-proof__fields">
          <Field label="Archive name" defaultValue="audio-deliverables.zip" />
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
    </>
  );
}

function PaletteProof({ empty = false }) {
  const [open, setOpen] = useState(true);
  const [lastNavigation, setLastNavigation] = useState('');
  return (
    <>
      <Shell />
      {lastNavigation ? <p className="palette-proof__result">Navigated to {lastNavigation}</p> : null}
      <CommandPalette
        open={open}
        navigation={navigation}
        initialQuery={empty ? 'missing workflow' : ''}
        onClose={() => setOpen(false)}
        onNavigate={(href) => setLastNavigation(href)}
      />
    </>
  );
}

const content = view === 'modal'
  ? <DialogProof />
  : view === 'palette'
    ? <PaletteProof />
    : view === 'empty'
      ? <PaletteProof empty />
      : <Shell mobileOpen={view === 'mobile'} />;

createRoot(document.getElementById('root')).render(content);
