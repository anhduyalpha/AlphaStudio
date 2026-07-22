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

  it('advertises json -> csv/tsv routes tagged with the operation id', () => {
    const engine = createPythonEngine(okRunner('Python 3.12.4'));
    const discovery = engine.discoverCapabilities({ available: true });
    assert.deepEqual(discovery.readableFormats, ['json']);
    assert.deepEqual([...discovery.writableFormats].sort(), ['csv', 'tsv']);
    for (const route of discovery.routes) {
      assert.equal(route.input, 'json');
      assert.equal(route.supported, true);
      assert.equal(route.workerCategory, 'general');
      assert.equal(route.metadata?.operation, 'data.json-transform');
    }
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
});
