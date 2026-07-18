import { config } from '../config.js';

/**
 * Same origin allowlist as @fastify/cors in app.ts.
 * Used by SSE and any raw responses that must not reflect arbitrary Origin.
 */
export function isCorsOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return true; // non-browser / same-origin tools
  if (origin === config.corsOrigin) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  return false;
}

/** Header value for allowed origin, or null if blocked (omit ACAO). */
export function corsAllowOriginHeader(origin: string | undefined | null): string | null {
  if (!origin) return config.corsOrigin || 'http://localhost:5173';
  if (isCorsOriginAllowed(origin)) return origin;
  return null;
}
