import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.resolve(
  process.env.ALPHASTUDIO_E2E_DATA_DIR
    || path.join(root, 'data-test'),
);
const requestPath = path.join(dataDir, 'e2e-restart-request.json');
const readyPath = path.join(dataDir, 'e2e-restart-ready.json');
const host = process.env.HOST || '127.0.0.1';
const port = String(process.env.PORT || 18787);
const healthUrl = `http://${host}:${port}/api/health`;
const typescriptCli = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

let child = null;
let stopping = false;
let restarting = false;
let lastRestartToken = '';

function waitForProcess(target) {
  if (!target || target.exitCode !== null || target.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => target.once('exit', resolve));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const target = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    target.once('error', reject);
    target.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function waitForHealth(target, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (!target || target.exitCode !== null || target.signalCode !== null) {
      throw new Error('Replacement E2E server exited before becoming healthy');
    }
    try {
      const response = await fetch(healthUrl, { cache: 'no-store' });
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (target.exitCode !== null || target.signalCode !== null) {
          throw new Error('Replacement E2E server exited after the health probe');
        }
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`E2E server did not become healthy at ${healthUrl}: ${lastError || 'timeout'}`);
}

function startServer() {
  const target = spawn(process.execPath, ['server/dist/index.js'], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child = target;
  target.once('error', (error) => {
    if (!stopping) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  target.once('exit', (code, signal) => {
    if (child === target) child = null;
    if (!stopping && !restarting) {
      console.error(`E2E server exited unexpectedly with ${code ?? signal}`);
      process.exitCode = code || 1;
    }
  });
  return target;
}

async function forceStop(target) {
  if (!target || target.exitCode !== null || target.signalCode !== null) return;
  const exited = waitForProcess(target);
  if (process.platform === 'win32') {
    try {
      target.kill('SIGKILL');
    } catch {
      // Fall through to taskkill when direct termination is unavailable.
    }
    const directlyExited = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);
    if (!directlyExited) {
      await new Promise((resolve) => {
        const killer = spawn(
          'taskkill',
          ['/pid', String(target.pid), '/T', '/F'],
          { stdio: 'ignore', windowsHide: true, shell: false },
        );
        killer.once('error', resolve);
        killer.once('exit', resolve);
      });
    }
  } else {
    try {
      process.kill(-target.pid, 'SIGKILL');
    } catch {
      try {
        target.kill('SIGKILL');
      } catch {
        // The process already exited.
      }
    }
  }
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!stopped) throw new Error(`Could not stop E2E server process ${target.pid}`);
}

async function restartServer(token) {
  if (restarting || stopping || !token || token === lastRestartToken) return;
  restarting = true;
  lastRestartToken = token;
  try {
    const previous = child;
    await forceStop(previous);
    const next = startServer();
    await waitForHealth(next);
    await writeFile(
      readyPath,
      JSON.stringify({
        token,
        pid: next.pid,
        readyAt: new Date().toISOString(),
      }),
      'utf8',
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    restarting = false;
  }
}

async function readRestartRequest() {
  if (restarting || stopping) return;
  try {
    const payload = JSON.parse(await readFile(requestPath, 'utf8'));
    const token = typeof payload?.token === 'string' ? payload.token : '';
    if (token && token !== lastRestartToken) void restartServer(token);
  } catch {
    // The request file is optional and may be between atomic writes.
  }
}

async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(restartWatcher);
  const target = child;
  if (target) await forceStop(target);
}

await run(process.execPath, [typescriptCli, '-p', 'server/tsconfig.json']);
startServer();
const restartWatcher = setInterval(() => void readRestartRequest(), 100);

process.once('SIGINT', () => void stop().finally(() => process.exit(0)));
process.once('SIGTERM', () => void stop().finally(() => process.exit(0)));
process.on('message', (message) => {
  if (message?.type === 'shutdown') void stop().finally(() => process.exit(0));
});
