import fs from 'node:fs';
import { clearToolsCache, toolsConfigPath, toolsManifestPath } from '../../tools/registry.js';
import { invalidateOptionalBinaries } from '../../tools/optional-binaries.js';
import { normalizeFormat } from '../formats.js';
import type {
  CapabilitySnapshot,
  ConversionEngineAdapter,
  EngineRoute,
  EngineStatus,
} from './types.js';

type RegistryOptions = {
  ttlMs?: number;
  now?: () => number;
  stamp?: () => string;
};

export class ConversionEngineRegistry {
  readonly adapters: ConversionEngineAdapter[];
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly stamp: () => string;
  private cache: { at: number; stamp: string; snapshot: CapabilitySnapshot } | null = null;

  constructor(adapters: ConversionEngineAdapter[], options: RegistryOptions = {}) {
    this.adapters = [...adapters];
    this.ttlMs = Math.max(1, options.ttlMs ?? 60_000);
    this.now = options.now || Date.now;
    this.stamp = options.stamp || (() => '');
  }

  getSnapshot(force = false): CapabilitySnapshot {
    const now = this.now();
    const stamp = this.stamp();
    if (
      !force &&
      this.cache &&
      now - this.cache.at < this.ttlMs &&
      this.cache.stamp === stamp
    ) {
      return this.cache.snapshot;
    }

    const engines: EngineStatus[] = [];
    const routes: EngineRoute[] = [];
    for (const adapter of this.adapters) {
      const platformSupported = adapter.supportedPlatforms.includes(process.platform);
      try {
        const probe = platformSupported
          ? adapter.probe()
          : {
              available: false,
              reason: `${adapter.name} is not supported on ${process.platform}`,
            };
        const discovery = adapter.discoverCapabilities(probe);
        engines.push({
          id: adapter.id,
          name: adapter.name,
          available: platformSupported && probe.available,
          version: probe.version,
          reason: probe.reason,
          profile: adapter.profile,
          supported: platformSupported,
          approximateInstalledSizeMb: adapter.approximateInstalledSizeMb,
          workerCategory: adapter.defaultWorkerCategory,
          concurrencyLimit: adapter.concurrencyLimit,
          readableFormats: [...new Set(discovery.readableFormats.map(normalizeFormat))].sort(),
          writableFormats: [...new Set(discovery.writableFormats.map(normalizeFormat))].sort(),
          notes: discovery.notes,
        });
        for (const candidate of discovery.routes) {
          routes.push({
            ...candidate,
            input: normalizeFormat(candidate.input),
            output: normalizeFormat(candidate.output),
            engineId: adapter.id,
            engineName: adapter.name,
            handler: adapter.handler,
            profile: adapter.profile,
            version: probe.version,
            available: platformSupported && probe.available && candidate.supported,
            reason:
              platformSupported && probe.available
                ? candidate.reason
                : probe.reason || `${adapter.name} is not installed`,
          });
        }
      } catch {
        const reason = `${adapter.name} capability probe failed`;
        engines.push({
          id: adapter.id,
          name: adapter.name,
          available: false,
          reason,
          profile: adapter.profile,
          supported: platformSupported,
          approximateInstalledSizeMb: adapter.approximateInstalledSizeMb,
          workerCategory: adapter.defaultWorkerCategory,
          concurrencyLimit: adapter.concurrencyLimit,
          readableFormats: [],
          writableFormats: [],
        });
      }
    }

    routes.sort(compareRoutes);
    const snapshot = {
      generatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      engines: engines.sort((a, b) => a.id.localeCompare(b.id)),
      routes,
    };
    this.cache = { at: now, stamp, snapshot };
    return snapshot;
  }

  routesFor(input: string, output: string, includeUnavailable = false): EngineRoute[] {
    const from = normalizeFormat(input);
    const to = normalizeFormat(output);
    return this.getSnapshot().routes.filter(
      (route) =>
        route.input === from &&
        route.output === to &&
        (includeUnavailable || route.available),
    );
  }

  invalidate(): void {
    this.cache = null;
  }

  validateOutput(route: EngineRoute, outputPath: string, outputFormat: string): void {
    const adapter = this.adapters.find((candidate) => candidate.id === route.engineId);
    if (!adapter) throw new Error(`Unknown conversion engine: ${route.engineId}`);
    adapter.validateOutput(outputPath, outputFormat);
  }
}

function compareRoutes(a: EngineRoute, b: EngineRoute): number {
  return (
    a.input.localeCompare(b.input) ||
    a.output.localeCompare(b.output) ||
    Number(b.available) - Number(a.available) ||
    a.priority - b.priority ||
    a.engineId.localeCompare(b.engineId)
  );
}

function registryFileStamp(): string {
  return [toolsConfigPath, toolsManifestPath]
    .map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
      } catch {
        return '-';
      }
    })
    .join('|');
}

let defaultRegistry: ConversionEngineRegistry | null = null;

export function getEngineRegistry(): ConversionEngineRegistry {
  if (!defaultRegistry) {
    // Late imports are avoided here; adapters are registered by setDefaultEngineRegistry
    // from the module below to keep this class injectable for parser/cache tests.
    throw new Error('Conversion engine registry has not been initialized');
  }
  return defaultRegistry;
}

export function setDefaultEngineRegistry(registry: ConversionEngineRegistry): void {
  defaultRegistry = registry;
}

export function createDefaultRegistry(
  adapters: ConversionEngineAdapter[],
  options: RegistryOptions = {},
): ConversionEngineRegistry {
  return new ConversionEngineRegistry(adapters, {
    ttlMs: options.ttlMs,
    now: options.now,
    stamp: options.stamp || registryFileStamp,
  });
}

export function invalidateEngineRegistry(): void {
  defaultRegistry?.invalidate();
  clearToolsCache();
  invalidateOptionalBinaries();
}

export function validateEngineOutput(
  route: EngineRoute,
  outputPath: string,
  outputFormat: string,
): void {
  getEngineRegistry().validateOutput(route, outputPath, outputFormat);
}

export function publicCapabilitySnapshot(snapshot: CapabilitySnapshot): CapabilitySnapshot {
  return {
    ...snapshot,
    engines: snapshot.engines.map((engine) => ({ ...engine })),
    routes: snapshot.routes.map((route) => ({
      ...route,
      metadata: route.metadata
        ? Object.fromEntries(
            Object.entries(route.metadata).filter(
              ([key]) => !/path|command|args|executable/i.test(key),
            ),
          )
        : undefined,
    })),
  };
}
