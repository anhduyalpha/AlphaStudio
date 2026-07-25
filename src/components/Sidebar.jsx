import React from 'react';
import Icon from './Icon';
import { BrandMark } from './Brand';

function Sidebar({ navigation, route, onNavigate, mobileOpen, onClose, apiOnline = null }) {
  const groups = [...new Set(navigation.map((item) => item.group))];
  const healthLabel = apiOnline === true ? 'Local API connected' : apiOnline === false ? 'Local API offline' : 'Local workspace';
  const healthDetail = apiOnline === true ? 'Health check OK' : apiOnline === false ? 'Start server to process files' : 'Private · localhost';

  return (
    <>
      <button
        className={`sidebar-scrim ${mobileOpen ? 'visible' : ''}`}
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
      />
      <aside className={`sidebar studio-rail ${mobileOpen ? 'mobile-open' : ''}`} data-testid="studio-rail">
        <div className="brand-row">
          <div className="brand-symbol"><BrandMark size={40} /></div>
          <div>
            <strong>AlphaStudio</strong>
            <span>Local utility suite</span>
          </div>
          <button className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="Close navigation">
            <Icon name="close" />
          </button>
        </div>

        <div className={`local-status${apiOnline === false ? ' is-offline' : ''}${apiOnline === true ? ' is-online' : ''}`}>
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>{healthLabel}</strong>
            <span>{healthDetail}</span>
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
                    aria-current={route === item.id ? 'page' : undefined}
                    onClick={() => onNavigate(item.id)}
                  >
                    <Icon name={item.icon} size={18} />
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
            <span>Private · Localhost</span>
          </div>
        </div>
      </aside>
    </>
  );
}

export default React.memo(Sidebar);
