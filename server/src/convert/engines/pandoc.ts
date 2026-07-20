import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveTool } from '../../tools/registry.js';
import { execFileTracked } from '../../lib/child-registry.js';
import { assertValidOutput } from '../quality.js';
import { assertMagicForFormat } from '../office.js';
import { formatFamily, formatMime, normalizeFormat } from '../formats.js';
import {
  firstProbeLine,
  runProbeCommand,
  safeProbeReason,
  type ProbeRunner,
} from './probe.js';
import { engineFailure } from './errors.js';
import type {
  ConversionEngineAdapter,
  EngineRoute,
  EngineRouteCandidate,
} from './types.js';
import { validateRegisteredOutput } from './validation.js';

const READER_CANDIDATES: Record<string, string[]> = {
  txt: ['plain'],
  md: ['gfm', 'commonmark_x', 'commonmark', 'markdown'],
  html: ['html'],
  rst: ['rst'],
  asciidoc: ['asciidoc'],
};

const WRITER_CANDIDATES: Record<string, string[]> = {
  md: ['gfm', 'commonmark_x', 'commonmark', 'markdown'],
  html: ['html5', 'html'],
  txt: ['plain'],
  rst: ['rst'],
  asciidoc: ['asciidoc'],
  docx: ['docx'],
  rtf: ['rtf'],
};

const SAFE_PAIRS: Record<string, string[]> = {
  txt: ['rst', 'asciidoc', 'docx', 'rtf'],
  md: ['html', 'txt', 'rst', 'asciidoc', 'docx', 'rtf'],
  html: ['md', 'txt', 'rst', 'asciidoc', 'docx', 'rtf'],
  rst: ['md', 'html', 'txt', 'asciidoc', 'docx', 'rtf'],
  asciidoc: ['md', 'html', 'txt', 'rst', 'docx', 'rtf'],
};

export function parsePandocFormatList(text: string): Set<string> {
  return new Set(
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => /^[a-z0-9][a-z0-9_+-]*$/.test(line)),
  );
}

export function pandocSupportsSandbox(versionText: string, helpText = ''): boolean {
  if (/--sandbox\b/.test(helpText)) return true;
  const match = String(versionText || '').match(/pandoc\s+(\d+)\.(\d+)/i);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 11);
}

function firstSupported(available: Set<string>, candidates: string[]): string | undefined {
  return candidates.find((candidate) => available.has(candidate));
}

export function createPandocEngine(runner: ProbeRunner = runProbeCommand): ConversionEngineAdapter {
  return {
    id: 'pandoc',
    name: 'Pandoc',
    handler: 'pandoc',
    supportedPlatforms: ['win32', 'linux', 'darwin'],
    executableCandidates: ['pandoc'],
    profile: 'documents',
    approximateInstalledSizeMb: 190,
    defaultWorkerCategory: 'office',
    concurrencyLimit: 2,
    validateOutput: validateRegisteredOutput,
    probe: () => {
      const tool = resolveTool('pandoc');
      if (!tool.available) {
        return {
          available: false,
          reason: 'Install the documents profile to enable Pandoc markup conversions',
        };
      }
      const result = runner(tool.path, ['--version'], 10_000);
      return {
        available: result.ok,
        executablePath: tool.path,
        version: firstProbeLine(result) || tool.version,
        reason: result.ok
          ? undefined
          : safeProbeReason('Pandoc', result, 'Pandoc is not installed'),
      };
    },
    discoverCapabilities: (probe) => {
      let readers = new Set<string>();
      let writers = new Set<string>();
      let sandbox = false;
      let malformed = false;
      if (probe.available && probe.executablePath) {
        const inputResult = runner(probe.executablePath, ['--list-input-formats'], 10_000);
        const outputResult = runner(probe.executablePath, ['--list-output-formats'], 10_000);
        const helpResult = runner(probe.executablePath, ['--help'], 10_000);
        readers = parsePandocFormatList(inputResult.stdout);
        writers = parsePandocFormatList(outputResult.stdout);
        sandbox = pandocSupportsSandbox(probe.version || '', helpResult.stdout);
        malformed =
          !inputResult.ok ||
          !outputResult.ok ||
          readers.size === 0 ||
          writers.size === 0;
      }

      const routes: EngineRouteCandidate[] = [];
      for (const [input, outputs] of Object.entries(SAFE_PAIRS)) {
        for (const output of outputs) {
          const reader = firstSupported(readers, READER_CANDIDATES[input] || []);
          const writer = firstSupported(writers, WRITER_CANDIDATES[output] || []);
          const supported = probe.available && !malformed && sandbox && Boolean(reader && writer);
          routes.push({
            input,
            output,
            inputFamily: formatFamily(input),
            outputFamily: formatFamily(output),
            priority: ['docx', 'rtf'].includes(output) ? 20 : 40,
            cost: ['docx', 'rtf'].includes(output) ? 'medium' : 'low',
            workerCategory: 'office',
            requiredCompanions: ['pandoc'],
            supported,
            reason: supported
              ? undefined
              : malformed
                ? 'Pandoc returned incomplete or malformed format lists'
                : !sandbox
                  ? 'This Pandoc build does not expose sandboxed conversion'
                  : !reader
                    ? `Pandoc build cannot read ${input}`
                    : `Pandoc build cannot write ${output}`,
            metadata: { reader, writer, sandbox },
          });
        }
      }
      return {
        readableFormats: [...new Set(
          Object.entries(READER_CANDIDATES)
            .filter(([, candidates]) => Boolean(firstSupported(readers, candidates)))
            .map(([format]) => format),
        )],
        writableFormats: [...new Set(
          Object.entries(WRITER_CANDIDATES)
            .filter(([, candidates]) => Boolean(firstSupported(writers, candidates)))
            .map(([format]) => format),
        )],
        routes,
        notes: [
          'Network resources, filters, Lua scripts, and custom resource paths are disabled.',
          'PDF output is not advertised without a separately tested PDF engine.',
        ],
      };
    },
  };
}

export const pandocEngine = createPandocEngine();

export async function convertWithPandoc(options: {
  inputPath: string;
  outputDir: string;
  outputFormat: string;
  route: EngineRoute;
  originalBaseName: string;
  jobId?: string;
  isCancelled?: () => boolean;
  timeoutMs?: number;
  executablePath?: string;
  executor?: typeof execFileTracked;
}): Promise<{ outputPath: string; outputName: string; outputMime: string }> {
  if (options.isCancelled?.()) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
  const tool = options.executablePath
    ? { available: true, path: options.executablePath }
    : resolveTool('pandoc');
  if (!tool.available) throw engineFailure('pandoc', 'Pandoc became unavailable');
  const reader = String(options.route.metadata?.reader || '');
  const writer = String(options.route.metadata?.writer || '');
  if (!reader || !writer || options.route.metadata?.sandbox !== true) {
    throw engineFailure('pandoc', 'Pandoc route is missing a safe reader/writer');
  }
  const format = normalizeFormat(options.outputFormat);
  const ext = format === 'jpeg' ? '.jpg' : `.${format}`;
  const runId = `${String(options.jobId || 'pandoc').replace(/[^\w.-]/g, '_')}-${randomBytes(4).toString('hex')}`;
  const isolatedDir = path.join(options.outputDir, `pandoc-${runId}`);
  fs.mkdirSync(isolatedDir, { recursive: true });
  const inputExt = path.extname(options.inputPath) || '.txt';
  const isolatedInput = path.join(isolatedDir, `input${inputExt}`);
  const isolatedOutput = path.join(isolatedDir, `output${ext}`);
  fs.copyFileSync(options.inputPath, isolatedInput);

  const args = [
    '--sandbox',
    '--from',
    reader,
    '--to',
    writer,
    '--resource-path',
    isolatedDir,
    '--output',
    isolatedOutput,
    isolatedInput,
  ];
  try {
    await (options.executor || execFileTracked)(tool.path, args, {
      jobId: options.jobId,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      cwd: isolatedDir,
      env: restrictedNetworkEnvironment(),
    });
    if (options.isCancelled?.()) {
      throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    }
    assertValidOutput(isolatedOutput, {
      label: 'Pandoc output',
      expectedExt: ext,
    });
    assertMagicForFormat(isolatedOutput, ext);
    const finalPath = path.join(options.outputDir, `pandoc-${randomBytes(8).toString('hex')}${ext}`);
    fs.copyFileSync(isolatedOutput, finalPath);
    assertValidOutput(finalPath, { label: 'Pandoc output', expectedExt: ext });
    assertMagicForFormat(finalPath, ext);
    return {
      outputPath: finalPath,
      outputName: `${options.originalBaseName}${ext}`,
      outputMime: formatMime(format),
    };
  } catch (error) {
    if ((error as { code?: string })?.code === 'CANCELLED') throw error;
    const message = error instanceof Error ? error.message : 'Pandoc conversion failed';
    throw engineFailure('pandoc', `Pandoc conversion failed: ${message.slice(0, 500)}`);
  } finally {
    try {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

function restrictedNetworkEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '',
  };
}
