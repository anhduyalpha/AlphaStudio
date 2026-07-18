import React from 'react';
import Icon from './Icon';
import { BrandMark } from './Brand';

function Sidebar({ navigation, route, onNavigate, mobileOpen, onClose }) {
  const groups = [...new Set(navigation.map((item) => item.group))];

  return (
    <>
      <button
        className={`sidebar-scrim ${mobileOpen ? 'visible' : ''}`}
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
      />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-symbol"><BrandMark size={42} /></div>
          <div>
            <strong>AlphaStudio</strong>
            <span>Local utility suite</span>
          </div>
          <button className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="Close navigation">
            <Icon name="close" />
          </button>
        </div>

        <div className="local-status">
          <span className="status-dot" />
          <div>
            <strong>Local workspace</strong>
            <span>Local API connected</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Studio navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <p>{group}</p>
              {navigation
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`sidebar-link ${route === item.id ? 'active' : ''}`}
                    onClick={() => onNavigate(item.id)}
                  >
                    <Icon name={item.icon} size={19} />
                    <span>{item.label}</span>
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer-card">
          <div className="mini-alpha"><img src="/avatars/alphad-profile.svg" alt="" width="38" height="38" /></div>
          <div>
            <strong>AlphaD Workspace</strong>
            <span>Private • Localhost</span>
          </div>
        </div>
      </aside>
    </>
  );
}

// Props are stable (navigation is module-level; handlers are useCallback-wrapped),
// so memo skips re-rendering the full nav list on unrelated shell state changes
// like toasts appearing/clearing.
export default React.memo(Sidebar);
