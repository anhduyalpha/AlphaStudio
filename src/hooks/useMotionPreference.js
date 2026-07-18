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

// Cheap, safe device heuristics — every API is optional and feature-detected.
function deviceSuggestsLighter() {
  if (typeof navigator === 'undefined') return false;
  const conn = navigator.connection;
  if (conn && conn.saveData === true) return true;
  if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4) return true;
  if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4) return true;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(max-width: 900px)').matches) return true;
  }
  return false;
}

// Resolution order: OS reduced-motion always wins → explicit stored choice →
// device heuristic (balanced) → balanced default.
function resolveMode(stored) {
  if (prefersReducedMotion()) return 'reduced';
  if (stored && MOTION_MODES.includes(stored)) return stored;
  if (deviceSuggestsLighter()) return 'balanced';
  return 'balanced';
}

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function useMotionPreference() {
  const [stored, setStored] = useState(readStored);
  const [mode, setMode] = useState(() => resolveMode(readStored()));

  // Reflect the resolved mode onto <html data-motion> so pure-CSS gating works.
  useEffect(() => {
    document.documentElement.dataset.motion = mode;
  }, [mode]);

  // Re-resolve whenever the OS reduced-motion preference flips at runtime.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setMode(resolveMode(stored));
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [stored]);

  const chooseMode = useCallback((next) => {
    if (!MOTION_MODES.includes(next)) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — mode still applies for this session */
    }
    setStored(next);
    // OS reduced-motion still wins even over an explicit pick.
    setMode(prefersReducedMotion() ? 'reduced' : next);
  }, []);

  return { mode, setMode: chooseMode };
}
