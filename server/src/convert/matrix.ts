import { resolveAllTools, type ToolEntry } from '../tools/registry.js';
import {
  hasOcrStack,
  hasPdfRasterizer,
  resolveOptionalBinary,
} from '../tools/optional-binaries.js';
import {
  capabilitySnapshot,
  conversionRoutes,
  invalidateEngineRegistry,
  type EngineRoute,
  type ToolProfile,
} from './engines/index.js';
import {
  formatLabel,
  normalizeFormat,
  type Family,
} from './formats.js';

export type { Family } from './formats.js';

export type PublicEngineRoute = {
  id: string;
  name: string;
  version?: string;
  profile: ToolProfile;
  priority: number;
  cost: EngineRoute['cost'];
};

export type OutputOption = {
  format: string;
  label: string;
  available: boolean;
  reason?: string;
  requires?: string[];
  profile?: ToolProfile;
  engine?: PublicEngineRoute;
  engines?: PublicEngineRoute[];
};

export type DetectedKind = {
  family: Family;
  format: string;
  ext: string;
  mime: string;
  codecs?: string[];
};

const DEFAULTS: Record<Family, string> = {
  image: 'webp',
  audio: 'mp3',
  video: 'mp4',
  document: 'pdf',
  spreadsheet: 'csv',
  presentation: 'pdf',
  archive: 'zip',
  ebook: 'epub',
  text: 'pdf',
  pdf: 'png',
  unknown: 'zip',
};

let toolsSnapshotCache: { at: number; tools: Record<string, ToolEntry> } | null = null;
const TOOLS_SNAPSHOT_TTL_MS = 60_000;

export function getToolsSnapshot(force = false): Record<string, ToolEntry> {
  const now = Date.now();
  if (
    !force &&
    toolsSnapshotCache &&
    now - toolsSnapshotCache.at < TOOLS_SNAPSHOT_TTL_MS
  ) {
    return toolsSnapshotCache.tools;
  }
  const tools = { ...resolveAllTools(force) };
  toolsSnapshotCache = { at: now, tools };
  if (force) capabilitySnapshot(true);
  return tools;
}

export function invalidateToolsSnapshot(): void {
  toolsSnapshotCache = null;
  invalidateEngineRegistry();
}

function routeForDetectedCodecs(route: EngineRoute, kind: DetectedKind): EngineRoute {
  if (
    route.engineId !== 'ffmpeg' ||
    !kind.codecs?.length ||
    !route.metadata?.inputCodecs?.length
  ) {
    return route;
  }
  const supported = new Set(route.metadata.inputCodecs.map((codec) => codec.toLowerCase()));
  const missing = kind.codecs
    .map((codec) => codec.toLowerCase())
    .filter((codec) => codec && !supported.has(codec));
  if (!missing.length) return route;
  return {
    ...route,
    available: false,
    reason: `FFmpeg build cannot decode detected codec${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
  };
}

function publicEngine(route: EngineRoute): PublicEngineRoute {
  return {
    id: route.engineId,
    name: route.engineName,
    version: route.version,
    profile: route.profile,
    priority: route.priority,
    cost: route.cost,
  };
}

export function routesForConversion(
  kind: DetectedKind,
  outputFormat: string,
  includeUnavailable = false,
): EngineRoute[] {
  const output = normalizeFormat(outputFormat);
  return conversionRoutes(kind.format, output, true)
    .map((route) => routeForDetectedCodecs(route, kind))
    .filter((route) => includeUnavailable || route.available);
}

export function listOutputsFor(
  kind: DetectedKind,
  tools?: Record<string, ToolEntry>,
): OutputOption[] {
  const input = normalizeFormat(kind.format || kind.ext);
  const allRoutes = capabilitySnapshot().routes
    .filter((route) => route.input === input)
    .filter((route) => !tools || route.engineId !== 'calibre' || Boolean(tools.calibre))
    .map((route) => routeForDetectedCodecs(route, kind));
  const byOutput = new Map<string, EngineRoute[]>();
  for (const originalRoute of allRoutes) {
    let route = originalRoute;
    // Backward-compatible injected tool snapshots used by unit tests and
    // callers that want to simulate installation without mutating PATH.
    if (tools && route.engineId === 'libreoffice' && tools.libreoffice) {
      route = {
        ...route,
        available: tools.libreoffice.available,
        reason: tools.libreoffice.available ? undefined : route.reason,
      };
    } else if (tools && route.engineId === 'sevenzip' && tools['7z']) {
      route = {
        ...route,
        available: tools['7z'].available,
        reason: tools['7z'].available ? undefined : route.reason,
      };
    }
    const routes = byOutput.get(route.output) || [];
    routes.push(route);
    byOutput.set(route.output, routes);
  }

  const outputs: OutputOption[] = [];
  for (const [format, routes] of byOutput) {
    if (normalizeFormat(format) === input) continue;
    routes.sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        a.priority - b.priority ||
        a.engineId.localeCompare(b.engineId),
    );
    const preferred = routes.find((route) => route.available) || routes[0];
    const available = routes.some((route) => route.available);
    const requires = [...new Set(routes.flatMap((route) => route.requiredCompanions || []))];
    outputs.push({
      format,
      label: formatLabel(format),
      available,
      reason: available
        ? undefined
        : preferred?.reason || `No installed engine can convert ${input} to ${format}`,
      requires: requires.length ? requires : undefined,
      profile: preferred?.profile,
      engine: preferred ? publicEngine(preferred) : undefined,
      engines: routes.map(publicEngine),
    });
  }
  return outputs.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      (a.engine?.priority ?? 999) - (b.engine?.priority ?? 999) ||
      a.format.localeCompare(b.format),
  );
}

export function recommendedOutput(kind: DetectedKind, options: OutputOption[]): string | null {
  const preferred = normalizeFormat(DEFAULTS[kind.family]);
  const hit = options.find((option) => option.available && option.format === preferred);
  return hit?.format || options.find((option) => option.available)?.format || null;
}

export function intersectOutputs(lists: OutputOption[][]): {
  outputs: OutputOption[];
  conflict?: string;
} {
  if (!lists.length) return { outputs: [], conflict: 'No files' };
  if (lists.length === 1) return { outputs: lists[0] };
  const availableSets = lists.map(
    (list) => new Set(list.filter((option) => option.available).map((option) => option.format)),
  );
  let intersection = [...availableSets[0]];
  for (let index = 1; index < availableSets.length; index += 1) {
    intersection = intersection.filter((format) => availableSets[index].has(format));
  }
  if (!intersection.length) {
    return {
      outputs: [],
      conflict:
        'Selected files share no common convertible output format. Convert them separately or pick a single family.',
    };
  }
  const firstByFormat = new Map(lists[0].map((option) => [option.format, option]));
  return {
    outputs: intersection.map(
      (format) =>
        firstByFormat.get(format) || {
          format,
          label: formatLabel(format),
          available: true,
        },
    ),
  };
}

export function normalizeFormatToken(format: string): string {
  return normalizeFormat(format);
}

export function isSameFormat(inputFormat: string, outputFormat: string): boolean {
  const input = normalizeFormat(inputFormat);
  const output = normalizeFormat(outputFormat);
  return Boolean(input && output && input === output);
}

export function sameFormatBlockedForLibreOffice(family: string, inputFormat: string): boolean {
  if (family === 'pdf' || normalizeFormat(inputFormat) === 'pdf') return true;
  return ['document', 'spreadsheet', 'presentation'].includes(family);
}

export type RouteDecision = {
  engine:
    | 'pdf-text'
    | 'pdf-rasterizer'
    | 'pdf-lib'
    | 'sharp+pdf-lib'
    | 'libreoffice'
    | 'ffmpeg'
    | 'pandoc'
    | 'calibre'
    | 'sevenzip'
    | 'alphastudio'
    | 'pure'
    | 'unsupported';
  engineId?: string;
  engineName?: string;
  requires: string[];
  libreOfficeAllowed: boolean;
  reason?: string;
  route?: EngineRoute;
  fallbacks?: EngineRoute[];
};

export function routeConversion(
  kind: DetectedKind,
  outputFormat: string,
  operation?: string,
): RouteDecision {
  const format = normalizeFormat(outputFormat);
  const op = String(operation || 'convert').toLowerCase();

  if (kind.family === 'pdf' || normalizeFormat(kind.format) === 'pdf') {
    if (['merge', 'split', 'rotate', 'reorder', 'extract', 'compress'].includes(op)) {
      return { engine: 'pdf-lib', engineId: 'alphastudio', requires: ['pdf-lib'], libreOfficeAllowed: false };
    }
    if (op === 'from-images') {
      return {
        engine: 'sharp+pdf-lib',
        engineId: 'alphastudio',
        requires: ['sharp', 'pdf-lib'],
        libreOfficeAllowed: false,
      };
    }
  }

  if (isSameFormat(kind.format, format)) {
    return {
      engine: 'unsupported',
      requires: [],
      libreOfficeAllowed: false,
      reason:
        kind.family === 'pdf'
          ? 'PDF → PDF is not a convert pair (use compress)'
          : 'Same-format conversion is a no-op',
    };
  }

  const routes = routesForConversion(kind, format, true);
  const available = routes.filter((route) => route.available);
  const preferred = available[0] || routes[0];
  if (!preferred) {
    return {
      engine: 'unsupported',
      requires: [],
      libreOfficeAllowed: false,
      reason: `Unsupported conversion: ${normalizeFormat(kind.format)} → ${format}`,
    };
  }
  if (!preferred.available) {
    return {
      engine: 'unsupported',
      engineId: preferred.engineId,
      engineName: preferred.engineName,
      requires: preferred.requiredCompanions || [],
      libreOfficeAllowed: false,
      reason: preferred.reason || `${preferred.engineName} is unavailable`,
      route: preferred,
    };
  }
  const engine =
    preferred.engineId === 'alphastudio'
      ? kind.family === 'pdf' && format === 'txt'
        ? 'pdf-text'
        : kind.family === 'image' && format === 'pdf'
          ? 'sharp+pdf-lib'
          : 'pure'
      : (preferred.engineId as Exclude<RouteDecision['engine'], 'pure' | 'unsupported'>);
  return {
    engine,
    engineId: preferred.engineId,
    engineName: preferred.engineName,
    requires: preferred.requiredCompanions || [],
    libreOfficeAllowed: preferred.engineId === 'libreoffice',
    route: preferred,
    fallbacks: available.slice(1),
  };
}

export function isLibreOfficeForbidden(
  kind: DetectedKind,
  outputFormat: string,
  operation?: string,
): boolean {
  return !routeConversion(kind, outputFormat, operation).libreOfficeAllowed;
}

export function assertPairAllowed(kind: DetectedKind, outputFormat: string): void {
  const format = normalizeFormat(outputFormat);
  if (isSameFormat(kind.format, format) && sameFormatBlockedForLibreOffice(kind.family, kind.format)) {
    const error = new Error(
      kind.family === 'pdf'
        ? 'Unsupported conversion: pdf → pdf (use PDF compress/optimize or a different format)'
        : `Same-format conversion ${kind.format} → ${format} is not supported (no-op)`,
    ) as Error & { statusCode: number; code: string };
    error.statusCode = 400;
    error.code = 'BAD_REQUEST';
    error.name = 'AppError';
    throw error;
  }

  const option = listOutputsFor(kind).find((candidate) => candidate.format === format);
  if (!option) {
    const error = new Error(`Unsupported conversion: ${kind.format} → ${format}`) as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 400;
    error.code = 'BAD_REQUEST';
    error.name = 'AppError';
    throw error;
  }
  if (!option.available) {
    const error = new Error(option.reason || `Output ${format} is unavailable`) as Error & {
      statusCode: number;
      code: string;
      details: unknown;
    };
    error.statusCode = 503;
    error.code = 'UNAVAILABLE';
    error.details = { format, profile: option.profile, engines: option.engines?.map((engine) => engine.id) };
    error.name = 'AppError';
    throw error;
  }
}

export function pdfEngineCapabilities(): {
  text: string;
  rasterizer: boolean;
  ocr: boolean;
  pdftotext: boolean;
  mutool: boolean;
  tesseract: boolean;
} {
  return {
    text: resolveOptionalBinary('pdftotext').available
      ? 'pdftotext'
      : resolveOptionalBinary('mutool').available
        ? 'mutool'
        : 'native',
    rasterizer: hasPdfRasterizer(),
    ocr: hasOcrStack(),
    pdftotext: resolveOptionalBinary('pdftotext').available,
    mutool: resolveOptionalBinary('mutool').available,
    tesseract: resolveOptionalBinary('tesseract').available,
  };
}
