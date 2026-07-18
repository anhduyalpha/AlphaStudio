import React from 'react';
import Icon from './Icon';

export default function Topbar({ title, subtitle, theme, onThemeToggle, onMenuOpen, onCommandOpen }) {
  return (
    <header className="app-topbar">
      <div className="topbar-title-group">
        <button className="icon-button menu-button" type="button" onClick={onMenuOpen} aria-label="Open navigation">
          <Icon name="menu" />
        </button>
        <div>
          <p>{subtitle}</p>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="topbar-controls">
        <button className="command-search" type="button" onClick={onCommandOpen}>
          <Icon name="search" size={18} />
          <span>Search tools</span>
          <kbd>Ctrl K</kbd>
        </button>
        <span className="front-end-pill">Local API</span>
        <button className="icon-button" type="button" aria-label="Toggle color theme" onClick={onThemeToggle}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <a className="avatar-button" href="#/profile" aria-label="Open AlphaD profile"><img src="/avatars/alphad-profile.svg" alt="" width="40" height="40" /></a>
      </div>
    </header>
  );
}
