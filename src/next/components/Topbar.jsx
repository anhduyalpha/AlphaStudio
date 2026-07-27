import React, { forwardRef } from 'react';
import Button from './Button';
import Icon from './Icon';
import StatusBadge from './StatusBadge';

export function focusSkipTarget(event, targetId = 'main-content') {
  event.preventDefault();
  document.getElementById(targetId)?.focus();
}

const Topbar = forwardRef(function Topbar({
  title,
  subtitle,
  theme = 'dark',
  onThemeToggle,
  onMenuOpen,
  onCommandOpen,
  menuExpanded = false,
  apiStatus,
  profileHref = '#/profile',
  skipTargetId = 'main-content',
  className = '',
}, headingRef) {
  return (
    <>
      <a
        className="skip-link"
        href={`#${skipTargetId}`}
        onClick={(event) => focusSkipTarget(event, skipTargetId)}
      >
        Skip to content
      </a>
      <header className={['topbar', className].filter(Boolean).join(' ')}>
        <div className="topbar__identity">
          <Button
            className="topbar__menu"
            variant="icon"
            aria-label="Open navigation"
            aria-expanded={menuExpanded}
            aria-controls="studio-sidebar"
            onClick={onMenuOpen}
          >
            <Icon name="menu" />
          </Button>
          <div>
            {subtitle ? <p>{subtitle}</p> : null}
            <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
          </div>
        </div>
        <div className="topbar__actions">
          <Button
            className="topbar__search"
            variant="secondary"
            icon="search"
            aria-label="Search tools and modes"
            onClick={onCommandOpen}
          >
            <span>Search tools</span>
            <kbd>Ctrl K</kbd>
          </Button>
          {apiStatus ? (
            <StatusBadge tone={apiStatus.tone || 'neutral'}>{apiStatus.label}</StatusBadge>
          ) : null}
          <Button
            variant="icon"
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            onClick={onThemeToggle}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </Button>
          <a className="topbar__profile" href={profileHref} aria-label="Open profile">
            <Icon name="profile" />
          </a>
        </div>
      </header>
    </>
  );
});

export default Topbar;
