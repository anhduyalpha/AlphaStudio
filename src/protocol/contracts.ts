/**
 * protocol/contracts.ts — SPEC §3.2 contracts row.
 *
 * Fetches and caches `/api/capabilities` **through `api/client.js` only**, and
 * exposes the server's published contracts: accept lists, gated operations,
 * quality aliases, engine availability.
 *
 * The hard rule this module exists to enforce (SPEC §3.2): it contains **no
 * fallback format or operation literals**. If capabilities are unreachable the
 * client does not invent a contract — every lookup returns `available: false`
 * with a reason, and the hub renders its capability-gap state. That is why the
 * selectors return a `ContractLookup` rather than a bare value: "unrestricted"
 * and "we do not know" are different answers and must never collapse.
 *
 * Layering (SPEC §3.2): `protocol` may import `api`, nothing else. No React,
 * no components, no store.
 */

// api/client.js is untyped JavaScript by design — SPEC §3.1's language rule
// makes only src/protocol/ and src/hubs/ TypeScript, and tsconfig.client.json
// enables no allowJs. This single suppression is the typed boundary between the
// TS protocol island and the JS API wrapper; the shape is re-declared below so
// nothing downstream sees `any`.
// @ts-expect-error TS7016: untyped JS module, intentionally so.
import { api as untypedApi } from '../api/client.js';

const client = untypedApi as {
  capabilities: (options?: { refresh?: boolean }) => Promise<unknown>;
};

/* ---------------------------------------------------------------- *
 * Published shapes. Type declarations only — SPEC §3.5's "no format
 * literals outside contracts.ts type definitions" is satisfied by there
 * being no VALUES here: every list below is `string[]`, filled by the server.
 * ---------------------------------------------------------------- */

export type AcceptList = {
  id: string;
  label: string;
  families: string[];
  /** Everything the server's format table knows for these families. */
  extensions: string[];
  /**
   * The subset `POST /api/uploads` actually accepts. **Build file filters from
   * this** — the upload allowlist is narrower than the format table (A3).
   */
  uploadable: string[];
  mimeTypes: string[];
};

/** `null` = this job type/mode places no restriction on input file types. */
export type JobAcceptRule = {
  default: string | null;
  operations: Record<string, string | null>;
};

export type AcceptListsContract = {
  lists: Record<string, AcceptList>;
  jobTypes: Record<string, JobAcceptRule>;
};

export type GatedOperation = {
  id: string;
  label: string;
  reason: string;
  requires?: string[];
};

export type QualityContract = {
  presets: string[];
  default: string;
  aliases: Record<string, string>;
};

export type EngineStatus = {
  id: string;
  name: string;
  available: boolean;
  version?: string;
  reason?: string;
  readableFormats: string[];
  writableFormats: string[];
};

export type CapabilityContract = {
  version: string;
  detectedAt: string;
  acceptLists: AcceptListsContract;
  gatedOps: GatedOperation[];
  quality: QualityContract;
  engines: EngineStatus[];
  /** Whole payload, for the sections this module does not model. */
  raw: Record<string, unknown>;
};

export type ContractState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; contract: CapabilityContract; fetchedAt: number }
  | { status: 'unavailable'; reason: string };

/**
 * The result of every contract lookup. `available: false` is the capability-gap
 * signal a hub renders; it is never a silent default.
 */
export type ContractLookup<T> = { available: true; value: T } | { available: false; reason: string };

/* ---------------------------------------------------------------- *
 * Parsing — reject a malformed payload rather than half-trust it.
 * ---------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === 'string') ? [...(value as string[])] : null;
}

function parseAcceptList(id: string, value: unknown): AcceptList | null {
  if (!isRecord(value)) return null;
  const families = stringArray(value.families);
  const extensions = stringArray(value.extensions);
  const uploadable = stringArray(value.uploadable);
  const mimeTypes = stringArray(value.mimeTypes);
  if (!families || !extensions || !uploadable || !mimeTypes) return null;
  return {
    id,
    label: typeof value.label === 'string' ? value.label : id,
    families,
    extensions,
    uploadable,
    mimeTypes,
  };
}

function parseAcceptLists(value: unknown): AcceptListsContract | null {
  if (!isRecord(value) || !isRecord(value.lists) || !isRecord(value.jobTypes)) return null;
  const lists: Record<string, AcceptList> = {};
  for (const [id, entry] of Object.entries(value.lists)) {
    const list = parseAcceptList(id, entry);
    if (!list) return null;
    lists[id] = list;
  }
  const jobTypes: Record<string, JobAcceptRule> = {};
  for (const [type, entry] of Object.entries(value.jobTypes)) {
    if (!isRecord(entry)) return null;
    const fallback = entry.default;
    if (fallback !== null && typeof fallback !== 'string') return null;
    const operations: Record<string, string | null> = {};
    if (entry.operations !== undefined) {
      if (!isRecord(entry.operations)) return null;
      for (const [op, listId] of Object.entries(entry.operations)) {
        if (listId !== null && typeof listId !== 'string') return null;
        operations[op] = listId;
      }
    }
    jobTypes[type] = { default: fallback, operations };
  }
  return { lists, jobTypes };
}

function parseGatedOps(value: unknown): GatedOperation[] | null {
  if (!Array.isArray(value)) return null;
  const gated: GatedOperation[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.reason !== 'string') {
      return null;
    }
    const requires = entry.requires === undefined ? undefined : stringArray(entry.requires);
    if (entry.requires !== undefined && !requires) return null;
    gated.push({
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      reason: entry.reason,
      requires: requires || undefined,
    });
  }
  return gated;
}

function parseQuality(value: unknown): QualityContract | null {
  if (!isRecord(value)) return null;
  const presets = stringArray(value.presets);
  if (!presets || presets.length === 0) return null;
  if (typeof value.default !== 'string') return null;
  if (!isRecord(value.aliases)) return null;
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(value.aliases)) {
    if (typeof target !== 'string') return null;
    aliases[alias] = target;
  }
  return { presets, default: value.default, aliases };
}

function parseEngines(value: unknown): EngineStatus[] {
  if (!isRecord(value) || !Array.isArray(value.engines)) return [];
  const engines: EngineStatus[] = [];
  for (const entry of value.engines) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    engines.push({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : entry.id,
      available: entry.available === true,
      version: typeof entry.version === 'string' ? entry.version : undefined,
      reason: typeof entry.reason === 'string' ? entry.reason : undefined,
      readableFormats: stringArray(entry.readableFormats) || [],
      writableFormats: stringArray(entry.writableFormats) || [],
    });
  }
  return engines;
}

/**
 * Turn a raw `/api/capabilities` body into a contract, or `null` when a
 * required section is missing or malformed. Exported for the unit tests and
 * for callers that already hold a payload; it never falls back to defaults.
 */
export function parseCapabilities(payload: unknown): CapabilityContract | null {
  if (!isRecord(payload)) return null;
  const acceptLists = parseAcceptLists(payload.acceptLists);
  const gatedOps = parseGatedOps(payload.gatedOps);
  const quality = parseQuality(payload.quality);
  if (!acceptLists || !gatedOps || !quality) return null;
  return {
    version: typeof payload.version === 'string' ? payload.version : '',
    detectedAt: typeof payload.detectedAt === 'string' ? payload.detectedAt : '',
    acceptLists,
    gatedOps,
    quality,
    engines: parseEngines(payload.converter),
    raw: payload,
  };
}

/* ---------------------------------------------------------------- *
 * Fetch + cache.
 * ---------------------------------------------------------------- */

let state: ContractState = { status: 'idle' };
let inFlight: Promise<ContractState> | null = null;

export function getContractState(): ContractState {
  return state;
}

/** Drop the cache — workspace teardown, and test isolation. */
export function resetContracts(): void {
  state = { status: 'idle' };
  inFlight = null;
}

function failureReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Capabilities are unreachable';
}

/**
 * Fetch the contract once and cache it. Concurrent callers share one request;
 * a ready contract is returned as-is unless `refresh` is set. A failed or
 * malformed response resolves to `unavailable` — it never throws at the
 * caller, because the caller's job is to render the gap state, not to catch.
 */
export function loadContracts(options: { refresh?: boolean } = {}): Promise<ContractState> {
  const refresh = options.refresh === true;
  if (!refresh && state.status === 'ready') return Promise.resolve(state);
  if (inFlight && !refresh) return inFlight;

  state = { status: 'loading' };
  const request = Promise.resolve()
    .then(() => client.capabilities(refresh ? { refresh: true } : undefined))
    .then((payload) => {
      const contract = parseCapabilities(payload);
      state = contract
        ? { status: 'ready', contract, fetchedAt: Date.now() }
        : {
            status: 'unavailable',
            reason: '/api/capabilities did not publish a usable contract',
          };
      return state;
    })
    .catch((error: unknown) => {
      state = { status: 'unavailable', reason: failureReason(error) };
      return state;
    })
    .finally(() => {
      inFlight = null;
    });

  inFlight = request;
  return request;
}

/* ---------------------------------------------------------------- *
 * Selectors. Every one is gap-aware: no contract ⇒ `available: false`.
 * ---------------------------------------------------------------- */

function requireContract(): ContractLookup<CapabilityContract> {
  if (state.status === 'ready') return { available: true, value: state.contract };
  if (state.status === 'unavailable') return { available: false, reason: state.reason };
  return { available: false, reason: 'Capabilities have not been loaded yet' };
}

/** The named list a job type/mode accepts. `value: null` = unrestricted. */
export function acceptListFor(
  jobType: string,
  operation?: string,
): ContractLookup<AcceptList | null> {
  const found = requireContract();
  if (!found.available) return found;
  const { lists, jobTypes } = found.value.acceptLists;
  const rule = jobTypes[jobType];
  if (!rule) return { available: true, value: null };
  const op = (operation || '').toLowerCase().trim();
  const listId =
    op && Object.prototype.hasOwnProperty.call(rule.operations, op)
      ? rule.operations[op]
      : rule.default;
  if (listId === null || listId === undefined) return { available: true, value: null };
  const list = lists[listId];
  if (!list) {
    return { available: false, reason: `Published list "${listId}" is missing from the contract` };
  }
  return { available: true, value: list };
}

/**
 * The `accept` attribute for a job type/mode, built from the **uploadable**
 * extensions plus their MIME types. Empty string = unrestricted.
 */
export function acceptAttributeFor(jobType: string, operation?: string): ContractLookup<string> {
  const found = acceptListFor(jobType, operation);
  if (!found.available) return found;
  if (!found.value) return { available: true, value: '' };
  return { available: true, value: [...found.value.uploadable, ...found.value.mimeTypes].join(',') };
}

/** `value: null` = the capability is not gated on this machine. */
export function gatedOperation(capabilityId: string): ContractLookup<GatedOperation | null> {
  const found = requireContract();
  if (!found.available) return found;
  const gated = found.value.gatedOps.find((entry) => entry.id === capabilityId);
  return { available: true, value: gated || null };
}

export function isOperationGated(capabilityId: string): ContractLookup<boolean> {
  const found = gatedOperation(capabilityId);
  return found.available ? { available: true, value: found.value !== null } : found;
}

/**
 * Resolve a quality alias to a preset **using the server's answer**. An alias
 * the server does not publish resolves to the server's published default — the
 * client never picks a preset name of its own.
 */
export function resolveQualityPreset(alias?: string): ContractLookup<string> {
  const found = requireContract();
  if (!found.available) return found;
  const { aliases, default: fallback, presets } = found.value.quality;
  const key = (alias || '').toLowerCase().trim();
  if (key && Object.prototype.hasOwnProperty.call(aliases, key)) {
    return { available: true, value: aliases[key] };
  }
  if (key && presets.includes(key)) return { available: true, value: key };
  return { available: true, value: fallback };
}

export function qualityPresets(): ContractLookup<string[]> {
  const found = requireContract();
  return found.available ? { available: true, value: [...found.value.quality.presets] } : found;
}

export function engineAvailability(): ContractLookup<Record<string, boolean>> {
  const found = requireContract();
  if (!found.available) return found;
  const availability: Record<string, boolean> = {};
  for (const engine of found.value.engines) availability[engine.id] = engine.available;
  return { available: true, value: availability };
}

export function isEngineAvailable(engineId: string): ContractLookup<boolean> {
  const found = requireContract();
  if (!found.available) return found;
  const engine = found.value.engines.find((entry) => entry.id === engineId);
  if (!engine) return { available: false, reason: `Unknown engine: ${engineId}` };
  return { available: true, value: engine.available };
}
