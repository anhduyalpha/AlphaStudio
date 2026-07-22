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

const stop = () => preview.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
preview.once('error', (error) => {
  throw error;
});
preview.once('exit', (code) => {
  process.exitCode = code ?? 0;
});
