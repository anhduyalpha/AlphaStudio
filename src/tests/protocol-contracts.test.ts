/**
 * Unit tests for `src/protocol/contracts.ts` (PLAN B1, SPEC §3.2 contracts row).
 *
 * The two properties worth pinning are the ones SPEC states as prohibitions:
 *  - the module fetches ONLY through `api/client.js` (mocked here, so a direct
 *    `fetch` would show up as a missing call);
 *  - when capabilities are unreachable or malformed, nothing is invented —
 *    every lookup reports the capability gap instead of a plausible default.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capabilities } = vi.hoisted(() => ({ capabilities: vi.fn() }));

vi.mock('../api/client.js', () => ({ api: { capabilities } }));

const {
  acceptAttributeFor,
  acceptListFor,
  engineAvailability,
  gatedOperation,
  getContractState,
  isEngineAvailable,
  isOperationGated,
  loadContracts,
  parseCapabilities,
  qualityPresets,
  resetContracts,
  resolveQualityPreset,
} = await import('../protocol/contracts.js');

/** A minimal but well-formed `/api/capabilities` body. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    version: '3.6.0',
    detectedAt: '2026-07-26T00:00:00.000Z',
    acceptLists: {
      lists: {
        image: {
          id: 'image',
          label: 'Images',
          families: ['image'],
          extensions: ['.png', '.svg'],
          uploadable: ['.png', '.svg'],
          mimeTypes: ['image/png', 'image/svg+xml'],
        },
        ebook: {
          id: 'ebook',
          label: 'Ebooks',
          families: ['ebook'],
          extensions: ['.epub', '.mobi'],
          uploadable: ['.epub'],
          mimeTypes: ['application/epub+zip'],
        },
      },
      jobTypes: {
        image: { default: 'image', operations: {} },
        pdf: { default: null, operations: { 'from-images': 'image' } },
        security: { default: null, operations: {} },
      },
    },
    gatedOps: [{ id: 'media.transcode', label: 'Transcode', reason: 'ffmpeg not found' }],
    quality: {
      presets: ['fast', 'balanced', 'high'],
      default: 'balanced',
      aliases: { max: 'high', small: 'fast', balanced: 'balanced' },
    },
    converter: {
      engines: [
        { id: 'ffmpeg', name: 'FFmpeg', available: false, reason: 'not installed' },
        { id: 'builtin', name: 'Builtin', available: true, readableFormats: ['png'] },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  resetContracts();
  capabilities.mockReset();
});

describe('loading', () => {
  it('starts idle and fetches through api/client.js', async () => {
    expect(getContractState()).toEqual({ status: 'idle' });
    capabilities.mockResolvedValue(payload());

    const result = await loadContracts();

    expect(capabilities).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ready');
    expect(getContractState().status).toBe('ready');
  });

  it('caches: a second load does not re-request', async () => {
    capabilities.mockResolvedValue(payload());
    await loadContracts();
    await loadContracts();
    expect(capabilities).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    capabilities.mockResolvedValue(payload());
    const [a, b] = await Promise.all([loadContracts(), loadContracts()]);
    expect(capabilities).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('re-requests when refresh is asked for, and passes the flag on', async () => {
    capabilities.mockResolvedValue(payload());
    await loadContracts();
    await loadContracts({ refresh: true });
    expect(capabilities).toHaveBeenCalledTimes(2);
    expect(capabilities).toHaveBeenLastCalledWith({ refresh: true });
  });

  it('reports the gap instead of throwing when the request fails', async () => {
    capabilities.mockRejectedValue(new Error('Network down'));
    const result = await loadContracts();
    expect(result).toEqual({ status: 'unavailable', reason: 'Network down' });
  });

  it('treats a payload missing a published section as unavailable', async () => {
    const { gatedOps, ...withoutGatedOps } = payload();
    void gatedOps;
    capabilities.mockResolvedValue(withoutGatedOps);
    const result = await loadContracts();
    expect(result.status).toBe('unavailable');
  });

  it('rejects a malformed accept list rather than half-trusting it', () => {
    expect(
      parseCapabilities(
        payload({
          acceptLists: {
            lists: { image: { id: 'image', label: 'Images', families: ['image'] } },
            jobTypes: {},
          },
        }),
      ),
    ).toBeNull();
  });
});

describe('accept lists', () => {
  beforeEach(async () => {
    capabilities.mockResolvedValue(payload());
    await loadContracts();
  });

  it('resolves a job type to its published list', () => {
    const found = acceptListFor('image');
    expect(found).toEqual({ available: true, value: expect.objectContaining({ id: 'image' }) });
  });

  it('applies a per-mode override', () => {
    expect(acceptListFor('pdf', 'from-images')).toMatchObject({
      available: true,
      value: { id: 'image' },
    });
  });

  it('distinguishes "unrestricted" from "unknown"', () => {
    expect(acceptListFor('security')).toEqual({ available: true, value: null });
    expect(acceptListFor('pdf')).toEqual({ available: true, value: null });
  });

  it('builds the accept attribute from uploadable extensions, not every known one', () => {
    const found = acceptAttributeFor('image');
    expect(found).toEqual({ available: true, value: '.png,.svg,image/png,image/svg+xml' });
  });

  it('never offers an extension the upload endpoint would refuse', async () => {
    resetContracts();
    capabilities.mockResolvedValue({
      ...payload(),
      acceptLists: {
        lists: payload().acceptLists.lists,
        jobTypes: { ebookish: { default: 'ebook', operations: {} } },
      },
    });
    await loadContracts();
    const found = acceptAttributeFor('ebookish');
    expect(found.available).toBe(true);
    expect(found.available && found.value).not.toContain('.mobi');
    expect(found.available && found.value).toContain('.epub');
  });

  it('an unrestricted type yields an empty accept attribute', () => {
    expect(acceptAttributeFor('security')).toEqual({ available: true, value: '' });
  });
});

describe('gated ops, quality and engines', () => {
  beforeEach(async () => {
    capabilities.mockResolvedValue(payload());
    await loadContracts();
  });

  it('reports a gated operation with the server reason', () => {
    expect(gatedOperation('media.transcode')).toMatchObject({
      available: true,
      value: { id: 'media.transcode', reason: 'ffmpeg not found' },
    });
    expect(isOperationGated('media.transcode')).toEqual({ available: true, value: true });
  });

  it('reports an ungated capability as not gated', () => {
    expect(gatedOperation('image.resize')).toEqual({ available: true, value: null });
    expect(isOperationGated('image.resize')).toEqual({ available: true, value: false });
  });

  it('resolves quality aliases to the server answer', () => {
    expect(resolveQualityPreset('max')).toEqual({ available: true, value: 'high' });
    expect(resolveQualityPreset('MAX')).toEqual({ available: true, value: 'high' });
    expect(resolveQualityPreset('high')).toEqual({ available: true, value: 'high' });
  });

  it('falls back to the published default, never a client-chosen preset', () => {
    expect(resolveQualityPreset('nonsense')).toEqual({ available: true, value: 'balanced' });
    expect(resolveQualityPreset()).toEqual({ available: true, value: 'balanced' });
    expect(qualityPresets()).toEqual({ available: true, value: ['fast', 'balanced', 'high'] });
  });

  it('exposes engine availability', () => {
    expect(engineAvailability()).toEqual({
      available: true,
      value: { ffmpeg: false, builtin: true },
    });
    expect(isEngineAvailable('ffmpeg')).toEqual({ available: true, value: false });
    expect(isEngineAvailable('nope')).toEqual({
      available: false,
      reason: 'Unknown engine: nope',
    });
  });
});

describe('the capability gap — nothing is invented', () => {
  it('every lookup reports the gap before anything is loaded', () => {
    const reason = 'Capabilities have not been loaded yet';
    expect(acceptListFor('image')).toEqual({ available: false, reason });
    expect(acceptAttributeFor('image')).toEqual({ available: false, reason });
    expect(gatedOperation('media.transcode')).toEqual({ available: false, reason });
    expect(isOperationGated('media.transcode')).toEqual({ available: false, reason });
    expect(resolveQualityPreset('max')).toEqual({ available: false, reason });
    expect(qualityPresets()).toEqual({ available: false, reason });
    expect(engineAvailability()).toEqual({ available: false, reason });
    expect(isEngineAvailable('ffmpeg')).toEqual({ available: false, reason });
  });

  it('every lookup reports the gap after a failed fetch, carrying the reason', async () => {
    capabilities.mockRejectedValue(new Error('offline'));
    await loadContracts();
    for (const lookup of [
      acceptListFor('image'),
      acceptAttributeFor('image'),
      gatedOperation('media.transcode'),
      resolveQualityPreset('max'),
      qualityPresets(),
      engineAvailability(),
      isEngineAvailable('ffmpeg'),
    ]) {
      expect(lookup).toEqual({ available: false, reason: 'offline' });
    }
  });

  it('reports the gap when the contract references a list it did not publish', async () => {
    capabilities.mockResolvedValue({
      ...payload(),
      acceptLists: {
        lists: payload().acceptLists.lists,
        jobTypes: { ghost: { default: 'not-published', operations: {} } },
      },
    });
    await loadContracts();
    expect(acceptListFor('ghost')).toEqual({
      available: false,
      reason: 'Published list "not-published" is missing from the contract',
    });
  });
});

describe('no fallback literals (SPEC §3.2)', () => {
  it('the module source declares no format or operation value lists', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, '..', 'protocol', 'contracts.ts'), 'utf8');
    // Strip comments and the JSDoc prose so documentation may name examples.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    const extensionLiteral = /['"`]\.(png|jpe?g|pdf|mp4|mp3|zip|docx?|epub|svg|webp|gif)['"`]/i;
    expect(code).not.toMatch(extensionLiteral);
    expect(code).not.toMatch(/['"`](image\/|audio\/|video\/|application\/)[a-z0-9.+-]+['"`]/i);
    // Quality preset names must come from the server, never be hardcoded here.
    expect(code).not.toMatch(/['"`](fast|balanced|high)['"`]/);
  });
});
