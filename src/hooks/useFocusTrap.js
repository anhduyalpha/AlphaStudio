import { useEffect, useRef } from 'react';

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function isFocusableCandidate(element, activeElement) {
  if (!element || element.matches?.(':disabled')) return false;
  if (element.closest?.('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const hasLayoutBox = element.offsetParent !== null
    || (typeof element.getClientRects === 'function' && element.getClientRects().length > 0);
  return hasLayoutBox || element === activeElement;
}

export function getFocusableElements(
  root,
  activeElement = typeof document === 'undefined' ? null : document.activeElement,
) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((element) => isFocusableCandidate(element, activeElement));
}

export function selectInitialFocusTarget(root, focusable, requested) {
  if (requested && root?.contains?.(requested) && focusable.includes(requested)) return requested;
  return focusable[0] || root || null;
}

export default function useFocusTrap({
  active,
  containerRef,
  initialFocusRef,
  onEscape,
  restoreFocus = true,
}) {
  const optionsRef = useRef({ initialFocusRef, onEscape, restoreFocus });
  optionsRef.current = { initialFocusRef, onEscape, restoreFocus };

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const root = containerRef.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const focusable = getFocusableElements(root);
      const target = selectInitialFocusTarget(
        root,
        focusable,
        optionsRef.current.initialFocusRef?.current,
      );
      target?.focus?.();
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        optionsRef.current.onEscape?.();
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
      if (optionsRef.current.restoreFocus && previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [active, containerRef]);
}
