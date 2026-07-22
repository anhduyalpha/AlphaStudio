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
  ConversionCost,
  EngineProbeResult,
  EngineRouteCandidate,
} from './types.js';
import { validateRegisteredOutput } from './validation.js';

/** Optional-profile name surfaced in "install this profile" reasons. */
type PythonProfile = 'core' | 'data' | 'documents';

type PythonRouteSpec = {
  input: string;
  output: string;
  operation: string;
  priority: number;
  cost: ConversionCost;
  /** Python modules that must be importable (empty = works on the core profile). */
  requires: string[];
  profile: PythonProfile;
};

/**
 * Declarative route table. Only pairs that no other engine owns are advertised
 * here (anything <-> JSON, Parquet, and md/html -> pdf via WeasyPrint). csv<->tsv
 * (built-in) and csv<->xlsx/ods (LibreOffice) are deliberately excluded.
 */
const PYTHON_ROUTES: PythonRouteSpec[] = [
  // Phase 1 — core (stdlib)
  { input: 'json', output: 'csv', operation: 'data.json-transform', priority: 20, cost: 'low', requires: [], profile: 'core' },
  { input: 'json', output: 'tsv', operation: 'data.json-transform', priority: 20, cost: 'low', requires: [], profile: 'core' },
  // Phase 2 — data, core (stdlib)
  { input: 'csv', output: 'json', operation: 'data.table-transform', priority: 20, cost: 'low', requires: [], profile: 'core' },
  { input: 'tsv', output: 'json', operation: 'data.table-transform', priority: 20, cost: 'low', requires: [], profile: 'core' },
  // Phase 2 — data, Excel (pandas + openpyxl)
  { input: 'xlsx', output: 'json', operation: 'data.table-transform', priority: 22, cost: 'medium', requires: ['pandas', 'openpyxl'], profile: 'data' },
  { input: 'json', output: 'xlsx', operation: 'data.table-transform', priority: 22, cost: 'medium', requires: ['pandas', 'openpyxl'], profile: 'data' },
  // Phase 2 — data, Parquet (pandas + pyarrow)
  { input: 'parquet', output: 'json', operation: 'data.table-transform', priority: 22, cost: 'medium', requires: ['pandas', 'pyarrow'], profile: 'data' },
  { input: 'parquet', output: 'csv', operation: 'data.table-transform', priority: 22, cost: 'medium', requires: ['pandas', 'pyarrow'], profile: 'data' },
  { input: 'json', output: 'parquet', operation: 'data.table-transform', priority: 22, cost: 'medium', requires: ['pandas', 'pyarrow'], profile: 'data' },
  { input: 'csv', output: 'parquet', operation: 'data.table-transform', priority: 22, cost: 'medium', requires: ['pandas', 'pyarrow'], profile: 'data' },
  // Phase 2 — documents (WeasyPrint). Priority 8 => preferred over the built-in
  // pdf-lib route (priority 10) only when the profile is installed.
  { input: 'html', output: 'pdf', operation: 'document.to-pdf', priority: 8, cost: 'medium', requires: ['weasyprint'], profile: 'documents' },
  { input: 'md', output: 'pdf', operation: 'document.to-pdf', priority: 8, cost: 'medium', requires: ['weasyprint', 'markdown'], profile: 'documents' },
];

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

export type PythonSelfCheck = { modules: Record<string, boolean>; operations: string[] };

/**
 * Ask the bridge which optional modules are importable, so heavier routes are
 * only advertised as available when their profile is genuinely installed.
 * Returns empty capabilities on any failure (routes degrade to unavailable).
 */
export function pythonSelfCheck(executablePath: string, runner: ProbeRunner = runProbeCommand): PythonSelfCheck {
  const result = runner(executablePath, [bridgeScriptPath(), '--selfcheck'], 30_000);
  if (!result.ok) return { modules: {}, operations: [] };
  try {
    const parsed = JSON.parse(String(result.stdout || '').trim()) as {
      modules?: Record<string, boolean>;
      operations?: unknown;
    };
    return {
      modules: parsed.modules && typeof parsed.modules === 'object' ? parsed.modules : {},
      operations: Array.isArray(parsed.operations) ? parsed.operations.map(String) : [],
    };
  } catch {
    return { modules: {}, operations: [] };
  }
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
      const modules =
        probe.available && probe.executablePath
          ? pythonSelfCheck(probe.executablePath, runner).modules
          : {};

      const routes: EngineRouteCandidate[] = PYTHON_ROUTES.map((spec) => {
        const missing = spec.requires.filter((mod) => !modules[mod]);
        const supported = probe.available && missing.length === 0;
        const reason = supported
          ? undefined
          : !probe.available
            ? probe.reason || 'Python runtime is not installed'
            : `Install the ${spec.profile} profile: npm run python:install -- --profile ${spec.profile}`;
        return {
          input: spec.input,
          output: spec.output,
          inputFamily: formatFamily(spec.input),
          outputFamily: formatFamily(spec.output),
          priority: spec.priority,
          cost: spec.cost,
          workerCategory: 'general',
          requiredCompanions: ['python', ...spec.requires],
          supported,
          reason,
          metadata: { operation: spec.operation },
        };
      });

      const supportedRoutes = routes.filter((route) => route.supported);
      return {
        readableFormats: [...new Set(supportedRoutes.map((route) => route.input))],
        writableFormats: [...new Set(supportedRoutes.map((route) => route.output))],
        routes,
        notes: [
          'Deterministic stdlib data conversions (JSON/CSV/TSV) require no third-party packages.',
          'Excel/Parquet need the data profile; Markdown/HTML -> PDF needs the documents profile.',
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
