import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../../config.js';
import { execFileTracked } from '../../lib/child-registry.js';
import { projectRoot, runtimeDir } from '../../tools/registry.js';
import { assertValidOutput } from '../quality.js';
import { formatFamily, formatMime, normalizeFormat } from '../formats.js';
import { firstProbeLine, runProbeCommand, type ProbeRunner } from './probe.js';
import { engineFailure } from './errors.js';
import type {
  ConversionEngineAdapter,
  EngineProbeResult,
  EngineRouteCandidate,
} from './types.js';
import { validateRegisteredOutput } from './validation.js';

/** Phase 1 deterministic, stdlib-only operations advertised by the Python engine. */
const JSON_OUTPUTS = ['csv', 'tsv'] as const;
const JSON_TRANSFORM_OPERATION = 'data.json-transform';

/** Absolute path to the one-shot CLI bridge invoked for every Python job. */
export function bridgeScriptPath(): string {
  return path.join(projectRoot, 'python', 'bridge.py');
}

/** Managed virtualenv interpreter for the current platform/arch (may not exist). */
export function venvPythonPath(): string {
  const base = path.join(runtimeDir, 'python', `${process.platform}-${process.arch}`, 'venv');
  return process.platform === 'win32'
    ? path.join(base, 'Scripts', 'python.exe')
    : path.join(base, 'bin', 'python');
}

function parsePythonVersion(version: string | undefined): { major: number; minor: number } | null {
  const match = /Python\s+(\d+)\.(\d+)/i.exec(version || '');
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Resolve a Python >= 3.10 interpreter. Prefers the managed venv, then falls
 * back to `python3` / `python` on PATH. Never throws — callers gate on
 * `available` (matches the Calibre/optional-binaries degradation pattern).
 */
export function resolvePythonPath(runner: ProbeRunner = runProbeCommand): {
  available: boolean;
  path?: string;
  version?: string;
  reason?: string;
} {
  const candidates: string[] = [];
  const venv = venvPythonPath();
  if (fs.existsSync(venv)) candidates.push(venv);
  candidates.push('python3', 'python');

  let sawInterpreter = false;
  for (const candidate of candidates) {
    const result = runner(candidate, ['--version'], 30_000);
    if (!result.ok) continue;
    const version = firstProbeLine(result);
    const parsed = parsePythonVersion(version);
    if (!parsed) continue;
    sawInterpreter = true;
    if (parsed.major > 3 || (parsed.major === 3 && parsed.minor >= 10)) {
      return { available: true, path: candidate, version };
    }
  }
  return {
    available: false,
    reason: sawInterpreter
      ? 'Python 3.10+ is required. Run: npm run python:install'
      : 'Python 3.10+ is not installed. Run: npm run python:install',
  };
}

export function createPythonEngine(runner: ProbeRunner = runProbeCommand): ConversionEngineAdapter {
  return {
    id: 'python',
    name: 'Python Runtime',
    handler: 'python',
    supportedPlatforms: ['win32', 'linux', 'darwin'],
    executableCandidates: ['python3', 'python'],
    profile: 'documents',
    approximateInstalledSizeMb: 50,
    defaultWorkerCategory: 'general',
    concurrencyLimit: 2,
    validateOutput: validateRegisteredOutput,
    probe: (): EngineProbeResult => {
      const resolved = resolvePythonPath(runner);
      return resolved.available
        ? { available: true, executablePath: resolved.path, version: resolved.version }
        : { available: false, reason: resolved.reason };
    },
    discoverCapabilities: (probe) => {
      const routes: EngineRouteCandidate[] = JSON_OUTPUTS.map((output) => ({
        input: 'json',
        output,
        inputFamily: formatFamily('json'),
        outputFamily: formatFamily(output),
        priority: 20,
        cost: 'low',
        workerCategory: 'general',
        requiredCompanions: ['python'],
        supported: probe.available,
        reason: probe.available ? undefined : probe.reason || 'Python runtime is not installed',
        metadata: { operation: JSON_TRANSFORM_OPERATION },
      }));
      return {
        readableFormats: ['json'],
        writableFormats: [...JSON_OUTPUTS],
        routes,
        notes: [
          'Deterministic stdlib JSON to CSV/TSV. No third-party Python packages required.',
          'Network access is disabled for the bridge process.',
        ],
      };
    },
  };
}

export const pythonEngine = createPythonEngine();

type BridgeArtifact = { name: string; mime: string; path: string };
type BridgeResult = { outputs: BridgeArtifact[]; meta?: Record<string, unknown> };

function parseBridgeResult(stdout: string): BridgeResult {
  const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw engineFailure('python', 'Python bridge returned malformed output');
  }
  const outputs = (parsed as { outputs?: unknown }).outputs;
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw engineFailure('python', 'Python bridge returned no output');
  }
  return parsed as BridgeResult;
}

/** Deny outbound network for the bridge (defense in depth; bridge makes no calls). */
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

/**
 * Run one Python-backed conversion via the CLI bridge. Mirrors the Calibre/Pandoc
 * one-shot pattern: isolate a work directory, invoke `execFileTracked` (killable,
 * timed, no shell), then copy the confined output to a flat name in `outputDir`.
 */
export async function convertWithPython(options: {
  inputPath: string;
  outputDir: string;
  outputFormat: string;
  operation: string;
  originalBaseName: string;
  jobId?: string;
  isCancelled?: () => boolean;
  timeoutMs?: number;
  options?: Record<string, unknown>;
  executor?: typeof execFileTracked;
}): Promise<{ outputPath: string; outputName: string; outputMime: string }> {
  if (options.isCancelled?.()) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
  const python = resolvePythonPath();
  if (!python.available || !python.path) {
    throw engineFailure('python', python.reason || 'Python runtime became unavailable');
  }

  const format = normalizeFormat(options.outputFormat);
  const ext = `.${format}`;
  const runId = `${String(options.jobId || 'python').replace(/[^\w.-]/g, '_')}-${randomBytes(4).toString('hex')}`;
  const isolatedDir = path.join(options.outputDir, `python-${runId}`);
  fs.mkdirSync(isolatedDir, { recursive: true });

  try {
    const args = [
      bridgeScriptPath(),
      '--operation', options.operation,
      '--input', options.inputPath,
      '--input-name', path.basename(options.inputPath),
      '--output-dir', isolatedDir,
      '--options', JSON.stringify({ ...(options.options || {}), format }),
      '--limits', JSON.stringify({
        maxOutputBytes: config.maxOutputBytes,
        maxMemoryMb: config.pythonMaxMemoryMb,
      }),
    ];
    const { stdout } = await (options.executor || execFileTracked)(python.path, args, {
      jobId: options.jobId,
      timeout: options.timeoutMs ?? config.pythonTimeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      cwd: isolatedDir,
      env: restrictedNetworkEnvironment(),
    });
    if (options.isCancelled?.()) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });

    const artifact = parseBridgeResult(stdout).outputs[0];
    const producedPath = path.join(isolatedDir, artifact.name);
    assertValidOutput(producedPath, { label: 'Python output', expectedExt: ext });

    const finalPath = path.join(options.outputDir, `python-${randomBytes(8).toString('hex')}${ext}`);
    fs.copyFileSync(producedPath, finalPath);
    assertValidOutput(finalPath, { label: 'Python output', expectedExt: ext });
    return {
      outputPath: finalPath,
      outputName: `${options.originalBaseName}${ext}`,
      outputMime: artifact.mime || formatMime(format),
    };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'CANCELLED') throw error;
    const message = error instanceof Error ? error.message : 'Python conversion failed';
    throw engineFailure('python', `Python conversion failed: ${message.slice(0, 500)}`);
  } finally {
    try {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
