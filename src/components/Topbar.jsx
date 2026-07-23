import React from 'react';
import Icon from './Icon';

export default function Topbar({
  title,
  subtitle,
  theme,
  onThemeToggle,
  onMenuOpen,
  onCommandOpen,
  apiOnline = null,
}) {
  const healthText = apiOnline === true ? 'API online' : apiOnline === false ? 'API offline' : 'Local API';
  const healthTone = apiOnline === true ? 'is-online' : apiOnline === false ? 'is-offline' : '';

  return (
    <header className="app-topbar studio-topbar" data-testid="studio-topbar">
      <div className="topbar-title-group">
        <button className="icon-button menu-button liquid-press" type="button" onClick={onMenuOpen} aria-label="Open navigation">
          <Icon name="menu" />
        </button>
        <div>
          <p className="topbar-context">{subtitle}</p>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="topbar-controls">
        <button className="command-search liquid-press" type="button" onClick={onCommandOpen}>
          <Icon name="search" size={18} />
          <span>Search tools</span>
          <kbd>Ctrl K</kbd>
        </button>
        <span className={`front-end-pill ${healthTone}`.trim()} title={healthText}>
          <span className="status-dot" aria-hidden="true" />
          {healthText}
        </span>
        <button className="icon-button liquid-press" type="button" aria-label="Toggle color theme" onClick={onThemeToggle}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <a className="avatar-button" href="#/profile" aria-label="Open AlphaD profile">
          <img src="/avatars/alphad-profile.svg" alt="" width="40" height="40" />
        </a>
      </div>
    </header>
  );
}
