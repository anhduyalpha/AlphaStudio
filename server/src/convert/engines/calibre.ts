import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../../config.js';
import { execFileTracked } from '../../lib/child-registry.js';
import { resolveTool } from '../../tools/registry.js';
import { assertValidOutput } from '../quality.js';
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
  EngineRouteCandidate,
} from './types.js';
import { validateRegisteredOutput } from './validation.js';

const EBOOK_INPUTS = ['epub', 'mobi', 'azw3', 'fb2'];
const EBOOK_OUTPUTS = ['epub', 'mobi', 'azw3', 'fb2', 'txt', 'pdf', 'rtf', 'htmlz'];
const TEXT_INPUTS = ['txt'];
const TEXT_EBOOK_OUTPUTS = ['epub', 'mobi', 'azw3', 'fb2'];

const VERIFIED_STANDARD_INPUTS = new Set([...EBOOK_INPUTS, ...TEXT_INPUTS]);
const VERIFIED_STANDARD_OUTPUTS = new Set(EBOOK_OUTPUTS);

export function parseCalibreFormatHelp(text: string): {
  inputs: Set<string>;
  outputs: Set<string>;
} {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  const source = String(text || '');
  for (const line of source.split(/\r?\n/)) {
    const inputMatch = line.match(/supported\s+input\s+formats?\s*:\s*(.+)$/i);
    const outputMatch = line.match(/supported\s+output\s+formats?\s*:\s*(.+)$/i);
    const target = inputMatch ? inputs : outputMatch ? outputs : null;
    const value = inputMatch?.[1] || outputMatch?.[1] || '';
    if (!target) continue;
    for (const token of value.split(/[\s,;/|]+/)) {
      const normalized = normalizeFormat(token);
      if (/^[a-z0-9]+$/.test(normalized)) target.add(normalized);
    }
  }
  return { inputs, outputs };
}

export function createCalibreEngine(runner: ProbeRunner = runProbeCommand): ConversionEngineAdapter {
  return {
    id: 'calibre',
    name: 'Calibre ebook-convert',
    handler: 'calibre',
    supportedPlatforms: ['win32', 'linux', 'darwin'],
    executableCandidates: ['ebook-convert'],
    profile: 'ebooks',
    approximateInstalledSizeMb: 430,
    defaultWorkerCategory: 'office',
    concurrencyLimit: 1,
    validateOutput: validateRegisteredOutput,
    probe: () => {
      const tool = resolveTool('calibre');
      if (!tool.available) {
        return {
          available: false,
          reason: 'Install the ebooks profile to enable Calibre conversions',
        };
      }
      const result = runner(tool.path, ['--version'], 10_000);
      return {
        available: result.ok,
        executablePath: tool.path,
        version: firstProbeLine(result) || tool.version,
        reason: result.ok
          ? undefined
          : safeProbeReason('Calibre', result, 'ebook-convert is not installed'),
      };
    },
    discoverCapabilities: (probe) => {
      let reported = { inputs: new Set<string>(), outputs: new Set<string>() };
      let helpValid = false;
      if (probe.available && probe.executablePath) {
        const help = runner(probe.executablePath, ['--help'], 10_000);
        reported = parseCalibreFormatHelp(`${help.stdout}\n${help.stderr}`);
        helpValid = help.ok && /ebook-convert|calibre/i.test(`${help.stdout}\n${help.stderr}`);
      }
      // Some Calibre releases do not print a machine-readable format list.
      // In that case, use only AlphaStudio's verified conservative subset after
      // a successful installed-binary help probe.
      const inputs =
        reported.inputs.size > 0
          ? new Set([...reported.inputs].filter((format) => VERIFIED_STANDARD_INPUTS.has(format)))
          : helpValid
            ? VERIFIED_STANDARD_INPUTS
            : new Set<string>();
      const outputs =
        reported.outputs.size > 0
          ? new Set([...reported.outputs].filter((format) => VERIFIED_STANDARD_OUTPUTS.has(format)))
          : helpValid
            ? VERIFIED_STANDARD_OUTPUTS
            : new Set<string>();

      const routes: EngineRouteCandidate[] = [];
      for (const input of EBOOK_INPUTS) {
        for (const output of EBOOK_OUTPUTS) {
          if (input === output) continue;
          const supported = probe.available && inputs.has(input) && outputs.has(output);
          routes.push({
            input,
            output,
            inputFamily: formatFamily(input),
            outputFamily: formatFamily(output),
            priority: 15,
            cost: output === 'txt' ? 'medium' : 'high',
            workerCategory: 'office',
            requiredCompanions: ['calibre'],
            supported,
            reason: supported
              ? undefined
              : `This Calibre build does not report support for ${input} → ${output}`,
          });
        }
      }
      for (const input of TEXT_INPUTS) {
        for (const output of TEXT_EBOOK_OUTPUTS) {
          const supported = probe.available && inputs.has(input) && outputs.has(output);
          routes.push({
            input,
            output,
            inputFamily: formatFamily(input),
            outputFamily: formatFamily(output),
            priority: 30,
            cost: 'high',
            workerCategory: 'office',
            requiredCompanions: ['calibre'],
            supported,
            reason: supported
              ? undefined
              : `This Calibre build does not report support for ${input} → ${output}`,
          });
        }
      }
      return {
        readableFormats: [...inputs],
        writableFormats: [...outputs],
        routes,
        notes: [
          'DRM removal is not supported.',
          'Only AlphaStudio-verified ebook pairs are enabled; no reader/writer cross-product is generated.',
        ],
      };
    },
  };
}

export const calibreEngine = createCalibreEngine();

export async function convertWithCalibre(options: {
  inputPath: string;
  outputDir: string;
  outputFormat: string;
  originalBaseName: string;
  jobId?: string;
  isCancelled?: () => boolean;
  timeoutMs?: number;
  executablePath?: string;
  executor?: typeof execFileTracked;
}): Promise<{ outputPath: string; outputName: string; outputMime: string }> {
  if (looksDrmProtected(options.inputPath)) {
    throw Object.assign(new Error('DRM-protected ebooks are not supported'), {
      code: 'UNSUPPORTED_DRM',
    });
  }
  if (options.isCancelled?.()) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
  const tool = options.executablePath
    ? { available: true, path: options.executablePath }
    : resolveTool('calibre');
  if (!tool.available) throw engineFailure('calibre', 'Calibre became unavailable');

  const format = normalizeFormat(options.outputFormat);
  const ext = `.${format}`;
  const runId = `${String(options.jobId || 'calibre').replace(/[^\w.-]/g, '_')}-${randomBytes(4).toString('hex')}`;
  const isolatedDir = path.join(options.outputDir, `calibre-${runId}`);
  fs.mkdirSync(isolatedDir, { recursive: true });
  const inputExt = path.extname(options.inputPath) || '.epub';
  const isolatedInput = path.join(isolatedDir, `input${inputExt}`);
  const isolatedOutput = path.join(isolatedDir, `output${ext}`);
  fs.copyFileSync(options.inputPath, isolatedInput);

  try {
    await (options.executor || execFileTracked)(tool.path, [isolatedInput, isolatedOutput], {
      jobId: options.jobId,
      timeout: options.timeoutMs ?? 240_000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      cwd: isolatedDir,
      env: restrictedNetworkEnvironment(),
    });
    if (options.isCancelled?.()) {
      throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    }
    validateCalibreDirectory(isolatedDir, isolatedOutput);
    assertValidOutput(isolatedOutput, { label: 'Calibre output', expectedExt: ext });
    assertEbookMagic(isolatedOutput, format);
    const finalPath = path.join(options.outputDir, `calibre-${randomBytes(8).toString('hex')}${ext}`);
    fs.copyFileSync(isolatedOutput, finalPath);
    assertValidOutput(finalPath, { label: 'Calibre output', expectedExt: ext });
    assertEbookMagic(finalPath, format);
    return {
      outputPath: finalPath,
      outputName: `${options.originalBaseName}${ext}`,
      outputMime: formatMime(format),
    };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'CANCELLED' || code === 'UNSUPPORTED_DRM') throw error;
    const message = error instanceof Error ? error.message : 'Calibre conversion failed';
    if (/drm|encrypted book|locked ebook|rights management/i.test(message)) {
      throw Object.assign(new Error('DRM-protected ebooks are not supported'), {
        code: 'UNSUPPORTED_DRM',
      });
    }
    throw engineFailure('calibre', `Calibre conversion failed: ${message.slice(0, 500)}`);
  } finally {
    try {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

function looksDrmProtected(filePath: string): boolean {
  const file = fs.openSync(filePath, 'r');
  try {
    const size = Math.min(fs.fstatSync(file).size, 2 * 1024 * 1024);
    const buffer = Buffer.alloc(size);
    fs.readSync(file, buffer, 0, size, 0);
    const sample = buffer.toString('latin1');
    return /DRMION|adept:encryptedKey|EncryptedData[^>]+drm/i.test(sample);
  } finally {
    fs.closeSync(file);
  }
}

function validateCalibreDirectory(root: string, outputPath: string): void {
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      bytes += fs.statSync(fullPath).size;
      if (files > 64) throw new Error('Calibre produced too many intermediate files');
      if (bytes > config.maxOutputBytes) throw new Error('Calibre output exceeds the configured size limit');
    }
  }
  if (!fs.existsSync(outputPath)) throw new Error('Calibre reported success without an output file');
}

export function assertEbookMagic(filePath: string, format: string): void {
  const normalized = normalizeFormat(format);
  const handle = fs.openSync(filePath, 'r');
  try {
    const size = Math.min(fs.fstatSync(handle).size, 4096);
    const buffer = Buffer.alloc(size);
    fs.readSync(handle, buffer, 0, size, 0);
    if (['epub', 'htmlz'].includes(normalized)) {
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        throw new Error(`Expected ZIP magic for ${normalized}`);
      }
    } else if (['mobi', 'azw3'].includes(normalized)) {
      if (!buffer.toString('latin1').includes('BOOKMOBI')) {
        throw new Error(`Expected BOOKMOBI header for ${normalized}`);
      }
    } else if (normalized === 'fb2') {
      if (!/FictionBook/i.test(buffer.toString('utf8'))) {
        throw new Error('Expected FictionBook XML');
      }
    } else if (normalized === 'pdf') {
      if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('Expected PDF header');
      }
    } else if (normalized === 'rtf') {
      if (!buffer.toString('ascii').trimStart().startsWith('{\\rtf')) {
        throw new Error('Expected RTF header');
      }
    }
  } finally {
    fs.closeSync(handle);
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
