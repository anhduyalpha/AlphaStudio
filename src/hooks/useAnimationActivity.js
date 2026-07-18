import { useEffect, useRef, useState } from 'react';

// Gates a complex animation GROUP so it only runs when it is both on-screen and
// the tab is visible. Attach `ref` to the group's parent and spread the returned
// data attribute; children are paused purely via CSS ([data-animation-active="false"]).
//
// One IntersectionObserver per group parent (never per child), plus a shared-ish
// visibilitychange listener. Both are cleaned up on unmount.
export default function useAnimationActivity({ rootMargin = '120px' } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        // Only set state on actual change to avoid render thrash.
        const next = entries[0]?.isIntersecting ?? true;
        setInView((prev) => (prev === next ? prev : next));
      },
      { rootMargin, threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  useEffect(() => {
    const onVisibility = () => {
      const next = document.visibilityState !== 'hidden';
      setTabVisible((prev) => (prev === next ? prev : next));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const isActive = inView && tabVisible;
  return { ref, isActive, dataProps: { 'data-animation-active': isActive ? 'true' : 'false' } };
}
