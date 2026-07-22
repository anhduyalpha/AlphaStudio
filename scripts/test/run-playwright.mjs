import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'alphastudio-e2e-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
let succeeded = false;

function run(executable, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'inherit', env, shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with ${code ?? signal}`));
    });
  });
}

try {
  await run(process.execPath, ['scripts/test/generate-pdf-fixtures.mjs']);
  await run(process.execPath, ['scripts/test/verify-pdf-fixtures.mjs']);
  await run(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    ...process.env,
    ALPHASTUDIO_E2E_DATA_DIR: dataDir,
  });
  succeeded = true;
} finally {
  if (succeeded) {
    await rm(dataDir, { recursive: true, force: true });
  } else {
    console.error(`Preserved failed E2E data and artifacts at ${dataDir}`);
  }
}
