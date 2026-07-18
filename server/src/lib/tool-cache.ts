/**
 * Tool config cache helpers — decide when resolveTool can skip expensive exec probes.
 */
import fs from 'node:fs';

export type CachedToolEntry = {
  path?: string;
  version?: string;
};

export type SkipProbeOptions = {
  /** Require a non-empty version string in config (default true) */
  requireVersion?: boolean;
  /** Optional existence check override for tests */
  existsSync?: (p: string) => boolean;
};

/**
 * True when config entry is complete enough to skip process spawn probe:
 * - path present
 * - file exists on disk
 * - version recorded (unless requireVersion=false)
 */
export function shouldSkipProbe(
  entry: CachedToolEntry | null | undefined,
  options: SkipProbeOptions = {},
): boolean {
  if (!entry) return false;
  const p = typeof entry.path === 'string' ? entry.path.trim() : '';
  if (!p) return false;
  const exists = options.existsSync ?? ((x: string) => fs.existsSync(x));
  if (!exists(p)) return false;
  const requireVersion = options.requireVersion !== false;
  if (requireVersion) {
    const v = typeof entry.version === 'string' ? entry.version.trim() : '';
    if (!v) return false;
  }
  return true;
}

/**
 * Build a resolved tool entry from a valid cached config without probing.
 * Caller must have already confirmed shouldSkipProbe(...) === true.
 */
export function resolveFromValidConfig(
  name: string,
  entry: CachedToolEntry,
  source: 'project' | 'path' | 'bundled' = 'project',
): {
  name: string;
  path: string;
  version?: string;
  available: true;
  source: 'project' | 'path' | 'bundled';
  skippedProbe: true;
} {
  return {
    name,
    path: String(entry.path),
    version: entry.version,
    available: true,
    source,
    skippedProbe: true,
  };
}

/**
 * Filter tools map to those eligible for skip-probe.
 */
export function listSkipProbeTools(
  tools: Record<string, CachedToolEntry | undefined>,
  options: SkipProbeOptions = {},
): string[] {
  return Object.keys(tools).filter((name) => shouldSkipProbe(tools[name], options));
}
