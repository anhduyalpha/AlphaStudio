#!/usr/bin/env node
/**
 * npm run reset — clean + reinstall all deps/tools + init DB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot, runNpm } from './lib/platform.mjs';

const help = process.argv.includes('--help') || process.argv.includes('-h');
const skipInstall = process.argv.includes('--skip-install');
const dryRun = process.argv.includes('--dry-run');

if (help) {
  console.log(`Usage: npm run reset -- [--dry-run] [--skip-install]

  1. npm run clean
  2. Reinstall all workspace dependencies from the root lockfile (unless --skip-install)
  3. Initialize SQLite database (server initDb)
  4. Install/repair the complete Converter Phase 1 toolset
`);
  process.exit(0);
}

function run(label, command, args, opts = {}) {
  console.log(`\n>> ${label}`);
  console.log(`   ${command} ${args.join(' ')}`);
  if (dryRun) {
    console.log('   (dry-run)');
    return 0;
  }
  if (command === 'npm') {
    const r = runNpm(args, {
      cwd: opts.cwd || projectRoot,
      stdio: 'inherit',
      env: process.env,
    });
    if (r.error) {
      console.error(`spawn error: ${r.error.message}`);
      return 1;
    }
    return r.status ?? 1;
  }
  const r = spawnSync(command, args, {
    cwd: opts.cwd || projectRoot,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env,
  });
  if (r.error) {
    console.error(`spawn error: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

console.log('AlphaStudio reset');
console.log(`root: ${projectRoot}`);
if (dryRun) console.log('(dry-run mode)');

let code = run('clean', 'npm', ['run', 'clean']);
if (code !== 0) {
  console.error('ACTION REQUIRED: clean failed; fix errors above then re-run npm run reset');
  process.exit(code);
}

if (!skipInstall) {
  code = run('install all workspace deps', 'npm', ['ci', '--no-fund', '--no-audit']);
  if (code !== 0) {
    console.error('ACTION REQUIRED: workspace npm ci failed');
    process.exit(code);
  }
} else {
  console.log('\n>> skip dependency reinstall (--skip-install)');
}

// Initialize database via real server module
console.log('\n>> initialize database');
if (dryRun) {
  console.log('   (dry-run) would run server initDb');
} else {
  const initScript = `
import { ensureDataDirs } from './server/src/lib/paths.ts';
import { initDb, closeDb } from './server/src/db/index.ts';
ensureDataDirs();
initDb();
closeDb();
console.log('DB initialized');
`;
  // Use tsx from server if available
  const tsxBin = path.join(projectRoot, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const nodeArgs = fs.existsSync(tsxBin)
    ? [
        tsxBin,
        '--eval',
        `import { ensureDataDirs } from './src/lib/paths.ts'; import { initDb, closeDb } from './src/db/index.ts'; ensureDataDirs(); initDb(); closeDb(); console.log('DB initialized');`,
      ]
    : null;

  if (nodeArgs) {
    const r = spawnSync(process.execPath, nodeArgs, {
      cwd: path.join(projectRoot, 'server'),
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        DATA_DIR: path.join(projectRoot, 'data'),
        DB_PATH: path.join(projectRoot, 'data', 'alphastudio.db'),
      },
    });
    if (r.status !== 0) {
      console.error('ACTION REQUIRED: DB init failed. Ensure deps installed: npm install (workspaces)');
      process.exit(r.status || 1);
    }
  } else {
    // Fallback: ensure data dirs only
    fs.mkdirSync(path.join(projectRoot, 'data', 'uploads'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'data', 'outputs'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'data', 'temp'), { recursive: true });
    console.log('tsx not found; created data dirs only. Start server once to fully init DB.');
  }
}

code = run('install complete toolset', 'npm', ['run', 'tools:install']);
if (code !== 0) {
  console.error('ACTION REQUIRED: complete tool installation failed');
  process.exit(code);
}

console.log('\nReset complete.');
process.exit(0);
