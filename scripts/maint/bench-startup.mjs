#!/usr/bin/env node
/**
 * Measure AlphaStudio server startup and optional upload-detect latency.
 *
 * Usage:
 *   node scripts/maint/bench-startup.mjs [out.json]
 *   node scripts/maint/bench-startup.mjs --out path/to/report.json
 *   node scripts/maint/bench-startup.mjs --out report.json --upload path/to/file.png
 *   node scripts/maint/bench-startup.mjs --help
 *
 * Metrics:
 *   - coldStartMs: spawn → GET /api/health 200 (fresh DATA_DIR)
 *   - warmRestartMs: kill + re-spawn against same DATA_DIR → health 200
 *   - uploadDetectMs (optional): POST /api/uploads and time until response (includes detect)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './lib/platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    out: null,
    upload: null,
    port: null,
    healthTimeoutMs: 45_000,
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--upload' || a === '-u') args.upload = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--timeout-ms') args.healthTimeoutMs = Number(argv[++i]);
    else if (!a.startsWith('-')) rest.push(a);
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!args.out && rest[0]) args.out = rest[0];
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(base, timeoutMs) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2000);
      const res = await fetch(`${base}/api/health`, { signal: ac.signal });
      clearTimeout(t);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: true, ms: Date.now() - start, body, status: res.status };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(100);
  }
  return { ok: false, ms: Date.now() - start, error: lastErr || 'timeout' };
}

function resolveServerEntry() {
  const tsxCli = [
    path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(projectRoot, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ].find((p) => fs.existsSync(p)) || path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const src = path.join(projectRoot, 'server', 'src', 'index.ts');
  const dist = path.join(projectRoot, 'server', 'dist', 'index.js');
  if (fs.existsSync(tsxCli) && fs.existsSync(src)) {
    return { cmd: process.execPath, args: [tsxCli, 'src/index.ts'], cwd: path.join(projectRoot, 'server') };
  }
  if (fs.existsSync(dist)) {
    return { cmd: process.execPath, args: [dist], cwd: path.join(projectRoot, 'server') };
  }
  throw new Error('No server entry (need server/src/index.ts + tsx, or server/dist/index.js)');
}

function startServer({ port, dataDir, dbPath, logFile }) {
  const entry = resolveServerEntry();
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    DB_PATH: dbPath,
    LOG_LEVEL: process.env.BENCH_LOG_LEVEL || 'error',
    CORS_ORIGIN: 'http://localhost:5173',
  };

  const child = spawn(entry.cmd, entry.args, {
    cwd: entry.cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const onData = (d) => {
    const s = d.toString();
    output += s;
    if (logFile) {
      try {
        fs.appendFileSync(logFile, s);
      } catch {
        /* ignore */
      }
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  return {
    child,
    base: `http://127.0.0.1:${port}`,
    getOutput: () => output,
    async stop() {
      if (child.exitCode != null) return;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      const deadline = Date.now() + 5000;
      while (child.exitCode == null && Date.now() < deadline) {
        await sleep(50);
      }
      if (child.exitCode == null) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
      await sleep(100);
    },
  };
}

async function multipartUpload(base, filePath) {
  const name = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  const boundary = `----bench${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, buf, tail]);
  const t0 = Date.now();
  const res = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ms, json };
}

function pickPort(explicit) {
  if (explicit && Number.isFinite(explicit)) return explicit;
  return 19000 + Math.floor(Math.random() * 1000);
}

function defaultUploadFixture() {
  const candidates = [
    path.join(projectRoot, 'fixtures', 'samples', 'sample.png'),
    path.join(projectRoot, 'fixtures', 'samples', 'sample.txt'),
    // legacy local-only path (gitignored audit/); keep as last resort
    path.join(projectRoot, 'audit', 'fixtures', 'sample.png'),
    path.join(projectRoot, 'audit', 'fixtures', 'sample.txt'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/maint/bench-startup.mjs [out.json] [--upload file] [--port N]

Measures cold start and warm restart to GET /api/health.
Optional --upload times POST /api/uploads (includes server-side detect).

Writes JSON report to --out / first positional path (required for CI).
`);
    process.exit(0);
  }

  const outPath = args.out
    ? path.isAbsolute(args.out)
      ? args.out
      : path.resolve(process.cwd(), args.out)
    : null;
  if (!outPath) {
    console.error('Error: output path required (positional or --out)');
    process.exit(2);
  }

  const port = pickPort(args.port);
  const benchRoot = path.join(projectRoot, 'tmp', `bench-startup-${process.pid}-${Date.now()}`);
  const dataDir = path.join(benchRoot, 'data');
  const dbPath = path.join(dataDir, 'bench.db');
  const logFile = path.join(benchRoot, 'server.log');
  fs.mkdirSync(dataDir, { recursive: true });

  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    port,
    dataDir,
    node: process.version,
    platform: process.platform,
    coldStartMs: null,
    warmRestartMs: null,
    uploadDetectMs: null,
    upload: null,
    health: {},
    errors: [],
  };

  let server = null;

  try {
    // ── Cold start ──────────────────────────────────────────────────────────
    const coldT0 = Date.now();
    server = startServer({ port, dataDir, dbPath, logFile });
    const coldHealth = await waitHealth(server.base, args.healthTimeoutMs);
    report.coldStartMs = coldHealth.ok ? coldHealth.ms : Date.now() - coldT0;
    report.health.cold = coldHealth;
    if (!coldHealth.ok) {
      report.errors.push(`cold health failed: ${coldHealth.error || 'unknown'}`);
      throw new Error(report.errors[0]);
    }

    // ── Optional upload detect ──────────────────────────────────────────────
    const uploadPath = args.upload
      ? path.resolve(args.upload)
      : process.env.BENCH_UPLOAD || defaultUploadFixture();
    if (uploadPath && fs.existsSync(uploadPath)) {
      const up = await multipartUpload(server.base, uploadPath);
      report.uploadDetectMs = up.ms;
      report.upload = {
        path: uploadPath,
        status: up.status,
        id: up.json?.id || up.json?.file?.id || null,
        hasDetect: Boolean(up.json?.detect || up.json?.detectJson),
        family: up.json?.detect?.family || up.json?.family || null,
        format: up.json?.detect?.format || up.json?.format || null,
      };
      if (up.status >= 400) {
        report.errors.push(`upload returned HTTP ${up.status}`);
      }
    }

    // ── Warm restart (same DATA_DIR) ────────────────────────────────────────
    await server.stop();
    server = null;
    await sleep(200);

    const warmT0 = Date.now();
    server = startServer({ port, dataDir, dbPath, logFile });
    const warmHealth = await waitHealth(server.base, args.healthTimeoutMs);
    report.warmRestartMs = warmHealth.ok ? warmHealth.ms : Date.now() - warmT0;
    report.health.warm = warmHealth;
    if (!warmHealth.ok) {
      report.errors.push(`warm health failed: ${warmHealth.error || 'unknown'}`);
      throw new Error(report.errors[0]);
    }

    report.ok = report.errors.length === 0;
  } catch (e) {
    report.ok = false;
    report.errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    if (server) {
      try {
        await server.stop();
      } catch {
        /* ignore */
      }
    }
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          out: outPath,
          coldStartMs: report.coldStartMs,
          warmRestartMs: report.warmRestartMs,
          uploadDetectMs: report.uploadDetectMs,
          errors: report.errors,
        },
        null,
        2,
      ),
    );
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
