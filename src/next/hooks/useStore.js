import { useCallback, useRef, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../../protocol/store.js';

/**
 * `useStore` — the ONLY React binding to `protocol/store.ts` (SPEC §3.1 hooks
 * row, §3.2 store row). It subscribes; it never writes. Components change state
 * by calling the store's published actions directly, so there is exactly one
 * writer and nothing `setState`-shaped anywhere else.
 *
 * Lives under `src/next/` during the transition (PLAN's namespace rule: the
 * final path `src/hooks/useStore.js` would collide with the live old client);
 * F1 moves it mechanically.
 *
 * Selector contract: pass a **stable** selector — a module-level function or one
 * wrapped in `useCallback` — that returns a primitive or a stable reference. An
 * inline selector building a fresh object every call is the classic
 * `useSyncExternalStore` render loop; the identity check below absorbs the
 * common cases (primitives, unchanged references) but cannot rescue a selector
 * that allocates on every read.
 */

const identity = (snapshot) => snapshot;

export default function useStore(selector = identity) {
  // Cached per (snapshot, selector) pair: useSyncExternalStore calls the getter
  // during render and compares with Object.is, so recomputing a fresh value on
  // every call would re-render forever.
  const cache = useRef({ snapshot: null, selector: null, value: undefined, primed: false });

  const read = useCallback(() => {
    const snapshot = getSnapshot();
    const cached = cache.current;
    if (cached.primed && cached.snapshot === snapshot && cached.selector === selector) {
      return cached.value;
    }
    const next = selector(snapshot);
    // Keep the previous reference when the value is equal — a snapshot change
    // that does not affect this selector must not re-render its component.
    const value = cached.primed && Object.is(cached.value, next) ? cached.value : next;
    cache.current = { snapshot, selector, value, primed: true };
    return value;
  }, [selector]);

  return useSyncExternalStore(subscribe, read, read);
}

export { useStore };
