import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeFormat,
  formatFamily,
  formatFromMime,
  formatMime,
} from '../src/convert/formats.js';
import { detectFileQuick } from '../src/convert/detect.js';
import {
  ConversionEngineRegistry,
  createCalibreEngine,
  createFfmpegEngine,
  createPandocEngine,
  parseCalibreFormatHelp,
  parseFfmpegCapabilities,
  parsePandocFormatList,
  pandocSupportsSandbox,
  convertWithPandoc,
  convertWithCalibre,
  validateRegisteredOutput,
  executeEngineFallback,
  engineFailure,
  type ConversionEngineAdapter,
  type EngineRouteCandidate,
} from '../src/convert/engines/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures', 'converter');
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf8');

describe('converter format normalization', () => {
  it('normalizes extension aliases, MIME types, and families', () => {
    assert.equal(normalizeFormat('.JPG'), 'jpeg');
    assert.equal(normalizeFormat('tif'), 'tiff');
    assert.equal(normalizeFormat('mdown'), 'md');
    assert.equal(normalizeFormat('adoc'), 'asciidoc');
    assert.equal(formatFromMime('application/x-mobipocket-ebook')?.format, 'mobi');
    assert.equal(formatFamily('azw3'), 'ebook');
    assert.equal(formatMime('rst'), 'text/x-rst');
  });

  it('preserves magic/metadata detection for Phase 1 markup and ebook formats', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-detect-'));
    try {
      const samples: Array<[string, Buffer | string, string, string]> = [
        ['notes.rst', 'AlphaStudio\n===========\n', 'rst', 'text'],
        ['notes.adoc', '= AlphaStudio\n\nPhase 1', 'asciidoc', 'text'],
        ['book.fb2', '<?xml version="1.0"?><FictionBook><body/></FictionBook>', 'fb2', 'ebook'],
        ['book.epub', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]), 'epub', 'ebook'],
        ['book.htmlz', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]), 'htmlz', 'ebook'],
      ];
      const mobi = Buffer.alloc(128);
      mobi.write('BOOKMOBI', 60, 'ascii');
      samples.push(['book.mobi', mobi, 'mobi', 'ebook']);
      samples.push(['book.azw3', mobi, 'azw3', 'ebook']);

      for (const [name, contents, format, family] of samples) {
        const filePath = path.join(directory, name);
        fs.writeFileSync(filePath, contents);
        const detected = await detectFileQuick(filePath, name);
        assert.equal(detected.format, format, name);
        assert.equal(detected.family, family, name);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('dynamic engine parsers and safe policy', () => {
  it('parses representative FFmpeg 5/7 capability tables', () => {
    const capabilities = parseFfmpegCapabilities({
      demuxers: fixture('ffmpeg-v5-demuxers.txt'),
      muxers: fixture('ffmpeg-v7-muxers.txt'),
      decoders: fixture('ffmpeg-decoders.txt'),
      encoders: fixture('ffmpeg-encoders.txt'),
    });
    assert.ok(capabilities.demuxers.has('mp4'));
    assert.ok(capabilities.demuxers.has('dshow'));
    assert.ok(capabilities.muxers.has('webm'));
    assert.ok(capabilities.decoders.has('h264'));
    assert.ok(capabilities.encoders.has('libx264'));
  });

  it('advertises only policy-approved FFmpeg paths, never devices or N×M pairs', () => {
    const runner = (_command: string, args: string[]) => {
      const flag = args.at(-1);
      const stdout =
        flag === '-demuxers'
          ? fixture('ffmpeg-v5-demuxers.txt')
          : flag === '-muxers'
            ? fixture('ffmpeg-v7-muxers.txt')
            : flag === '-decoders'
              ? fixture('ffmpeg-decoders.txt')
              : flag === '-encoders'
                ? fixture('ffmpeg-encoders.txt')
                : '';
      return { ok: true, stdout, stderr: '', exitCode: 0, timedOut: false };
    };
    const discovery = createFfmpegEngine(runner).discoverCapabilities({
      available: true,
      executablePath: 'fake-ffmpeg',
      version: 'ffmpeg version 7.1',
    });
    assert.ok(discovery.routes.some((route) => route.input === 'mp4' && route.output === 'webm'));
    assert.ok(!discovery.routes.some((route) => route.input === 'dshow'));
    assert.ok(!discovery.routes.some((route) => route.input === 'mp3' && route.output === 'mp4'));
  });

  it('fails closed for malformed and timed-out FFmpeg probes', () => {
    for (const timedOut of [false, true]) {
      const discovery = createFfmpegEngine(() => ({
        ok: false,
        stdout: timedOut ? fixture('ffmpeg-v5-demuxers.txt') : 'not a table',
        stderr: timedOut ? 'timed out' : 'malformed',
        exitCode: null,
        timedOut,
      })).discoverCapabilities({
        available: true,
        executablePath: 'fake-ffmpeg',
        version: 'ffmpeg version unknown',
      });
      assert.ok(discovery.routes.every((route) => !route.supported));
    }
  });

  it('parses Pandoc lists and requires sandbox support', () => {
    assert.ok(parsePandocFormatList(fixture('pandoc-inputs.txt')).has('commonmark'));
    assert.equal(pandocSupportsSandbox('pandoc 2.10'), false);
    assert.equal(pandocSupportsSandbox('pandoc 3.6.4'), true);
    const runner = (_command: string, args: string[]) => {
      const flag = args.at(-1);
      const stdout =
        flag === '--list-input-formats'
          ? fixture('pandoc-inputs.txt')
          : flag === '--list-output-formats'
            ? fixture('pandoc-outputs.txt')
            : '--sandbox';
      return { ok: true, stdout, stderr: '', exitCode: 0, timedOut: false };
    };
    const discovery = createPandocEngine(runner).discoverCapabilities({
      available: true,
      executablePath: 'fake-pandoc',
      version: 'pandoc 3.6.4',
    });
    assert.ok(discovery.routes.some((route) => route.input === 'md' && route.output === 'docx' && route.supported));
    assert.ok(!discovery.routes.some((route) => route.output === 'pdf'));
    assert.ok(!discovery.routes.some((route) => route.input === 'plain'));
  });

  it('parses Calibre help and keeps a conservative allowlist', () => {
    const parsed = parseCalibreFormatHelp(fixture('calibre-help.txt'));
    assert.ok(parsed.inputs.has('epub'));
    assert.ok(parsed.outputs.has('htmlz'));
    const discovery = createCalibreEngine(() => ({
      ok: true,
      stdout: fixture('calibre-help.txt'),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    })).discoverCapabilities({
      available: true,
      executablePath: 'fake-ebook-convert',
      version: 'ebook-convert 7.20',
    });
    assert.ok(discovery.routes.some((route) => route.input === 'epub' && route.output === 'azw3'));
    assert.ok(!discovery.routes.some((route) => route.input === 'pdf'));
    assert.ok(!discovery.routes.some((route) => route.output === 'docx'));
  });
});

function fakeAdapter(
  id: string,
  priority: number,
  probeCounter: { value: number },
  route: Partial<EngineRouteCandidate> = {},
): ConversionEngineAdapter {
  return {
    id,
    name: id,
    handler: id,
    supportedPlatforms: [process.platform],
    executableCandidates: [],
    profile: 'documents',
    defaultWorkerCategory: 'office',
    concurrencyLimit: 1,
    validateOutput: validateRegisteredOutput,
    probe: () => {
      probeCounter.value += 1;
      return { available: true, version: '1.0' };
    },
    discoverCapabilities: () => ({
      readableFormats: ['md'],
      writableFormats: ['docx'],
      routes: [{
        input: 'md',
        output: 'docx',
        priority,
        cost: 'medium',
        workerCategory: 'office',
        supported: true,
        ...route,
      }],
    }),
  };
}

describe('engine registry union, priority, fallback, and cache', () => {
  it('unions routes and orders deterministic fallback by priority', () => {
    const counter = { value: 0 };
    const registry = new ConversionEngineRegistry([
      fakeAdapter('fallback', 50, counter),
      fakeAdapter('preferred', 10, counter),
    ]);
    const routes = registry.routesFor('markdown', '.DOCX');
    assert.deepEqual(routes.map((route) => route.engineId), ['preferred', 'fallback']);
  });

  it('executes an eligible fallback and records the winning engine', async () => {
    const counter = { value: 0 };
    const registry = new ConversionEngineRegistry([
      fakeAdapter('first', 10, counter),
      fakeAdapter('second', 20, counter),
    ]);
    const calls: string[] = [];
    const executed = await executeEngineFallback(
      registry.routesFor('md', 'docx'),
      async (route) => {
        calls.push(route.engineId);
        if (route.engineId === 'first') {
          throw engineFailure('first', 'synthetic adapter failure');
        }
        return 'converted';
      },
    );
    assert.equal(executed.result, 'converted');
    assert.equal(executed.route.engineId, 'second');
    assert.deepEqual(executed.attemptedEngines, ['first', 'second']);
    assert.deepEqual(calls, ['first', 'second']);
  });

  it('honors TTL and explicit/stamp invalidation', () => {
    let now = 1_000;
    let stamp = 'a';
    const counter = { value: 0 };
    const registry = new ConversionEngineRegistry([fakeAdapter('one', 10, counter)], {
      ttlMs: 100,
      now: () => now,
      stamp: () => stamp,
    });
    registry.getSnapshot();
    registry.getSnapshot();
    assert.equal(counter.value, 1);
    now += 101;
    registry.getSnapshot();
    assert.equal(counter.value, 2);
    stamp = 'b';
    registry.getSnapshot();
    assert.equal(counter.value, 3);
    registry.invalidate();
    registry.getSnapshot();
    assert.equal(counter.value, 4);
  });

  it('degrades a throwing adapter without failing the snapshot', () => {
    const counter = { value: 0 };
    const broken = fakeAdapter('broken', 1, counter);
    broken.probe = () => {
      throw new Error('probe exploded');
    };
    const registry = new ConversionEngineRegistry([
      broken,
      fakeAdapter('healthy', 10, counter),
    ]);
    const snapshot = registry.getSnapshot();
    assert.equal(snapshot.engines.find((engine) => engine.id === 'broken')?.available, false);
    assert.ok(snapshot.routes.some((route) => route.engineId === 'healthy'));
  });
});

describe('registered output validation', () => {
  it('rejects empty/wrong-extension output and accepts a bounded file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-validator-'));
    try {
      const valid = path.join(directory, 'result.txt');
      fs.writeFileSync(valid, 'AlphaStudio');
      validateRegisteredOutput(valid, 'txt');
      const empty = path.join(directory, 'empty.txt');
      fs.writeFileSync(empty, '');
      assert.throws(() => validateRegisteredOutput(empty, 'txt'), /empty/i);
      assert.throws(() => validateRegisteredOutput(valid, 'pdf'), /extension/i);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('isolated Pandoc and Calibre execution adapters', () => {
  it('builds Pandoc argument arrays, validates output, and cleans intermediates', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pandoc-adapter-'));
    try {
      const input = path.join(directory, 'input.md');
      fs.writeFileSync(input, '# AlphaStudio');
      let capturedArgs: string[] = [];
      const result = await convertWithPandoc({
        inputPath: input,
        outputDir: directory,
        outputFormat: 'docx',
        originalBaseName: 'output',
        executablePath: 'fake-pandoc',
        route: {
          input: 'md',
          output: 'docx',
          priority: 20,
          cost: 'medium',
          workerCategory: 'office',
          engineId: 'pandoc',
          engineName: 'Pandoc',
          handler: 'pandoc',
          profile: 'documents',
          available: true,
          metadata: { reader: 'gfm', writer: 'docx', sandbox: true },
        },
        executor: async (_command, args) => {
          capturedArgs = [...args];
          const output = args[args.indexOf('--output') + 1];
          fs.writeFileSync(output, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
          return { stdout: '', stderr: '' };
        },
      });
      assert.ok(fs.existsSync(result.outputPath));
      assert.equal(result.outputName, 'output.docx');
      assert.ok(capturedArgs.includes('--sandbox'));
      assert.ok(capturedArgs.includes('--resource-path'));
      assert.ok(!capturedArgs.some((arg) => /https?:/i.test(arg)));
      assert.equal(
        fs.readdirSync(directory).some((name) => name.startsWith('pandoc-pandoc-')),
        false,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('maps Pandoc timeout/false-success and cancellation safely', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pandoc-errors-'));
    const input = path.join(directory, 'input.md');
    fs.writeFileSync(input, '# AlphaStudio');
    const route = {
      input: 'md',
      output: 'html',
      priority: 40,
      cost: 'low' as const,
      workerCategory: 'office' as const,
      engineId: 'pandoc',
      engineName: 'Pandoc',
      handler: 'pandoc',
      profile: 'documents' as const,
      available: true,
      metadata: { reader: 'gfm', writer: 'html5', sandbox: true },
    };
    try {
      await assert.rejects(
        convertWithPandoc({
          inputPath: input,
          outputDir: directory,
          outputFormat: 'html',
          originalBaseName: 'output',
          executablePath: 'fake-pandoc',
          route,
          executor: async () => {
            throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
          },
        }),
        /Pandoc conversion failed.*timed out/i,
      );
      await assert.rejects(
        convertWithPandoc({
          inputPath: input,
          outputDir: directory,
          outputFormat: 'html',
          originalBaseName: 'output',
          executablePath: 'fake-pandoc',
          route,
          executor: async () => ({ stdout: '', stderr: '' }),
        }),
        /file does not exist/i,
      );
      await assert.rejects(
        convertWithPandoc({
          inputPath: input,
          outputDir: directory,
          outputFormat: 'html',
          originalBaseName: 'output',
          executablePath: 'fake-pandoc',
          route,
          isCancelled: () => true,
        }),
        /Cancelled/,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('validates Calibre outputs and returns explicit DRM/cancellation errors', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calibre-adapter-'));
    try {
      const input = path.join(directory, 'input.txt');
      fs.writeFileSync(input, 'AlphaStudio ebook fixture');
      const result = await convertWithCalibre({
        inputPath: input,
        outputDir: directory,
        outputFormat: 'epub',
        originalBaseName: 'book',
        executablePath: 'fake-ebook-convert',
        executor: async (_command, args) => {
          fs.writeFileSync(args[1], Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
          return { stdout: '', stderr: '' };
        },
      });
      assert.equal(result.outputName, 'book.epub');
      assert.ok(fs.existsSync(result.outputPath));

      const drm = path.join(directory, 'drm.epub');
      fs.writeFileSync(drm, 'PK\u0003\u0004 adept:encryptedKey DRMION');
      await assert.rejects(
        convertWithCalibre({
          inputPath: drm,
          outputDir: directory,
          outputFormat: 'txt',
          originalBaseName: 'drm',
          executablePath: 'fake-ebook-convert',
        }),
        (error: any) => error?.code === 'UNSUPPORTED_DRM',
      );
      await assert.rejects(
        convertWithCalibre({
          inputPath: input,
          outputDir: directory,
          outputFormat: 'epub',
          originalBaseName: 'book',
          executablePath: 'fake-ebook-convert',
          isCancelled: () => true,
        }),
        /Cancelled/,
      );
      await assert.rejects(
        convertWithCalibre({
          inputPath: input,
          outputDir: directory,
          outputFormat: 'epub',
          originalBaseName: 'book',
          executablePath: 'fake-ebook-convert',
          executor: async () => {
            throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
          },
        }),
        /Calibre conversion failed.*timed out/i,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
