import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const port = String(process.env.E2E_CLIENT_PORT || 15173);

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteCli, ...args], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`vite ${args[0]} exited with ${code ?? signal}`));
    });
  });
}

await run(['build']);

const preview = spawn(
  process.execPath,
  [viteCli, 'preview', '--host', '127.0.0.1', '--port', port, '--strictPort'],
  { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true },
);

let stopping = false;

function waitForPreviewExit() {
  if (preview.exitCode !== null || preview.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => preview.once('exit', resolve));
}

async function stop() {
  if (stopping) return;
  stopping = true;
  const exited = waitForPreviewExit();
  try {
    preview.kill(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // The preview process already exited.
  }
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  process.exit(0);
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
process.on('message', (message) => {
  if (message?.type === 'shutdown') void stop();
});
preview.once('error', (error) => {
  throw error;
});
preview.once('exit', (code) => {
  if (!stopping) process.exitCode = code ?? 0;
});
