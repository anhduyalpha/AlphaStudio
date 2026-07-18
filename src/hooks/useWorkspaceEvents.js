import { useEffect, useRef } from 'react';
import { api } from '../api/client';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;

/**
 * Live workspace events via SSE.
 *
 * @param {string} workspaceId
 * @param {{
 *   onEvent?: (event: any) => void,
 *   onReconnect?: () => void,
 *   enabled?: boolean,
 * }} [options]
 */
export default function useWorkspaceEvents(workspaceId, { onEvent, onReconnect, enabled = true } = {}) {
  const onEventRef = useRef(onEvent);
  const onReconnectRef = useRef(onReconnect);
  onEventRef.current = onEvent;
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!workspaceId || !enabled) return;

    let stopped = false;
    let unsub = null;
    let timer = null;
    let backoffMs = INITIAL_BACKOFF_MS;
    let hasConnected = false;

    const clearTimer = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const connect = () => {
      if (stopped) return;

      unsub = api.subscribeWorkspaceEvents(workspaceId, {
        onEvent: (event) => {
          if (!stopped) onEventRef.current?.(event);
        },
        onOpen: () => {
          if (stopped) return;
          // Reset backoff after a successful open; notify parent on re-connect only.
          if (hasConnected) {
            onReconnectRef.current?.();
          }
          hasConnected = true;
          backoffMs = INITIAL_BACKOFF_MS;
        },
        onError: () => {
          if (stopped) return;
          unsub = null;
          clearTimer();
          const wait = backoffMs;
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
          timer = setTimeout(() => {
            timer = null;
            connect();
          }, wait);
        },
      });
    };

    connect();

    return () => {
      stopped = true;
      clearTimer();
      unsub?.();
      unsub = null;
    };
  }, [workspaceId, enabled]);
}
