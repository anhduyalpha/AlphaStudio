import React, { useCallback, useEffect, useState } from 'react';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/primitives.css';
import { Card, StatusBadge } from './components/index.jsx';
import { navigationItems, resolveHashRoute } from '../hubs/index';

function readRoute() {
  return resolveHashRoute(window.location.hash, {
    includeAssets: import.meta.env.DEV,
  });
}

function replaceHash(href) {
  const nextUrl = `${window.location.pathname}${window.location.search}${href}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

export default function App() {
  const [resolved, setResolved] = useState(readRoute);

  const syncRoute = useCallback(() => {
    const next = readRoute();
    if (window.location.hash !== next.href) replaceHash(next.href);
    setResolved(next);
  }, []);

  useEffect(() => {
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, [syncRoute]);

  const { route, mode } = resolved;

  return (
    <div>
      <nav aria-label="AlphaStudio routes">
        {navigationItems.map((item) => (
          <a
            key={item.id}
            href={item.href}
            aria-current={route.id === item.id ? 'page' : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <main id="main-content">
        <Card>
          <StatusBadge tone="neutral">Rebuild shell</StatusBadge>
          <h1>{route.name}</h1>
          {route.kind === 'hub' ? (
            <>
              <p>{mode ? `${mode.name} mode` : 'No configured mode'}</p>
              <nav aria-label={`${route.name} modes`}>
                {route.hub.modes.map((item) => (
                  <a
                    key={item.id}
                    href={`#/${route.hub.id}?mode=${encodeURIComponent(item.id)}`}
                    aria-current={mode?.id === item.id ? 'page' : undefined}
                  >
                    {item.name}
                  </a>
                ))}
              </nav>
            </>
          ) : (
            <p>This route is ready for its view unit.</p>
          )}
        </Card>
      </main>
    </div>
  );
}
