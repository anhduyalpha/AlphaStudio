import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/primitives.css';
import '../styles/views.css';
import '../styles/workbench.css';
import {
  Card,
  CommandPalette,
  Icon,
  Sidebar,
  Skeleton,
  StatusBadge,
  Tabs,
  Topbar,
} from './components/index.jsx';
import { navigationItems, resolveHashRoute } from '../hubs/index';
import {
  getSnapshot,
  isTerminalStatus,
  selectActiveJobs,
  subscribe,
} from '../protocol/store';
import Workbench from '../workbench/Workbench.jsx';

const AssetGallery = import.meta.env.DEV
  ? lazy(() => import('./views/AssetGallery.jsx'))
  : null;

function readRoute() {
  return resolveHashRoute(window.location.hash, {
    includeAssets: import.meta.env.DEV,
  });
}

function replaceHash(href) {
  const nextUrl = `${window.location.pathname}${window.location.search}${href}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function readTheme() {
  try {
    return localStorage.getItem('alpha-studio-theme')
      || document.documentElement.dataset.theme
      || 'dark';
  } catch {
    return document.documentElement.dataset.theme || 'dark';
  }
}

function writeTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('alpha-studio-theme', theme);
  } catch {
    // The root attribute remains authoritative when storage is unavailable.
  }
}

function currentNavigationHref(resolved) {
  return resolved.route.kind === 'hub'
    ? `#/${resolved.route.id}`
    : resolved.href;
}

function RoutePlaceholder({ resolved }) {
  const { route, mode } = resolved;
  const modeItems = route.kind === 'hub'
    ? route.hub.modes.map((item) => ({
        id: item.id,
        label: item.name,
        panel: (
          <div className="route-placeholder__panel">
            <Icon name={route.hub.icon} size={28} />
            <div>
              <strong>{item.name}</strong>
              <p>The workflow surface arrives in its dedicated implementation unit.</p>
            </div>
          </div>
        ),
      }))
    : [];

  return (
    <div className="route-placeholder">
      <section className="route-placeholder__intro">
        <div>
          <p className="view-eyebrow">Unified local workspace</p>
          <h2>{route.kind === 'hub' ? `${route.name}, ready for focused work.` : 'A calm surface for every local workflow.'}</h2>
          <p>
            {route.kind === 'hub'
              ? `Choose a ${route.name} mode without leaving the shared workspace.`
              : 'Files, jobs, and outputs stay private and available across AlphaStudio.'}
          </p>
        </div>
        <StatusBadge tone="neutral">Rebuild preview</StatusBadge>
      </section>
      {route.kind === 'hub' ? (
        <Card
          title={`${route.name} modes`}
          subtitle={`${route.hub.modes.length} focused workflows`}
        >
          <Tabs
            aria-label={`${route.name} modes`}
            variant="segmented"
            value={mode?.id}
            items={modeItems}
            onChange={(modeId) => {
              window.location.hash = `/${route.id}?mode=${encodeURIComponent(modeId)}`;
            }}
          />
        </Card>
      ) : (
        <div className="route-placeholder__cards">
          <Card title="Workspace continuity" subtitle="One source of truth">
            Follow live uploads and jobs without duplicate progress or stale state.
          </Card>
          <Card title="Keyboard first" subtitle="Press Ctrl K">
            Search every studio and mode from a single command surface.
          </Card>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [resolved, setResolved] = useState(readRoute);
  const [theme, setTheme] = useState(readTheme);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef(null);
  const previousJobsRef = useRef(new Map());
  const previousRouteRef = useRef(resolved.href);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const activeJobs = selectActiveJobs(snapshot);

  const syncRoute = useCallback(() => {
    const next = readRoute();
    if (window.location.hash !== next.href) replaceHash(next.href);
    setResolved(next);
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, [syncRoute]);

  useEffect(() => {
    if (previousRouteRef.current !== resolved.href) headingRef.current?.focus();
    previousRouteRef.current = resolved.href;
  }, [resolved.href]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const previous = previousJobsRef.current;
    for (const job of snapshot.jobs) {
      const oldStatus = previous.get(job.id);
      if (
        oldStatus
        && !isTerminalStatus(oldStatus)
        && (job.status === 'completed' || job.status === 'failed')
      ) {
        const name = job.outputName || job.type || 'Job';
        setAnnouncement(`${name} ${job.status}.`);
      }
    }
    previousJobsRef.current = new Map(snapshot.jobs.map((job) => [job.id, job.status]));
  }, [snapshot.jobs]);

  const navigate = useCallback((href) => {
    setPaletteOpen(false);
    if (window.location.hash === href) {
      syncRoute();
    } else {
      window.location.hash = href.slice(1);
    }
  }, [syncRoute]);

  const { route, mode } = resolved;
  const subtitle = route.kind === 'hub'
    ? (mode?.name || 'Studio')
    : route.id === 'assets' ? 'Development reference' : 'Local utility studio';

  return (
    <div className="studio-shell">
      <div className="studio-shell__main">
        <Topbar
          ref={headingRef}
          title={route.name}
          subtitle={subtitle}
          theme={theme}
          menuExpanded={mobileOpen}
          onMenuOpen={() => setMobileOpen(true)}
          onCommandOpen={() => setPaletteOpen(true)}
          onThemeToggle={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            setTheme(next);
            writeTheme(next);
          }}
          apiStatus={snapshot.status === 'error'
            ? { tone: 'danger', label: 'Workspace unavailable' }
            : snapshot.status === 'ready'
              ? { tone: 'success', label: 'Workspace ready' }
              : undefined}
        />
        <main id="main-content" className="studio-shell__content" tabIndex={-1}>
          {route.id === 'assets' && AssetGallery ? (
            <Suspense fallback={<Skeleton variant="row" lines={6} label="Loading Asset Gallery" />}>
              <AssetGallery theme={theme} />
            </Suspense>
          ) : route.kind === 'hub' ? (
            <Workbench
              hub={route.hub}
              mode={mode}
              onModeChange={(modeId) => navigate(`#/${route.id}?mode=${encodeURIComponent(modeId)}`)}
            />
          ) : (
            <RoutePlaceholder resolved={resolved} />
          )}
        </main>
      </div>
      <Sidebar
        navigation={navigationItems}
        currentHref={currentNavigationHref(resolved)}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        activeJobCount={activeJobs.length}
        theme={theme}
        footer={(
          <span className="studio-shell__privacy">
            <Icon name="lock" size={16} />
            Private · local workspace
          </span>
        )}
      />
      <CommandPalette
        open={paletteOpen}
        navigation={navigationItems}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
      />
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-global-announcer
      >
        {announcement}
      </div>
    </div>
  );
}
