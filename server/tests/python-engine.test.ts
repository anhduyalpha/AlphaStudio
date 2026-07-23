import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectFileQuick } from '../src/convert/detect.js';
import {
  ConversionEngineRegistry,
  conversionRoutes,
  createPythonEngine,
  resolvePythonPath,
  convertWithPython,
  bridgeScriptPath,
} from '../src/convert/engines/index.js';
import type { ProbeRunner } from '../src/convert/engines/probe.js';

const okRunner =
  (line: string): ProbeRunner =>
  () => ({ ok: true, stdout: `${line}\n`, stderr: '', timedOut: false });
const missingRunner: ProbeRunner = () => ({
  ok: false,
  stdout: '',
  stderr: '',
  timedOut: false,
  error: 'spawn python ENOENT',
});
// Reports a valid interpreter for --version and a JSON module map for --selfcheck.
const selfcheckRunner =
  (modules: Record<string, boolean>): ProbeRunner =>
  (_exe, args) =>
    args.includes('--selfcheck')
      ? {
          ok: true,
          stdout: JSON.stringify({ protocol: 1, python: '3.12.4', modules, operations: [] }),
          stderr: '',
          timedOut: false,
        }
      : { ok: true, stdout: 'Python 3.12.4\n', stderr: '', timedOut: false };

describe('python runtime resolution', () => {
  it('accepts Python >= 3.10 and reports the interpreter path', () => {
    const resolved = resolvePythonPath(okRunner('Python 3.12.4'));
    assert.equal(resolved.available, true);
    assert.ok(resolved.path);
    assert.match(String(resolved.version), /3\.12\.4/);
  });

  it('rejects Python below 3.10 with an actionable reason', () => {
    const resolved = resolvePythonPath(okRunner('Python 3.9.18'));
    assert.equal(resolved.available, false);
    assert.match(String(resolved.reason), /3\.10\+ is required/);
  });

  it('reports not-installed when no interpreter responds', () => {
    const resolved = resolvePythonPath(missingRunner);
    assert.equal(resolved.available, false);
    assert.match(String(resolved.reason), /not installed/);
    assert.match(String(resolved.reason), /python:install/);
  });
});

describe('python engine adapter', () => {
  it('probes available/unavailable via the injected runner', () => {
    assert.equal(createPythonEngine(okRunner('Python 3.11.9')).probe().available, true);
    const down = createPythonEngine(missingRunner).probe();
    assert.equal(down.available, false);
    assert.ok(down.reason);
  });

  it('advertises core stdlib data routes and tags each with its operation', () => {
    const engine = createPythonEngine(okRunner('Python 3.12.4'));
    // No executablePath on the probe => selfcheck is skipped; only core routes supported.
    const discovery = engine.discoverCapabilities({ available: true });
    const find = (i: string, o: string) =>
      discovery.routes.find((route) => route.input === i && route.output === o);
    assert.equal(find('json', 'csv')?.metadata?.operation, 'data.json-transform');
    assert.equal(find('json', 'tsv')?.metadata?.operation, 'data.json-transform');
    assert.equal(find('csv', 'json')?.metadata?.operation, 'data.table-transform');
    assert.equal(find('tsv', 'json')?.metadata?.operation, 'data.table-transform');
    for (const [input, output] of [['json', 'csv'], ['json', 'tsv'], ['csv', 'json'], ['tsv', 'json']] as const) {
      assert.equal(find(input, output)?.supported, true, `${input}->${output}`);
    }
    // Heavy routes are advertised but gated off without their profile.
    assert.equal(find('xlsx', 'json')?.supported, false);
    assert.match(String(find('xlsx', 'json')?.reason), /data profile/);
    assert.equal(find('md', 'pdf')?.supported, false);
    assert.ok(discovery.readableFormats.includes('csv'));
    assert.ok(discovery.writableFormats.includes('json'));
  });

  it('marks routes unsupported (with reason) when Python is absent', () => {
    const engine = createPythonEngine(missingRunner);
    const discovery = engine.discoverCapabilities({ available: false, reason: 'nope' });
    assert.ok(discovery.routes.length > 0);
    for (const route of discovery.routes) {
      assert.equal(route.supported, false);
      assert.ok(route.reason);
    }
  });

  it('surfaces json -> csv as an available route through the registry', () => {
    const registry = new ConversionEngineRegistry([createPythonEngine(okRunner('Python 3.12.4'))]);
    const routes = registry.routesFor('json', 'csv');
    assert.equal(routes.length, 1);
    assert.equal(routes[0].engineId, 'python');
    assert.equal(routes[0].available, true);
    assert.equal(routes[0].metadata?.operation, 'data.json-transform');
  });
});

describe('json format detection', () => {
  it('detects .json as format "json" in the text family', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-detect-'));
    try {
      const file = path.join(dir, 'data.json');
      fs.writeFileSync(file, JSON.stringify([{ a: 1 }]));
      const detected = await detectFileQuick(file, 'data.json');
      assert.equal(detected.format, 'json');
      assert.equal(detected.family, 'text');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('convertWithPython', () => {
  it('honors cancellation before spawning the bridge', async () => {
    await assert.rejects(
      convertWithPython({
        inputPath: path.join(os.tmpdir(), 'missing.json'),
        outputDir: os.tmpdir(),
        outputFormat: 'csv',
        operation: 'data.json-transform',
        originalBaseName: 'data',
        isCancelled: () => true,
      }),
      /Cancelled/,
    );
  });

  // Integration: only runs when a real Python 3.10+ interpreter is present.
  const realPython = resolvePythonPath();
  const maybe = realPython.available ? it : it.skip;

  maybe('converts a JSON array to CSV end-to-end via the real bridge', async () => {
    assert.ok(fs.existsSync(bridgeScriptPath()), 'bridge.py should exist');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-convert-'));
    try {
      const input = path.join(dir, 'data.json');
      fs.writeFileSync(input, JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]));
      const result = await convertWithPython({
        inputPath: input,
        outputDir: dir,
        outputFormat: 'csv',
        operation: 'data.json-transform',
        originalBaseName: 'data',
        options: { format: 'csv' },
      });
      assert.equal(result.outputName, 'data.csv');
      assert.equal(result.outputMime, 'text/csv');
      assert.equal(fs.readFileSync(result.outputPath, 'utf8'), 'a,b\n1,x\n2,y\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  maybe('fails cleanly on invalid JSON input', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-badjson-'));
    try {
      const input = path.join(dir, 'bad.json');
      fs.writeFileSync(input, '{not valid');
      await assert.rejects(
        convertWithPython({
          inputPath: input,
          outputDir: dir,
          outputFormat: 'csv',
          operation: 'data.json-transform',
          originalBaseName: 'bad',
          options: { format: 'csv' },
        }),
        /Python conversion failed/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  maybe('routes a JSON upload through processConverter to CSV (full pipeline)', async () => {
    const { processConverter } = await import('../src/processors/converter.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-pipeline-'));
    try {
      const workDir = path.join(dir, 'work');
      const outputDir = path.join(dir, 'out');
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });
      const input = path.join(dir, 'data.json');
      fs.writeFileSync(input, JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]));
      const result = await processConverter({
        jobId: 'python-pipeline',
        inputPaths: [input],
        inputNames: ['data.json'],
        options: { format: 'csv' },
        workDir,
        outputDir,
        onProgress: () => {},
        isCancelled: () => false,
      });
      assert.equal(result.outputMime, 'text/csv');
      assert.match(result.outputName, /\.csv$/);
      assert.equal(fs.readFileSync(result.outputPath, 'utf8'), 'a,b\n1,x\n2,y\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  maybe('default registry advertises an available json -> csv python route', () => {
    const routes = conversionRoutes('json', 'csv');
    const py = routes.find((route) => route.engineId === 'python');
    assert.ok(py, 'python route should be present');
    assert.equal(py?.available, true);
    assert.equal(py?.metadata?.operation, 'data.json-transform');
  });

  maybe('routes a CSV upload through processConverter to JSON (full pipeline)', async () => {
    const { processConverter } = await import('../src/processors/converter.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-csvjson-'));
    try {
      const workDir = path.join(dir, 'work');
      const outputDir = path.join(dir, 'out');
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });
      const input = path.join(dir, 'data.csv');
      fs.writeFileSync(input, 'a,b\n1,x\n2,y\n');
      const result = await processConverter({
        jobId: 'python-csvjson',
        inputPaths: [input],
        inputNames: ['data.csv'],
        options: { format: 'json' },
        workDir,
        outputDir,
        onProgress: () => {},
        isCancelled: () => false,
      });
      assert.equal(result.outputMime, 'application/json');
      assert.match(result.outputName, /\.json$/);
      assert.deepEqual(JSON.parse(fs.readFileSync(result.outputPath, 'utf8')), [
        { a: '1', b: 'x' },
        { a: '2', b: 'y' },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('python phase 2 capability gating', () => {
  const allModules = { pandas: true, openpyxl: true, pyarrow: true, weasyprint: true, markdown: true };
  const findRoute = (
    routes: ReturnType<ReturnType<typeof createPythonEngine>['discoverCapabilities']>['routes'],
    i: string,
    o: string,
  ) => routes.find((route) => route.input === i && route.output === o);

  it('advertises data + document routes when the profile modules are present', () => {
    const engine = createPythonEngine(selfcheckRunner(allModules));
    const discovery = engine.discoverCapabilities(engine.probe());
    assert.equal(findRoute(discovery.routes, 'xlsx', 'json')?.supported, true);
    assert.equal(findRoute(discovery.routes, 'json', 'xlsx')?.supported, true);
    assert.equal(findRoute(discovery.routes, 'parquet', 'json')?.supported, true);
    assert.equal(findRoute(discovery.routes, 'csv', 'parquet')?.supported, true);
    assert.equal(findRoute(discovery.routes, 'md', 'pdf')?.supported, true);
    assert.equal(findRoute(discovery.routes, 'html', 'pdf')?.supported, true);
    // md/html -> pdf must outrank the built-in pdf-lib route (priority 10).
    assert.ok((findRoute(discovery.routes, 'md', 'pdf')?.priority ?? 99) < 10);
    assert.equal(findRoute(discovery.routes, 'xlsx', 'json')?.metadata?.operation, 'data.table-transform');
    assert.equal(findRoute(discovery.routes, 'md', 'pdf')?.metadata?.operation, 'document.to-pdf');
  });

  it('gates heavy routes off when modules are missing but keeps core routes', () => {
    const engine = createPythonEngine(selfcheckRunner({}));
    const discovery = engine.discoverCapabilities(engine.probe());
    assert.equal(findRoute(discovery.routes, 'csv', 'json')?.supported, true);
    assert.equal(findRoute(discovery.routes, 'parquet', 'json')?.supported, false);
    assert.match(String(findRoute(discovery.routes, 'parquet', 'json')?.reason), /data profile/);
    assert.match(String(findRoute(discovery.routes, 'md', 'pdf')?.reason), /documents profile/);
  });

  it('exposes csv -> json (core) and a gated xlsx -> json through a registry', () => {
    const registry = new ConversionEngineRegistry([createPythonEngine(selfcheckRunner({}))]);
    const csvJson = registry.routesFor('csv', 'json');
    assert.equal(csvJson.length, 1);
    assert.equal(csvJson[0].available, true);
    const xlsxJson = registry.routesFor('xlsx', 'json', true);
    assert.equal(xlsxJson.length, 1);
    assert.equal(xlsxJson[0].available, false);
  });
});
