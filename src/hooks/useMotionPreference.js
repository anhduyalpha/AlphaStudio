import { useCallback, useEffect, useState } from 'react';

// Motion modes drive how much decorative animation the UI runs.
//   full     — all meaningful + subtle continuous decoration (opt-in)
//   balanced — entrances + interaction feedback, decorative infinite motion off (default)
//   reduced  — nearly all non-essential movement removed
export const MOTION_MODES = ['full', 'balanced', 'reduced'];
const STORAGE_KEY = 'alpha-studio-motion';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Resolution order: OS reduced-motion always wins → explicit stored choice →
// balanced default.
function resolveMode(stored) {
  if (prefersReducedMotion()) return 'reduced';
  if (stored && MOTION_MODES.includes(stored)) return stored;
  return 'balanced';
}

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const MOTION_EVENT = 'alpha-studio-motion';

export default function useMotionPreference() {
  const [stored, setStored] = useState(readStored);
  const [mode, setMode] = useState(() => resolveMode(readStored()));

  // Reflect the resolved mode onto <html data-motion> so pure-CSS gating works.
  useEffect(() => {
    document.documentElement.dataset.motion = mode;
  }, [mode]);

  // Optional low-power flag for CSS (Battery API + save-data). Graceful no-op if unavailable.
  useEffect(() => {
    let cancelled = false;
    let battery = null;
    let batteryLow = false;
    const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
    let saveData = Boolean(conn?.saveData);

    const apply = () => {
      if (cancelled) return;
      if (saveData || batteryLow) document.documentElement.dataset.power = 'low';
      else delete document.documentElement.dataset.power;
    };

    const updateConnection = () => {
      saveData = Boolean(conn?.saveData);
      apply();
    };
    const updateBattery = () => {
      batteryLow = Boolean(battery) && battery.level < 0.2 && !battery.charging;
      apply();
    };

    apply();
    conn?.addEventListener?.('change', updateConnection);
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.getBattery === 'function') {
      nav.getBattery().then((bat) => {
        if (cancelled) return;
        battery = bat;
        updateBattery();
        battery.addEventListener?.('levelchange', updateBattery);
        battery.addEventListener?.('chargingchange', updateBattery);
      }).catch(() => { /* ignore */ });
    }
    return () => {
      cancelled = true;
      conn?.removeEventListener?.('change', updateConnection);
      battery?.removeEventListener?.('levelchange', updateBattery);
      battery?.removeEventListener?.('chargingchange', updateBattery);
    };
  }, []);

  // Re-resolve whenever the OS reduced-motion preference flips at runtime.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setMode(resolveMode(stored));
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [stored]);

  // Keep multiple hook instances (App shell + Settings) in sync.
  useEffect(() => {
    const onMotionEvent = (event) => {
      const next = event?.detail;
      if (!next || !MOTION_MODES.includes(next)) return;
      setStored(next);
      setMode(prefersReducedMotion() ? 'reduced' : next);
    };
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      const next = event.newValue;
      setStored(next);
      setMode(resolveMode(next));
    };
    window.addEventListener(MOTION_EVENT, onMotionEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MOTION_EVENT, onMotionEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const chooseMode = useCallback((next) => {
    if (!MOTION_MODES.includes(next)) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — mode still applies for this session */
    }
    setStored(next);
    // OS reduced-motion still wins even over an explicit pick.
    const resolved = prefersReducedMotion() ? 'reduced' : next;
    setMode(resolved);
    window.dispatchEvent(new CustomEvent(MOTION_EVENT, { detail: next }));
  }, []);

  return { mode, setMode: chooseMode };
}
