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
  /**
   * `null` when the payload published no engine section — "we do not know",
   * which is not the same answer as "there are no engines".
   */
  engines: EngineStatus[] | null;
  /**
   * Every capability id the server published, so an id that exists nowhere can
   * be reported as unknown rather than as "not gated, go ahead". `null` when
   * the payload carried no inventory.
   */
  capabilityIds: string[] | null;
  /** Whole payload, for the sections this module does not model. */
  raw: Record<string, unknown>;
};

export type ContractState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      contract: CapabilityContract;
      fetchedAt: number;
      /** Set when a later `refresh` failed and this cached contract was kept. */
      refreshError?: string;
    }
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
  const extensions = stringArray(value.extensions);
  const uploadable = stringArray(value.uploadable);
  const mimeTypes = stringArray(value.mimeTypes);
  if (!extensions || !uploadable || !mimeTypes) return null;
  // `families` is server-internal metadata no selector reads — tolerate its
  // absence rather than blacking the whole app out over a field we ignore.
  const families = stringArray(value.families) || [];
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

/** `null` when no engine section was published — unknown, not empty. */
function parseEngines(value: unknown): EngineStatus[] | null {
  if (!isRecord(value) || !Array.isArray(value.engines)) return null;
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
    capabilityIds: parseCapabilityIds(payload.tools),
    raw: payload,
  };
}

/** The full capability inventory (`tools`), or `null` when not published. */
function parseCapabilityIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.id === 'string') ids.push(entry.id);
  }
  return ids.length > 0 ? ids : null;
}

/* ---------------------------------------------------------------- *
 * Fetch + cache.
 * ---------------------------------------------------------------- */

let state: ContractState = { status: 'idle' };
let inFlight: Promise<ContractState> | null = null;
/** Bumped per request and on reset, so a stale response can never win. */
let generation = 0;

export function getContractState(): ContractState {
  return state;
}

/** Drop the cache — workspace teardown, and test isolation. */
export function resetContracts(): void {
  generation += 1;
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
 *
 * A refresh keeps serving the cached contract until the new one lands, and
 * keeps it if the refresh fails (recording `refreshError`). Re-probing tools
 * server-side can take seconds; blacking every hub out for that window — or
 * permanently, on a failed re-probe — would be worse than a slightly stale
 * contract. Responses are generation-checked, so a slow reply can never
 * overwrite a newer one or repopulate a cache that was reset underneath it.
 */
export function loadContracts(options: { refresh?: boolean } = {}): Promise<ContractState> {
  const refresh = options.refresh === true;
  if (!refresh && state.status === 'ready') return Promise.resolve(state);
  if (inFlight && !refresh) return inFlight;

  generation += 1;
  const mine = generation;
  const cached = state.status === 'ready' ? state : null;
  if (!cached) state = { status: 'loading' };

  const settle = (next: ContractState): ContractState => {
    if (mine !== generation) return state;
    state = next;
    if (inFlight === request) inFlight = null;
    return state;
  };

  // Invoked synchronously, not deferred onto a microtask: the request must be
  // in flight by the time `loadContracts` returns, so callers (and tests) can
  // rely on ordering. A synchronous throw is folded into the same failure path.
  let response: Promise<unknown>;
  try {
    if (typeof client.capabilities !== 'function') {
      throw new Error('api/client.js does not expose capabilities()');
    }
    response = Promise.resolve(client.capabilities(refresh ? { refresh: true } : undefined));
  } catch (error) {
    response = Promise.reject(error);
  }

  const request: Promise<ContractState> = response
    .then((payload) => {
      const contract = parseCapabilities(payload);
      if (contract) return settle({ status: 'ready', contract, fetchedAt: Date.now() });
      const reason = 'The capabilities endpoint did not publish a usable contract';
      return settle(cached ? { ...cached, refreshError: reason } : { status: 'unavailable', reason });
    })
    .catch((error: unknown) => {
      const reason = failureReason(error);
      return settle(cached ? { ...cached, refreshError: reason } : { status: 'unavailable', reason });
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

const normalize = (value: string | undefined): string => (value || '').toLowerCase().trim();

/**
 * A published list by id — how hub configs name one (SPEC §3.4 `acceptFrom`).
 * An unpublished id is a gap, never a silent "no filter".
 */
export function acceptListById(listId: string): ContractLookup<AcceptList> {
  const found = requireContract();
  if (!found.available) return found;
  const list = found.value.acceptLists.lists[listId];
  if (!list) {
    return { available: false, reason: `Published list "${listId}" is missing from the contract` };
  }
  return { available: true, value: list };
}

/** The named list a job type/mode accepts. `value: null` = unrestricted. */
export function acceptListFor(
  jobType: string,
  operation?: string,
): ContractLookup<AcceptList | null> {
  const found = requireContract();
  if (!found.available) return found;
  // Normalized exactly as the server normalizes it in `acceptListIdForJob`,
  // so the client's answer cannot drift from create-time enforcement.
  const rule = found.value.acceptLists.jobTypes[normalize(jobType)];
  if (!rule) return { available: true, value: null };
  const op = normalize(operation);
  const listId =
    op && Object.prototype.hasOwnProperty.call(rule.operations, op)
      ? rule.operations[op]
      : rule.default;
  if (listId === null || listId === undefined) return { available: true, value: null };
  return acceptListById(listId);
}

/**
 * Build a file-input `accept` value from a list.
 *
 * Extensions come from `uploadable` only. MIME types are included **only when
 * every format in the list is uploadable** — the published `mimeTypes` covers
 * the whole family, so on a partly-uploadable list (ebook: `.epub` uploadable,
 * `.mobi`/`.htmlz` not) it still carries `application/x-mobipocket-ebook` and
 * `application/zip`. A browser picker matches on MIME as well as extension, so
 * emitting those would offer the user a file the very next upload refuses.
 * Extensions alone are always safe.
 *
 * (The tighter fix — the server publishing an uploadable-only MIME subset —
 * belongs to a unit that may touch `server/src/convert/formats.ts`.)
 */
function acceptAttribute(list: AcceptList): string {
  const fullyUploadable = list.uploadable.length === list.extensions.length;
  const parts = fullyUploadable ? [...list.uploadable, ...list.mimeTypes] : [...list.uploadable];
  return parts.join(',');
}

/** The `accept` attribute for a job type/mode. Empty string = unrestricted. */
export function acceptAttributeFor(jobType: string, operation?: string): ContractLookup<string> {
  const found = acceptListFor(jobType, operation);
  if (!found.available) return found;
  if (!found.value) return { available: true, value: '' };
  return { available: true, value: acceptAttribute(found.value) };
}

/** The `accept` attribute for a list named directly by id. */
export function acceptAttributeForList(listId: string): ContractLookup<string> {
  const found = acceptListById(listId);
  return found.available ? { available: true, value: acceptAttribute(found.value) } : found;
}

/**
 * `value: null` = the capability is known and not gated on this machine.
 *
 * `gatedOps` lists only the UNAVAILABLE capabilities, so membership alone
 * cannot tell "runnable" from "no such capability". When the payload also
 * publishes the full inventory (`tools`), an id missing from it is reported as
 * a gap — otherwise a typo'd or removed capability id would render a mode
 * enabled and fail at job-create instead of showing the install-hint state.
 */
export function gatedOperation(capabilityId: string): ContractLookup<GatedOperation | null> {
  const found = requireContract();
  if (!found.available) return found;
  const gated = found.value.gatedOps.find((entry) => entry.id === capabilityId);
  if (gated) return { available: true, value: gated };
  const inventory = found.value.capabilityIds;
  if (inventory && !inventory.includes(capabilityId)) {
    return { available: false, reason: `Unknown capability: ${capabilityId}` };
  }
  return { available: true, value: null };
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

const ENGINES_UNPUBLISHED = 'Engine availability was not published';

export function engineAvailability(): ContractLookup<Record<string, boolean>> {
  const found = requireContract();
  if (!found.available) return found;
  // An absent engine section is "we do not know", never "there are none".
  if (!found.value.engines) return { available: false, reason: ENGINES_UNPUBLISHED };
  const availability: Record<string, boolean> = {};
  for (const engine of found.value.engines) availability[engine.id] = engine.available;
  return { available: true, value: availability };
}

export function isEngineAvailable(engineId: string): ContractLookup<boolean> {
  const found = requireContract();
  if (!found.available) return found;
  if (!found.value.engines) return { available: false, reason: ENGINES_UNPUBLISHED };
  const engine = found.value.engines.find((entry) => entry.id === engineId);
  if (!engine) return { available: false, reason: `Unknown engine: ${engineId}` };
  return { available: true, value: engine.available };
}
