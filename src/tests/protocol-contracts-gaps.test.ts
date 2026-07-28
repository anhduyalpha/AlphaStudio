/**
 * B1 follow-up tests — the cases the spec review found unpinned in
 * `src/protocol/contracts.ts`. Each one is a place where the module could
 * answer a question it does not actually know the answer to, which is the one
 * thing SPEC §3.2's contracts row forbids.
 *
 * Kept in a separate file because test files are write-once in this harness.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mocked `api` object is held by reference so one test can take
// `capabilities` away and prove the untyped-JS boundary fails loudly.
const { capabilities, apiModule } = vi.hoisted(() => {
  const capabilities = vi.fn();
  const apiModule: { capabilities: unknown } = { capabilities };
  return { capabilities, apiModule };
});

vi.mock('../api/client.js', () => ({ api: apiModule }));

const {
  acceptAttributeFor,
  acceptAttributeForList,
  acceptListById,
  acceptListFor,
  engineAvailability,
  getContractState,
  isEngineAvailable,
  isOperationGated,
  gatedOperation,
  loadContracts,
  resetContracts,
} = await import('../protocol/contracts.js');

/**
 * Shaped like the REAL `/api/capabilities` after A3: `mimeTypes` covers every
 * format in the family, including the ones `POST /api/uploads` refuses, so the
 * ebook list's MIME set is wider than its uploadable extension set.
 */
function realisticPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: '3.6.0',
    detectedAt: '2026-07-26T00:00:00.000Z',
    acceptLists: {
      lists: {
        image: {
          id: 'image',
          label: 'Images',
          families: ['image'],
          extensions: ['.gif', '.png'],
          uploadable: ['.gif', '.png'],
          mimeTypes: ['image/gif', 'image/png'],
        },
        ebook: {
          id: 'ebook',
          label: 'Ebooks',
          families: ['ebook'],
          extensions: ['.azw', '.azw3', '.epub', '.fb2', '.htmlz', '.mobi'],
          uploadable: ['.epub'],
          // Every family MIME, including the non-uploadable formats' — and
          // `application/zip`, which htmlz shares with plain archives.
          mimeTypes: [
            'application/epub+zip',
            'application/vnd.amazon.ebook',
            'application/x-fictionbook+xml',
            'application/x-mobipocket-ebook',
            'application/zip',
          ],
        },
      },
      jobTypes: {
        image: { default: 'image', operations: {} },
        pdf: { default: null, operations: { 'from-images': 'image' } },
      },
    },
    gatedOps: [{ id: 'media.transcode', label: 'Transcode', reason: 'ffmpeg not found' }],
    quality: { presets: ['fast', 'high'], default: 'fast', aliases: { max: 'high' } },
    tools: [
      { id: 'media.transcode', label: 'Transcode', available: false, reason: 'ffmpeg not found' },
      { id: 'image.resize', label: 'Resize', available: true },
    ],
    converter: { engines: [{ id: 'builtin', name: 'Builtin', available: true }] },
    ...overrides,
  };
}

beforeEach(() => {
  resetContracts();
  capabilities.mockReset();
  apiModule.capabilities = capabilities;
});

describe('the accept attribute never over-promises (review finding 1)', () => {
  it('omits MIME types when the list is only partly uploadable', async () => {
    capabilities.mockResolvedValue({
      ...realisticPayload(),
      acceptLists: {
        lists: realisticPayload().acceptLists.lists,
        jobTypes: { ebookish: { default: 'ebook', operations: {} } },
      },
    });
    await loadContracts();
    const found = acceptAttributeFor('ebookish');
    expect(found).toEqual({ available: true, value: '.epub' });
    // The dangerous ones specifically: a browser picker matches on MIME too.
    expect(found.available && found.value).not.toContain('application/zip');
    expect(found.available && found.value).not.toContain('mobipocket');
    expect(found.available && found.value).not.toContain('.mobi');
  });

  it('keeps MIME types when every format in the list is uploadable', async () => {
    capabilities.mockResolvedValue(realisticPayload());
    await loadContracts();
    expect(acceptAttributeFor('image')).toEqual({
      available: true,
      value: '.gif,.png,image/gif,image/png',
    });
  });
});

describe('lists are reachable by id, the way hub configs name them (finding 2)', () => {
  beforeEach(async () => {
    capabilities.mockResolvedValue(realisticPayload());
    await loadContracts();
  });

  it('resolves a published list by id', () => {
    expect(acceptListById('ebook')).toMatchObject({ available: true, value: { id: 'ebook' } });
  });

  it('reports a gap for an unpublished id instead of reading as unrestricted', () => {
    expect(acceptListById('does-not-exist')).toEqual({
      available: false,
      reason: 'Published list "does-not-exist" is missing from the contract',
    });
  });

  it('builds an accept attribute straight from a list id', () => {
    expect(acceptAttributeForList('ebook')).toEqual({ available: true, value: '.epub' });
  });
});

describe('absence is never reported as knowledge (finding 3)', () => {
  beforeEach(async () => {
    capabilities.mockResolvedValue(realisticPayload());
    await loadContracts();
  });

  it('an unknown capability id is a gap, not "runnable"', () => {
    expect(isOperationGated('pdf.does-not-exist')).toEqual({
      available: false,
      reason: 'Unknown capability: pdf.does-not-exist',
    });
    expect(gatedOperation('pdf.does-not-exist').available).toBe(false);
  });

  it('a known, ungated capability still answers positively', () => {
    expect(isOperationGated('image.resize')).toEqual({ available: true, value: false });
    expect(isOperationGated('media.transcode')).toEqual({ available: true, value: true });
  });

  it('a missing converter section is "we do not know", not "zero engines"', async () => {
    resetContracts();
    const { converter, ...withoutConverter } = realisticPayload();
    void converter;
    capabilities.mockResolvedValue(withoutConverter);
    await loadContracts();
    expect(getContractState().status).toBe('ready');
    expect(engineAvailability()).toEqual({
      available: false,
      reason: 'Engine availability was not published',
    });
    expect(isEngineAvailable('builtin').available).toBe(false);
  });
});

describe('refresh does not black out a good contract (finding 4)', () => {
  it('keeps serving the cached contract while a refresh is in flight', async () => {
    capabilities.mockResolvedValue(realisticPayload());
    await loadContracts();

    let release: (value: unknown) => void = () => {};
    capabilities.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = loadContracts({ refresh: true });

    expect(getContractState().status).toBe('ready');
    expect(acceptListFor('image').available).toBe(true);

    release(realisticPayload());
    await pending;
    expect(getContractState().status).toBe('ready');
  });

  it('a failed refresh keeps the cached contract and records why', async () => {
    capabilities.mockResolvedValue(realisticPayload());
    await loadContracts();

    capabilities.mockRejectedValueOnce(new Error('probe timed out'));
    const after = await loadContracts({ refresh: true });

    expect(after.status).toBe('ready');
    expect(after.status === 'ready' && after.refreshError).toBe('probe timed out');
    expect(acceptListFor('image').available).toBe(true);
  });

  it('a stale response cannot overwrite a newer one', async () => {
    let releaseSlow: (value: unknown) => void = () => {};
    capabilities.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSlow = resolve;
        }),
    );
    const slow = loadContracts();

    capabilities.mockResolvedValueOnce({ ...realisticPayload(), version: 'newer' });
    await loadContracts({ refresh: true });

    releaseSlow({ ...realisticPayload(), version: 'stale' });
    await slow;

    const state = getContractState();
    expect(state.status === 'ready' && state.contract.version).toBe('newer');
  });

  it('a response that lands after reset does not repopulate the cache', async () => {
    let release: (value: unknown) => void = () => {};
    capabilities.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = loadContracts();
    resetContracts();
    release(realisticPayload());
    await pending;
    expect(getContractState()).toEqual({ status: 'idle' });
  });
});

describe('parser tolerance and normalization (findings 5 and 6)', () => {
  it('does not hard-fail on a list without the server-internal families field', async () => {
    const base = realisticPayload();
    const lists = base.acceptLists.lists as Record<string, Record<string, unknown>>;
    const trimmed: Record<string, unknown> = {};
    for (const [id, list] of Object.entries(lists)) {
      const { families, ...rest } = list;
      void families;
      trimmed[id] = rest;
    }
    capabilities.mockResolvedValue({
      ...base,
      acceptLists: { lists: trimmed, jobTypes: base.acceptLists.jobTypes },
    });
    await loadContracts();
    expect(getContractState().status).toBe('ready');
    expect(acceptListFor('image')).toMatchObject({ available: true, value: { id: 'image' } });
  });

  it('normalizes the job type the same way the server does', async () => {
    capabilities.mockResolvedValue(realisticPayload());
    await loadContracts();
    expect(acceptListFor('IMAGE')).toMatchObject({ available: true, value: { id: 'image' } });
    expect(acceptListFor(' image ')).toMatchObject({ available: true, value: { id: 'image' } });
    expect(acceptListFor('PDF', 'FROM-IMAGES')).toMatchObject({
      available: true,
      value: { id: 'image' },
    });
  });
});

describe('the untyped client boundary fails loudly, not silently', () => {
  it('reports a distinct reason when client.js stops exposing capabilities()', async () => {
    apiModule.capabilities = undefined;
    const result = await loadContracts();
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'api/client.js does not expose capabilities()',
    });
  });

  it('the module never calls fetch directly — client.js owns all HTTP', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, '..', 'protocol', 'contracts.ts'), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/XMLHttpRequest|EventSource|WebSocket/);
    expect(code).not.toMatch(/['"`]\/api\//);
  });
});
