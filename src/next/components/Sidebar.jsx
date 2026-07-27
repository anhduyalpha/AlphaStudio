import React, { useMemo, useRef } from 'react';
import useFocusTrap from '../../hooks/useFocusTrap';
import { brandAssets } from '../../assets/registry';
import Button from './Button';
import Icon from './Icon';
import StatusBadge from './StatusBadge';

export default function Sidebar({
  navigation = [],
  currentHref,
  onNavigate,
  mobileOpen = false,
  onClose,
  activeJobCount = 0,
  footer,
  theme = 'dark',
  className = '',
}) {
  const drawerRef = useRef(null);
  const closeRef = useRef(null);
  const groups = useMemo(
    () => [...new Set(navigation.map((item) => item.group || 'Navigation'))],
    [navigation],
  );

  useFocusTrap({
    active: mobileOpen,
    containerRef: drawerRef,
    initialFocusRef: closeRef,
    onEscape: onClose,
  });

  return (
    <>
      {mobileOpen ? (
        <button
          className="sidebar__scrim"
          type="button"
          tabIndex={-1}
          aria-label="Close navigation"
          onClick={onClose}
        />
      ) : null}
      <aside
        id="studio-sidebar"
        ref={drawerRef}
        className={[
          'sidebar',
          mobileOpen ? 'is-mobile-open' : '',
          className,
        ].filter(Boolean).join(' ')}
        aria-label="Primary navigation"
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? 'true' : undefined}
        tabIndex={mobileOpen ? -1 : undefined}
      >
        <header className="sidebar__brand">
          <img
            src={theme === 'light' ? brandAssets.horizontalLight : brandAssets.horizontal}
            alt="AlphaStudio"
          />
          <Button
            ref={closeRef}
            className="sidebar__close"
            variant="icon"
            size="sm"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <Icon name="close" />
          </Button>
        </header>
        {activeJobCount > 0 ? (
          <StatusBadge tone="live">{activeJobCount} active jobs</StatusBadge>
        ) : null}
        <nav className="sidebar__nav" aria-label="Workspace">
          {groups.map((group) => (
            <section className="sidebar__group" key={group}>
              <h2>{group}</h2>
              <div>
                {navigation.filter((item) => (item.group || 'Navigation') === group).map((item) => {
                  const href = item.href || `#/${item.id}`;
                  const current = currentHref === href;
                  return (
                    <a
                      key={item.id}
                      className={['sidebar__link', current ? 'is-current' : ''].filter(Boolean).join(' ')}
                      href={href}
                      aria-current={current ? 'page' : undefined}
                      onClick={(event) => {
                        onNavigate?.(item, event);
                        if (mobileOpen) onClose?.();
                      }}
                    >
                      <Icon name={item.icon || 'dashboard'} />
                      <span>{item.label || item.name}</span>
                    </a>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
        {footer ? <footer className="sidebar__footer">{footer}</footer> : null}
      </aside>
    </>
  );
}
