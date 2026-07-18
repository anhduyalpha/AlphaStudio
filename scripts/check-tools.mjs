#!/usr/bin/env node
/**
 * npm run check:tools — probe PATH + .tools/config.json without TypeScript.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const toolsDir = path.join(root, '.tools');
const configPath = path.join(toolsDir, 'config.json');

function probe(cmd, args) {
  let tryCmd = cmd;
  if (process.platform === 'win32' && /soffice\.exe$/i.test(cmd)) {
    const com = cmd.replace(/\.exe$/i, '.com');
    if (fs.existsSync(com)) tryCmd = com;
  }
  try {
    const out = execFileSync(tryCmd, args, {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, version: String(out).split(/\r?\n/)[0]?.trim(), path: tryCmd };
  } catch (e) {
    const msg = e && typeof e === 'object' ? String(e.stdout || e.stderr || '') : '';
    if (/LibreOffice/i.test(msg)) return { ok: true, version: msg.split(/\r?\n/)[0]?.trim(), path: tryCmd };
    if (fs.existsSync(tryCmd) && /soffice/i.test(tryCmd)) {
      return { ok: true, version: 'soffice', path: tryCmd };
    }
    return { ok: false };
  }
}

function findOnPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const isWin = process.platform === 'win32';
  for (const dir of dirs) {
    for (const n of names) {
      for (const c of isWin ? [path.join(dir, n), path.join(dir, `${n}.exe`)] : [path.join(dir, n)]) {
        if (fs.existsSync(c)) return c;
      }
    }
  }
  return null;
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    /* ignore */
  }
  return { tools: {} };
}

function resolve(name, pathNames, probeArgs) {
  const cfg = loadConfig();
  const configured = cfg.tools?.[name]?.path;
  if (configured && fs.existsSync(configured)) {
    if (name === '7z') return { available: true, path: configured, version: '7z' };
    const p = probe(configured, probeArgs);
    if (p.ok) return { available: true, path: p.path || configured, version: p.version };
  }
  // project-local well-known paths
  const toolsDir = path.join(root, '.tools');
  const projectHits =
    name === 'libreoffice'
      ? [
          path.join(toolsDir, 'libreoffice', 'program', process.platform === 'win32' ? 'soffice.com' : 'soffice'),
          path.join(toolsDir, 'libreoffice', 'program', process.platform === 'win32' ? 'soffice.exe' : 'soffice'),
        ]
      : name === 'ffmpeg'
        ? [path.join(toolsDir, 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')]
        : name === 'ffprobe'
          ? [path.join(toolsDir, 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')]
          : name === 'pandoc'
            ? [path.join(toolsDir, 'pandoc', process.platform === 'win32' ? 'pandoc.exe' : 'pandoc')]
            : name === '7z'
              ? [
                  path.join(toolsDir, '7z', process.platform === 'win32' ? '7za.exe' : '7zz'),
                  path.join(toolsDir, '7z', process.platform === 'win32' ? '7zr.exe' : '7zz'),
                ]
              : [];
  for (const ph of projectHits) {
    if (!fs.existsSync(ph)) continue;
    if (name === '7z') return { available: true, path: ph, version: '7z' };
    const p = probe(ph, probeArgs);
    if (p.ok) return { available: true, path: p.path || ph, version: p.version };
  }

  const onPath = findOnPath(pathNames);
  if (onPath) {
    if (name === '7z') return { available: true, path: onPath, version: '7z' };
    const p = probe(onPath, probeArgs);
    if (p.ok) return { available: true, path: p.path || onPath, version: p.version };
  }
  // well-known system installs
  const well =
    name === 'libreoffice' && process.platform === 'win32'
      ? 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
      : name === 'libreoffice' && process.platform === 'darwin'
        ? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
        : name === '7z' && process.platform === 'win32'
          ? 'C:\\Program Files\\7-Zip\\7z.exe'
          : null;
  if (well && fs.existsSync(well)) {
    if (name === '7z') return { available: true, path: well, version: '7z' };
    const p = probe(well, probeArgs);
    if (p.ok) return { available: true, path: p.path || well, version: p.version };
  }
  return { available: false, path: '' };
}

const tools = {
  ffmpeg: resolve('ffmpeg', ['ffmpeg'], ['-version']),
  ffprobe: resolve('ffprobe', ['ffprobe'], ['-version']),
  libreoffice: resolve('libreoffice', ['soffice', 'libreoffice'], ['--version']),
  '7z': resolve('7z', ['7z', '7za', '7zz'], []),
  pandoc: resolve('pandoc', ['pandoc'], ['--version']),
  sharp: { available: true, path: 'bundled', version: 'sharp' },
};

console.log('AlphaStudio tool check');
console.log(`tools dir: ${toolsDir}`);
console.log(`config: ${configPath} ${fs.existsSync(configPath) ? '(present)' : '(missing)'}`);
console.log('');

const missing = [];
for (const [name, t] of Object.entries(tools)) {
  const status = t.available ? 'OK' : 'MISSING';
  console.log(`  [${status.padEnd(7)}] ${name.padEnd(12)} ${t.available ? `${t.path} ${t.version || ''}`.trim() : '—'}`);
  if (!t.available && ['ffmpeg', 'ffprobe', 'libreoffice'].includes(name)) missing.push(name);
}

console.log('');
if (missing.length) {
  console.error(
    `ACTION REQUIRED: Missing ${missing.join(', ')}. Run: npm run setup:tools\n` +
      `If automatic download fails, install each tool manually and run: npm run repair:tools`,
  );
  process.exitCode = 2;
} else {
  console.log('All primary conversion tools resolved (or bundled).');
}
