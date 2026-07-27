import { useEffect } from 'react';

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute('inert')
      && element.getAttribute('aria-hidden') !== 'true'
      && (element.offsetParent !== null || element === document.activeElement));
}

export default function useFocusTrap({
  active,
  containerRef,
  initialFocusRef,
  onEscape,
  restoreFocus = true,
}) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const root = containerRef.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const target = initialFocusRef?.current || getFocusableElements(root)[0] || root;
      target?.focus?.();
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (restoreFocus && previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [active, containerRef, initialFocusRef, onEscape, restoreFocus]);
}
