import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'alphastudio-e2e-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const clientPort = String(process.env.E2E_CLIENT_PORT || 15173);
const serverPort = String(process.env.E2E_SERVER_PORT || 18787);
const clientUrl = `http://127.0.0.1:${clientPort}`;
const serverUrl = `http://127.0.0.1:${serverPort}`;
let succeeded = false;
let serverProcess = null;
let clientProcess = null;
let shuttingDown = null;

function run(executable, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: 'inherit',
      env,
      shell: false,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with ${code ?? signal}`));
    });
  });
}

function startService(script, env) {
  return spawn(process.execPath, [script], {
    cwd: root,
    env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    shell: false,
    windowsHide: true,
  });
}

async function waitForUrl(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`E2E service exited before ${url} became ready`);
    }
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError || 'unavailable'}`);
}

function waitForExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => child.once('exit', () => resolve(true)));
}

async function stopService(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  try {
    child.send({ type: 'shutdown' });
  } catch {
    // Fall through to direct termination if the IPC channel already closed.
  }
  const stopped = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (stopped) return;
  try {
    child.kill(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // The service already exited.
  }
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

function shutdownServices() {
  if (!shuttingDown) {
    shuttingDown = Promise.all([
      stopService(clientProcess),
      stopService(serverProcess),
    ]);
  }
  return shuttingDown;
}

process.once('SIGINT', () => void shutdownServices().finally(() => process.exit(130)));
process.once('SIGTERM', () => void shutdownServices().finally(() => process.exit(143)));

try {
  await run(process.execPath, ['scripts/test/generate-pdf-fixtures.mjs']);
  await run(process.execPath, ['scripts/test/verify-pdf-fixtures.mjs']);
  const serviceEnv = {
    ...process.env,
    ALPHASTUDIO_E2E_DATA_DIR: dataDir,
  };
  serverProcess = startService('scripts/test/start-restartable-e2e-server.mjs', {
    ...serviceEnv,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: serverPort,
    CORS_ORIGIN: clientUrl,
    SERVE_FRONTEND: '0',
    DATA_DIR: dataDir,
    DB_PATH: path.join(dataDir, 'alphastudio-e2e.db'),
    WORKER_POOL_SIZE: '1',
    PDF_WORKER_CONCURRENCY: '1',
    LOG_LEVEL: 'warn',
  });
  clientProcess = startService('scripts/test/start-e2e-client.mjs', {
    ...serviceEnv,
    VITE_API_URL: serverUrl,
    E2E_CLIENT_PORT: clientPort,
  });
  await Promise.all([
    waitForUrl(`${serverUrl}/api/health`, serverProcess, 60_000),
    waitForUrl(clientUrl, clientProcess, 120_000),
  ]);
  await run(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    ...serviceEnv,
    E2E_SKIP_WEBSERVERS: '1',
  });
  succeeded = true;
} finally {
  await shutdownServices();
  if (succeeded) {
    await rm(dataDir, { recursive: true, force: true });
  } else {
    console.error(`Preserved failed E2E data and artifacts at ${dataDir}`);
  }
}
