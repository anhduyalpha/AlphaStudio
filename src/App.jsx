import React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import CommandPalette from './components/CommandPalette';
import DashboardView from './views/DashboardView';
import ConverterView from './views/ConverterView';
import PdfView from './views/PdfView';
import QrView from './views/QrView';
import ImageView from './views/ImageView';
import MediaView from './views/MediaView';
import DeveloperView from './views/DeveloperView';
import ActivityView from './views/ActivityView';
import SettingsView from './views/SettingsView';
import ArchiveView from './views/ArchiveView';
import TextView from './views/TextView';
import AudioView from './views/AudioView';
import ColorView from './views/ColorView';
import SecurityView from './views/SecurityView';
import ProfileView from './views/ProfileView';
import { navigation } from './data/tools';
import useMotionPreference from './hooks/useMotionPreference';

const AssetGalleryView = import.meta.env.DEV
  ? React.lazy(() => import('./views/AssetGalleryView'))
  : null;

const viewMap = {
  dashboard: DashboardView,
  converter: ConverterView,
  pdf: PdfView,
  qr: QrView,
  image: ImageView,
  media: MediaView,
  archive: ArchiveView,
  text: TextView,
  audio: AudioView,
  color: ColorView,
  security: SecurityView,
  developer: DeveloperView,
  activity: ActivityView,
  profile: ProfileView,
  settings: SettingsView,
  ...(import.meta.env.DEV ? { assets: AssetGalleryView } : {}),
};

function getRoute() {
  const value = window.location.hash.replace('#/', '').replace('#', '');
  return viewMap[value] ? value : 'dashboard';
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [theme, setTheme] = useState(() => localStorage.getItem('alpha-studio-theme') || document.documentElement.dataset.theme || 'dark');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [toast, setToast] = useState('');
  const mainRef = React.useRef(null);
  // Resolves + applies html[data-motion]; the inline bootstrap already set it
  // pre-paint, this keeps it in sync with runtime preference changes.
  useMotionPreference();

  useEffect(() => {
    const handleHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('alpha-studio-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onThemeEvent = (event) => {
      const next = event?.detail;
      if (next === 'dark' || next === 'light') setTheme(next);
    };
    window.addEventListener('alpha-studio-theme', onThemeEvent);
    return () => window.removeEventListener('alpha-studio-theme', onThemeEvent);
  }, []);

  useEffect(() => {
    const handleKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        // Palette and drawer own their Escape handlers when open; keep a
        // shell-level fallback so Ctrl+K open always has a close path.
        if (commandOpen) {
          setCommandOpen(false);
          return;
        }
        if (mobileOpen) setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [commandOpen, mobileOpen]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const current = useMemo(
    () => route === 'assets'
      ? { label: 'Asset Gallery', group: 'Development' }
      : navigation.find((item) => item.id === route) || navigation[0],
    [route],
  );
  const ActiveView = viewMap[route] || DashboardView;

  useEffect(() => {
    document.title = `${current.label} · AlphaStudio`;
  }, [current.label]);

  // Stable handlers so the memoized Sidebar doesn't rerender when unrelated
  // shell state changes (e.g. a toast appearing/clearing every few seconds).
  const navigate = useCallback((nextRoute) => {
    window.location.hash = `/${nextRoute}`;
    setRoute(nextRoute);
    setMobileOpen(false);
    // Instant scroll — a smooth scroll would run concurrently with the route
    // entrance animation and cause a paint spike / jank.
    window.scrollTo({ top: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);
  const openCommand = useCallback(() => setCommandOpen(true), []);
  const closeCommand = useCallback(() => setCommandOpen(false), []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return (
    <div className="desktop-app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="ambient-light ambient-one" aria-hidden="true" />
      <div className="ambient-light ambient-two" aria-hidden="true" />
      <Sidebar navigation={navigation} route={route} onNavigate={navigate} mobileOpen={mobileOpen} onClose={closeMobile} />
      <div className="main-app-column" inert={mobileOpen ? true : undefined} aria-hidden={mobileOpen || undefined}>
        <Topbar
          title={current.label}
          subtitle={current.group}
          theme={theme}
          onThemeToggle={toggleTheme}
          onMenuOpen={openMobile}
          onCommandOpen={openCommand}
          menuExpanded={mobileOpen}
        />
        <main id="main-content" className="app-content" key={route} ref={mainRef} tabIndex={-1}>
          <React.Suspense fallback={<div className="surface-card content-card" role="status">Loading workspace…</div>}>
            <ActiveView onNavigate={navigate} notify={setToast} />
          </React.Suspense>
        </main>
        <footer className="app-footer">
          <span>AlphaStudio • Local API workspace</span>
          {import.meta.env.DEV ? <button type="button" className="text-button" onClick={() => navigate('assets')}>Asset gallery</button> : null}
          <span>React + Vite + Fastify</span>
        </footer>
      </div>
      <CommandPalette open={commandOpen} navigation={navigation} onClose={closeCommand} onNavigate={navigate} />
      {toast ? <div className="toast-message" role="status">{toast}</div> : null}
    </div>
  );
}
