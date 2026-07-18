#!/usr/bin/env node
/**
 * npm run repair:tools — re-scan PATH and .tools, rewrite config.json with working paths.
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

function walkFind(rootDir, basenameOrList) {
  if (!fs.existsSync(rootDir)) return null;
  const want = new Set(
    (Array.isArray(basenameOrList) ? basenameOrList : [basenameOrList]).map((b) => b.toLowerCase()),
  );
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (want.has(ent.name.toLowerCase())) return full;
    }
  }
  return null;
}

function resolveOne(name, pathNames, projectGlobs, probeArgs) {
  // Prefer project-local .tools first (portable installs from setup:tools)
  const hits = [];
  for (const g of projectGlobs) {
    if (fs.existsSync(g)) hits.push(g);
    else {
      const base = path.basename(g);
      const found = walkFind(toolsDir, base);
      if (found) hits.push(found);
    }
  }
  const walkNames =
    name === 'ffmpeg'
      ? ['ffmpeg.exe', 'ffmpeg']
      : name === 'ffprobe'
        ? ['ffprobe.exe', 'ffprobe']
        : name === '7z'
          ? ['7za.exe', '7z.exe', '7zr.exe', '7zz', '7za']
          : name === 'libreoffice'
            ? ['soffice.com', 'soffice.exe', 'soffice']
            : name === 'pandoc'
              ? ['pandoc.exe', 'pandoc']
              : [];
  if (walkNames.length) {
    const found = walkFind(toolsDir, walkNames);
    if (found) hits.push(found);
  }

  const onPath = findOnPath(pathNames);
  if (onPath) hits.push(onPath);

  if (name === 'libreoffice' && process.platform === 'win32') {
    hits.push('C:\\Program Files\\LibreOffice\\program\\soffice.exe');
  }
  if (name === 'libreoffice' && process.platform === 'darwin') {
    hits.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  }
  if (name === '7z' && process.platform === 'win32') {
    hits.push('C:\\Program Files\\7-Zip\\7z.exe');
  }

  for (const h of hits) {
    if (!h || !fs.existsSync(h)) continue;
    if (name === '7z') {
      return { path: h, version: '7z' };
    }
    const p = probe(h, probeArgs);
    if (p.ok) return { path: p.path || h, version: p.version };
  }
  return null;
}

function main() {
  fs.mkdirSync(toolsDir, { recursive: true });
  const isWin = process.platform === 'win32';
  const tools = {};

  const ffmpeg = resolveOne(
    'ffmpeg',
    ['ffmpeg'],
    [
      path.join(toolsDir, 'ffmpeg', 'bin', isWin ? 'ffmpeg.exe' : 'ffmpeg'),
      path.join(toolsDir, 'ffmpeg', isWin ? 'ffmpeg.exe' : 'ffmpeg'),
    ],
    ['-version'],
  );
  if (ffmpeg) tools.ffmpeg = ffmpeg;

  const ffprobe = resolveOne(
    'ffprobe',
    ['ffprobe'],
    [
      path.join(toolsDir, 'ffmpeg', 'bin', isWin ? 'ffprobe.exe' : 'ffprobe'),
      path.join(toolsDir, 'ffmpeg', isWin ? 'ffprobe.exe' : 'ffprobe'),
    ],
    ['-version'],
  );
  if (ffprobe) tools.ffprobe = ffprobe;

  const lo = resolveOne(
    'libreoffice',
    ['soffice', 'libreoffice'],
    [
      path.join(toolsDir, 'libreoffice', 'program', isWin ? 'soffice.com' : 'soffice'),
      path.join(toolsDir, 'libreoffice', 'program', isWin ? 'soffice.exe' : 'soffice'),
    ],
    ['--version'],
  );
  if (lo) tools.libreoffice = lo;

  const seven = resolveOne(
    '7z',
    ['7z', '7za', '7zz'],
    [path.join(toolsDir, '7z', isWin ? '7z.exe' : '7zz')],
    [],
  );
  if (seven) tools['7z'] = seven;

  const pandoc = resolveOne(
    'pandoc',
    ['pandoc'],
    [path.join(toolsDir, 'pandoc', isWin ? 'pandoc.exe' : 'pandoc')],
    ['--version'],
  );
  if (pandoc) tools.pandoc = pandoc;

  // Prefer project-local over PATH for consistency after setup:tools

  const cfg = { updatedAt: new Date().toISOString(), tools };
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  console.log('AlphaStudio repair:tools');
  for (const [k, v] of Object.entries(tools)) {
    console.log(`  OK  ${k}: ${v.path}`);
  }
  const missing = ['ffmpeg', 'ffprobe', 'libreoffice'].filter((k) => !tools[k]);
  if (missing.length) {
    console.error(
      `ACTION REQUIRED: Still missing ${missing.join(', ')}. Run npm run setup:tools or install manually.`,
    );
    process.exitCode = 2;
  } else {
    console.log('Primary tools registered.');
  }
  console.log(`Wrote ${configPath}`);
}

main();
