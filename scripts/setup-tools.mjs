#!/usr/bin/env node
/**
 * npm run setup:tools
 *
 * Prefer valid system installs; only URL-fetch portable/project-local binaries
 * into gitignored `.runtime/tools/<platform>-<arch>/` when missing (no admin when possible).
 * Also mirrors into legacy `.tools/` for older resolvers. Writes config under `.runtime/`.
 * Never re-downloads working tools.
 *
 * Auto-downloads (only when missing from system PATH and .runtime/.tools):
 *   - ffmpeg + ffprobe  (same build; Windows zip / Linux static / macOS)
 *   - 7-Zip             (7zr.exe bootstrap + extra package on Windows; 7zz linux)
 *   - pandoc            (official GitHub release zip/tarball)
 *   - LibreOffice       (Windows MSI administrative extract; else actionable error)
 *
 * Selective install: --only ffmpeg --only 7z  or  ALPHA_TOOLS_ONLY=ffmpeg,7z
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const platform = process.platform;
const arch = process.arch; // x64 | arm64
const isWin = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';
const archLabel = arch === 'arm64' || arch === 'aarch64' ? 'arm64' : 'x64';
const platformArch = `${platform}-${archLabel}`;
// Canonical install root: .runtime/tools/<platform>-<arch>
const toolsDir = path.join(root, '.runtime', 'tools', platformArch);
const runtimeRoot = path.join(root, '.runtime');
const legacyToolsDir = path.join(root, '.tools');
const configPath = path.join(runtimeRoot, 'config.json');
// Ensure skeleton
for (const d of [
  toolsDir,
  path.join(runtimeRoot, 'cache'),
  path.join(runtimeRoot, 'downloads'),
  path.join(runtimeRoot, 'manifests'),
  path.join(runtimeRoot, 'tmp'),
  legacyToolsDir,
]) {
  fs.mkdirSync(d, { recursive: true });
}

/** @returns {Set<string>|null} null = install all units */
function parseOnlySet() {
  const only = new Set();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) {
      only.add(String(args[++i]).toLowerCase());
    } else if (args[i].startsWith('--only=')) {
      only.add(args[i].slice('--only='.length).toLowerCase());
    }
  }
  const envOnly = process.env.ALPHA_TOOLS_ONLY || process.env.TOOLS_ONLY || '';
  for (const part of envOnly.split(/[,;\s]+/).filter(Boolean)) {
    only.add(part.toLowerCase());
  }
  return only.size ? only : null;
}

function shouldSetup(unit, onlySet) {
  if (!onlySet) return true;
  if (unit === 'ffmpeg') return onlySet.has('ffmpeg') || onlySet.has('ffprobe');
  return onlySet.has(unit);
}

// Pinned download URLs (update when needed)
const URLS = {
  ffmpegWin:
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  ffmpegLinux:
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
  ffmpegMac:
    'https://evermeet.cx/ffmpeg/getrelease/zip', // may 302; fallback message if fails
  // 7-Zip reduced standalone (no deps) then extra for full 7za
  sevenZrWin: 'https://www.7-zip.org/a/7zr.exe',
  sevenZExtraWin: 'https://www.7-zip.org/a/7z2501-extra.7z',
  sevenZzLinux:
    arch === 'arm64'
      ? 'https://www.7-zip.org/a/7z2501-linux-arm64.tar.xz'
      : 'https://www.7-zip.org/a/7z2501-linux-x64.tar.xz',
  // pandoc official releases
  pandocWin:
    'https://github.com/jgm/pandoc/releases/download/3.6.4/pandoc-3.6.4-windows-x86_64.zip',
  pandocLinux:
    arch === 'arm64'
      ? 'https://github.com/jgm/pandoc/releases/download/3.6.4/pandoc-3.6.4-linux-arm64.tar.gz'
      : 'https://github.com/jgm/pandoc/releases/download/3.6.4/pandoc-3.6.4-linux-amd64.tar.gz',
  pandocMac:
    arch === 'arm64'
      ? 'https://github.com/jgm/pandoc/releases/download/3.6.4/pandoc-3.6.4-arm64-macOS.zip'
      : 'https://github.com/jgm/pandoc/releases/download/3.6.4/pandoc-3.6.4-x86_64-macOS.zip',
  // LibreOffice MSI (Windows administrative extract via msiexec /a — no full install)
  // Pin a version that exists on the CDN; bump when Document Foundation ships newer.
  libreOfficeMsi:
    'https://download.documentfoundation.org/libreoffice/stable/25.8.7/win/x86_64/LibreOffice_25.8.7_Win_x86-64.msi',
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function log(msg) {
  console.log(msg);
}

function err(msg) {
  console.error(msg);
}

const keepToolDownloads = ['1', 'true', 'yes'].includes(
  String(process.env.ALPHA_KEEP_TOOL_DOWNLOADS || '').toLowerCase(),
);

/** Remove download/extract staging unless explicitly retained for debugging. */
function cleanupInstallStaging(paths) {
  if (keepToolDownloads) {
    log('tool staging retained (ALPHA_KEEP_TOOL_DOWNLOADS=1)');
    return;
  }
  for (const candidate of paths) {
    try {
      fs.rmSync(candidate, { recursive: true, force: true });
    } catch (e) {
      log(`cleanup warning: ${candidate} (${e.message})`);
    }
  }
}

function probe(cmd, args) {
  // On Windows, LibreOffice CLI is more reliable via soffice.com than soffice.exe
  const tryCmd =
    isWin && /soffice\.exe$/i.test(cmd) && fs.existsSync(cmd.replace(/\.exe$/i, '.com'))
      ? cmd.replace(/\.exe$/i, '.com')
      : cmd;
  try {
    const out = execFileSync(tryCmd, args, {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, version: String(out).split(/\r?\n/)[0]?.trim(), path: tryCmd };
  } catch (e) {
    // Some LO builds write version to stderr with non-zero exit — accept if output looks right
    const msg = e && typeof e === 'object' && 'stdout' in e ? String(e.stdout || e.stderr || '') : '';
    if (/LibreOffice|soffice/i.test(msg)) {
      return { ok: true, version: msg.split(/\r?\n/)[0]?.trim(), path: tryCmd };
    }
    return { ok: false };
  }
}

function findOnPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    for (const n of names) {
      const candidates = isWin ? [path.join(dir, n), path.join(dir, `${n}.exe`)] : [path.join(dir, n)];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
  }
  return null;
}

function walkFind(rootDir, basenames) {
  const want = new Set(basenames.map((b) => b.toLowerCase()));
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

/** HTTPS/HTTP download with redirects, progress dots, timeout */
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 12) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }
    ensureDir(path.dirname(dest));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'AlphaStudio-setup-tools/1.0',
          Accept: '*/*',
        },
        timeout: 120_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          download(next, dest, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        let lastPct = -1;
        const file = createWriteStream(dest);
        res.on('data', (chunk) => {
          got += chunk.length;
          if (total > 0) {
            const pct = Math.floor((got / total) * 100);
            if (pct >= lastPct + 10) {
              process.stdout.write(`  … ${pct}%\r`);
              lastPct = pct;
            }
          }
        });
        pipeline(res, file)
          .then(() => {
            if (total > 0) process.stdout.write('  … 100%\n');
            resolve(dest);
          })
          .catch(reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout downloading ${url}`));
    });
    req.on('error', reject);
  });
}

function extractZip(zipPath, destDir) {
  ensureDir(destDir);
  if (isWin) {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit', windowsHide: true },
    );
  } else {
    execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' });
  }
}

function extractTar(archivePath, destDir, compressFlag) {
  ensureDir(destDir);
  const args = ['-x', compressFlag, '-f', archivePath, '-C', destDir].filter(Boolean);
  // compressFlag e.g. -z -J or empty
  const finalArgs = compressFlag
    ? ['-x', compressFlag, '-f', archivePath, '-C', destDir]
    : ['-xf', archivePath, '-C', destDir];
  execFileSync('tar', finalArgs, { stdio: 'inherit' });
}

// ─── ffmpeg ───────────────────────────────────────────────────────────────

async function setupFfmpeg(cfg) {
  const localFf = path.join(toolsDir, 'ffmpeg', 'bin', isWin ? 'ffmpeg.exe' : 'ffmpeg');
  const localFp = path.join(toolsDir, 'ffmpeg', 'bin', isWin ? 'ffprobe.exe' : 'ffprobe');

  // Prefer valid system install first (no download)
  const pathFf = findOnPath(['ffmpeg']);
  const pathFp = findOnPath(['ffprobe']);
  if (pathFf && probe(pathFf, ['-version']).ok) {
    cfg.tools.ffmpeg = { path: pathFf, version: probe(pathFf, ['-version']).version };
    // Prefer ffprobe sibling next to system ffmpeg
    const sibFp = path.join(path.dirname(pathFf), isWin ? 'ffprobe.exe' : 'ffprobe');
    const fp = (fs.existsSync(sibFp) ? sibFp : pathFp) || pathFp;
    if (fp && probe(fp, ['-version']).ok) {
      cfg.tools.ffprobe = { path: fp, version: probe(fp, ['-version']).version };
    }
    log(`ffmpeg: system OK (${pathFf}) — skip download`);
    return;
  }

  if (fs.existsSync(localFf) && probe(localFf, ['-version']).ok) {
    cfg.tools.ffmpeg = { path: localFf, version: probe(localFf, ['-version']).version };
    if (fs.existsSync(localFp) && probe(localFp, ['-version']).ok) {
      cfg.tools.ffprobe = { path: localFp, version: probe(localFp, ['-version']).version };
    }
    log(`ffmpeg: project-local OK (${localFf}) — skip download`);
    return;
  }

  let url;
  if (isWin) url = URLS.ffmpegWin;
  else if (isLinux) url = URLS.ffmpegLinux;
  else if (isMac) url = URLS.ffmpegMac;
  else {
    err(`ACTION REQUIRED: Unsupported platform ${platform} for ffmpeg auto-install.`);
    if (pathFf) {
      cfg.tools.ffmpeg = { path: pathFf, version: probe(pathFf, ['-version']).version };
      if (pathFp) cfg.tools.ffprobe = { path: pathFp, version: probe(pathFp, ['-version']).version };
    }
    return;
  }

  const archiveName = path.basename(new URL(url).pathname) || 'ffmpeg-dl.bin';
  const archivePath = path.join(toolsDir, 'downloads', archiveName);
  ensureDir(path.dirname(archivePath));
  log(`ffmpeg: downloading ${url}`);
  try {
    await download(url, archivePath);
  } catch (e) {
    err(`ACTION REQUIRED: ffmpeg download failed (${e.message}).`);
    if (pathFf) {
      cfg.tools.ffmpeg = { path: pathFf, version: probe(pathFf, ['-version']).version };
      if (pathFp) cfg.tools.ffprobe = { path: pathFp, version: probe(pathFp, ['-version']).version };
      log(`ffmpeg: falling back to PATH ${pathFf}`);
    }
    cleanupInstallStaging([archivePath]);
    return;
  }

  const extractRoot = path.join(toolsDir, 'ffmpeg-extract');
  try {
    if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true });
    ensureDir(extractRoot);
    if (archiveName.endsWith('.zip')) extractZip(archivePath, extractRoot);
    else if (archiveName.endsWith('.tar.xz') || archiveName.endsWith('.txz')) {
      extractTar(archivePath, extractRoot, '-J');
    } else if (archiveName.endsWith('.tar.gz') || archiveName.endsWith('.tgz')) {
      extractTar(archivePath, extractRoot, '-z');
    } else {
      throw new Error(`Unknown archive type: ${archiveName}`);
    }

    const ffName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
    const fpName = isWin ? 'ffprobe.exe' : 'ffprobe';
    const ff = walkFind(extractRoot, [ffName]);
    const fp = walkFind(extractRoot, [fpName]);
    if (!ff) throw new Error('ffmpeg binary not found in archive');

    const destBin = path.join(toolsDir, 'ffmpeg', 'bin');
    ensureDir(destBin);
    fs.copyFileSync(ff, path.join(destBin, ffName));
    if (fp) fs.copyFileSync(fp, path.join(destBin, fpName));
    if (!isWin) {
      try {
        fs.chmodSync(path.join(destBin, ffName), 0o755);
        if (fp) fs.chmodSync(path.join(destBin, fpName), 0o755);
      } catch {
        /* ignore */
      }
    }

    const ffPath = path.join(destBin, ffName);
    const p = probe(ffPath, ['-version']);
    if (!p.ok) throw new Error('ffmpeg extracted but -version failed');
    cfg.tools.ffmpeg = { path: ffPath, version: p.version };
    const fpPath = path.join(destBin, fpName);
    if (fs.existsSync(fpPath)) {
      const pp = probe(fpPath, ['-version']);
      if (pp.ok) cfg.tools.ffprobe = { path: fpPath, version: pp.version };
    }
    log(`ffmpeg: installed → ${ffPath}`);
  } catch (e) {
    err(`ACTION REQUIRED: ffmpeg extract failed (${e.message}). Install manually then npm run repair:tools`);
    if (pathFf) {
      cfg.tools.ffmpeg = { path: pathFf };
      if (pathFp) cfg.tools.ffprobe = { path: pathFp };
    }
  } finally {
    cleanupInstallStaging([extractRoot, archivePath]);
  }
}

// ─── 7-Zip ────────────────────────────────────────────────────────────────

async function setup7z(cfg) {
  const local7z = path.join(toolsDir, '7z', isWin ? '7za.exe' : '7zz');
  const local7zr = path.join(toolsDir, '7z', isWin ? '7zr.exe' : '7zz');
  const path7z = findOnPath(['7z', '7za', '7zz']);
  // Prefer full system 7-Zip
  if (path7z) {
    cfg.tools['7z'] = { path: path7z, version: 'path' };
    log(`7z: system OK (${path7z}) — skip download`);
    return;
  }
  if (isWin && fs.existsSync('C:\\Program Files\\7-Zip\\7z.exe')) {
    cfg.tools['7z'] = { path: 'C:\\Program Files\\7-Zip\\7z.exe', version: 'system' };
    log(`7z: system OK (Program Files) — skip download`);
    return;
  }

  for (const c of [local7z, local7zr]) {
    if (fs.existsSync(c)) {
      cfg.tools['7z'] = { path: c, version: '7z-project' };
      log(`7z: project-local OK (${c}) — skip download`);
      return;
    }
  }

  if (isWin) {
    const destDir = path.join(toolsDir, '7z');
    ensureDir(destDir);
    const sevenZr = path.join(destDir, '7zr.exe');
    log(`7z: downloading ${URLS.sevenZrWin}`);
    try {
      await download(URLS.sevenZrWin, sevenZr);
      // Prefer full extra package (7za.exe) when CDN has it; 7zr alone is still usable.
      const extra = path.join(toolsDir, 'downloads', '7z-extra.7z');
      try {
        ensureDir(path.dirname(extra));
        log(`7z: downloading ${URLS.sevenZExtraWin}`);
        await download(URLS.sevenZExtraWin, extra);
        execFileSync(sevenZr, ['x', `-o${destDir}`, '-y', extra], {
          stdio: 'inherit',
          windowsHide: true,
          timeout: 120_000,
        });
      } catch (extraErr) {
        log(`7z: extra package skipped (${extraErr.message}); using 7zr.exe`);
      } finally {
        cleanupInstallStaging([extra]);
      }
      const sevenZa = walkFind(destDir, ['7za.exe', '7z.exe']) || sevenZr;
      if (!fs.existsSync(sevenZa)) throw new Error('7z binary missing after download');
      cfg.tools['7z'] = { path: sevenZa, version: '7z-project' };
      log(`7z: installed → ${sevenZa}`);
      return;
    } catch (e) {
      err(`ACTION REQUIRED: 7z download failed (${e.message}).`);
      if (path7z) {
        cfg.tools['7z'] = { path: path7z, version: 'path' };
        log(`7z: falling back to PATH ${path7z}`);
      }
      return;
    } finally {
      // sevenZr is the installed fallback binary; only the extra archive is staging.
      cleanupInstallStaging([path.join(toolsDir, 'downloads', '7z-extra.7z')]);
    }
  }

  if (isLinux) {
    const destDir = path.join(toolsDir, '7z');
    ensureDir(destDir);
    const archive = path.join(toolsDir, 'downloads', '7z-linux.tar.xz');
    ensureDir(path.dirname(archive));
    log(`7z: downloading ${URLS.sevenZzLinux}`);
    try {
      await download(URLS.sevenZzLinux, archive);
      extractTar(archive, destDir, '-J');
      const bin = walkFind(destDir, ['7zz', '7za', '7z']);
      if (bin) {
        try {
          fs.chmodSync(bin, 0o755);
        } catch {
          /* ignore */
        }
        cfg.tools['7z'] = { path: bin, version: '7z-project' };
        log(`7z: installed → ${bin}`);
        return;
      }
      throw new Error('7zz not found after extract');
    } catch (e) {
      err(`ACTION REQUIRED: 7z download failed (${e.message}).`);
      if (path7z) cfg.tools['7z'] = { path: path7z, version: 'path' };
      return;
    } finally {
      cleanupInstallStaging([archive]);
    }
  }

  // macOS: brew or PATH
  if (path7z) {
    cfg.tools['7z'] = { path: path7z, version: 'path' };
    log(`7z: using PATH ${path7z}`);
  } else {
    err(
      'ACTION REQUIRED (macOS 7z): brew install p7zip && npm run repair:tools\n' +
        `  or place 7zz under .runtime/tools/${platformArch}/7z/`,
    );
  }
}

// ─── pandoc ───────────────────────────────────────────────────────────────

async function setupPandoc(cfg) {
  const local = path.join(toolsDir, 'pandoc', isWin ? 'pandoc.exe' : 'pandoc');
  const pathPandoc = findOnPath(['pandoc']);
  if (pathPandoc && probe(pathPandoc, ['--version']).ok) {
    cfg.tools.pandoc = { path: pathPandoc, version: probe(pathPandoc, ['--version']).version };
    log(`pandoc: system OK (${pathPandoc}) — skip download`);
    return;
  }
  if (fs.existsSync(local) && probe(local, ['--version']).ok) {
    cfg.tools.pandoc = { path: local, version: probe(local, ['--version']).version };
    log(`pandoc: project-local OK (${local}) — skip download`);
    return;
  }

  let url;
  if (isWin) url = URLS.pandocWin;
  else if (isLinux) url = URLS.pandocLinux;
  else if (isMac) url = URLS.pandocMac;
  else {
    if (pathPandoc) cfg.tools.pandoc = { path: pathPandoc };
    return;
  }

  const archiveName = path.basename(new URL(url).pathname);
  const archivePath = path.join(toolsDir, 'downloads', archiveName);
  const extractRoot = path.join(toolsDir, 'pandoc-extract');
  ensureDir(path.dirname(archivePath));
  log(`pandoc: downloading ${url}`);
  try {
    await download(url, archivePath);
    if (fs.existsSync(extractRoot)) fs.rmSync(extractRoot, { recursive: true, force: true });
    ensureDir(extractRoot);
    if (archiveName.endsWith('.zip')) extractZip(archivePath, extractRoot);
    else if (archiveName.endsWith('.tar.gz')) extractTar(archivePath, extractRoot, '-z');
    else throw new Error(`Unknown pandoc archive: ${archiveName}`);

    const binName = isWin ? 'pandoc.exe' : 'pandoc';
    const found = walkFind(extractRoot, [binName]);
    if (!found) throw new Error('pandoc binary not found in archive');
    const destDir = path.join(toolsDir, 'pandoc');
    ensureDir(destDir);
    const dest = path.join(destDir, binName);
    fs.copyFileSync(found, dest);
    if (!isWin) {
      try {
        fs.chmodSync(dest, 0o755);
      } catch {
        /* ignore */
      }
    }
    const p = probe(dest, ['--version']);
    if (!p.ok) throw new Error('pandoc --version failed after install');
    cfg.tools.pandoc = { path: dest, version: p.version };
    log(`pandoc: installed → ${dest}`);
  } catch (e) {
    err(`ACTION REQUIRED: pandoc download failed (${e.message}).`);
    if (pathPandoc) {
      cfg.tools.pandoc = { path: pathPandoc, version: probe(pathPandoc, ['--version']).version };
      log(`pandoc: falling back to PATH ${pathPandoc}`);
    } else {
      err('  Install from https://pandoc.org/installing.html then npm run repair:tools');
    }
  } finally {
    cleanupInstallStaging([extractRoot, archivePath]);
  }
}

// ─── LibreOffice ──────────────────────────────────────────────────────────

async function setupLibreOffice(cfg) {
  const localCandidates = [
    path.join(toolsDir, 'libreoffice', 'program', isWin ? 'soffice.com' : 'soffice'),
    path.join(toolsDir, 'libreoffice', 'program', isWin ? 'soffice.exe' : 'soffice'),
    path.join(toolsDir, 'LibreOffice', 'program', isWin ? 'soffice.com' : 'soffice'),
    path.join(toolsDir, 'LibreOffice', 'program', isWin ? 'soffice.exe' : 'soffice'),
  ];

  const pathLo =
    findOnPath(['soffice', 'libreoffice']) ||
    (isWin && fs.existsSync('C:\\Program Files\\LibreOffice\\program\\soffice.com')
      ? 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
      : null) ||
    (isWin && fs.existsSync('C:\\Program Files\\LibreOffice\\program\\soffice.exe')
      ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
      : null) ||
    (isMac && fs.existsSync('/Applications/LibreOffice.app/Contents/MacOS/soffice')
      ? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
      : null);

  // Prefer system LibreOffice (headless convert works from system install)
  if (pathLo && (probe(pathLo, ['--version']).ok || fs.existsSync(pathLo))) {
    const p = probe(pathLo, ['--version']);
    cfg.tools.libreoffice = { path: pathLo, version: p.version || 'soffice' };
    log(`libreoffice: system OK (${pathLo}) — skip download`);
    return;
  }

  for (const c of localCandidates) {
    if (fs.existsSync(c) && (probe(c, ['--version']).ok || /soffice/i.test(c))) {
      const p = probe(c, ['--version']);
      cfg.tools.libreoffice = { path: c, version: p.version || 'soffice' };
      log(`libreoffice: project-local OK (${c}) — skip download`);
      return;
    }
  }

  if (!isWin) {
    err(
      'ACTION REQUIRED: LibreOffice not found.\n' +
        (isMac
          ? '  brew install --cask libreoffice && npm run repair:tools\n'
          : '  sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress && npm run repair:tools\n') +
        `  Or place portable soffice under .runtime/tools/${platformArch}/libreoffice/program/`,
    );
    return;
  }

  // Windows: download MSI and administrative extract (no admin rights required for /a)
  const msiPath = path.join(toolsDir, 'downloads', 'LibreOffice.msi');
  ensureDir(path.dirname(msiPath));
  log(`libreoffice: downloading ${URLS.libreOfficeMsi} (large ~300MB)…`);
  try {
    await download(URLS.libreOfficeMsi, msiPath);
  } catch (e) {
    err(
      `ACTION REQUIRED: LibreOffice download failed (${e.message}).\n` +
        `  Install from https://www.libreoffice.org/download/download/ then npm run repair:tools`,
    );
    cleanupInstallStaging([msiPath]);
    return;
  }

  const targetDir = path.join(toolsDir, 'libreoffice-msi-extract');
  try {
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    ensureDir(targetDir);
    log('libreoffice: extracting MSI (msiexec /a, no admin install)…');
    execFileSync(
      'msiexec.exe',
      ['/a', msiPath, '/qn', `TARGETDIR=${targetDir}`],
      { stdio: 'inherit', windowsHide: true, timeout: 600_000 },
    );
    const soffice = walkFind(targetDir, ['soffice.com', 'soffice.exe']);
    if (!soffice) throw new Error('soffice not found after MSI extract');
    // Copy tree to the stable platform-local libreoffice root (parent of program/)
    const destRoot = path.join(toolsDir, 'libreoffice');
    const programDir = path.dirname(soffice);
    const parent = path.dirname(programDir);
    ensureDir(destRoot);
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Copy-Item -Path '${parent.replace(/'/g, "''")}\\*' -Destination '${destRoot.replace(/'/g, "''")}' -Recurse -Force`,
      ],
      { stdio: 'inherit', windowsHide: true },
    );
    // Prefer .com for headless CLI on Windows
    const finalCom = path.join(destRoot, 'program', 'soffice.com');
    const finalExe = path.join(destRoot, 'program', 'soffice.exe');
    const final = fs.existsSync(finalCom) ? finalCom : walkFind(destRoot, ['soffice.com', 'soffice.exe']) || finalExe;
    if (!fs.existsSync(final)) throw new Error(`soffice missing after copy: ${final}`);
    const p = probe(final, ['--version']);
    if (!p.ok) {
      // Still register path if binary exists — LO admin-extract is usable for --headless convert
      // even when --version is flaky under some shells.
      log(`libreoffice: probe flaky; registering ${final} anyway`);
      cfg.tools.libreoffice = { path: final, version: 'msi-extract' };
    } else {
      cfg.tools.libreoffice = { path: final, version: p.version };
    }
    log(`libreoffice: installed → ${final}`);
  } catch (e) {
    err(
      `ACTION REQUIRED: LibreOffice extract failed (${e.message}).\n` +
        `  Install LibreOffice from https://www.libreoffice.org/download/download/ (user install),\n` +
        `  then run: npm run repair:tools`,
    );
  } finally {
    cleanupInstallStaging([targetDir, msiPath]);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  ensureDir(toolsDir);
  ensureDir(path.join(toolsDir, 'downloads'));
  const onlySet = parseOnlySet();
  const pandocRequested =
    Boolean(onlySet?.has('pandoc')) ||
    ['1', 'true', 'yes'].includes(String(process.env.ALPHA_REQUIRE_PANDOC || '').toLowerCase());
  const cfg = { updatedAt: new Date().toISOString(), tools: {} };
  if (fs.existsSync(configPath)) {
    try {
      Object.assign(cfg.tools, JSON.parse(fs.readFileSync(configPath, 'utf8')).tools || {});
    } catch {
      /* ignore */
    }
  }

  log(`AlphaStudio setup:tools — prefer system, then portable under .runtime/tools/${platformArch}/`);
  log(`platform=${platform} arch=${arch}`);
  if (onlySet) log(`only: ${[...onlySet].join(', ')}`);
  log('');

  if (shouldSetup('ffmpeg', onlySet)) await setupFfmpeg(cfg);
  else log('ffmpeg: skipped (--only filter)');
  if (shouldSetup('7z', onlySet)) await setup7z(cfg);
  else log('7z: skipped (--only filter)');
  if (pandocRequested) await setupPandoc(cfg);
  else log('pandoc: skipped (runtime 3.6 does not use it; request with --only pandoc)');
  if (shouldSetup('libreoffice', onlySet)) await setupLibreOffice(cfg);
  else log('libreoffice: skipped (--only filter)');

  // Final probes
  for (const [name, entry] of Object.entries(cfg.tools)) {
    if (!entry?.path || !fs.existsSync(entry.path)) continue;
    const args =
      name === 'libreoffice' || name === 'pandoc' ? ['--version'] : name === '7z' ? [] : ['-version'];
    if (name === '7z') {
      entry.version = entry.version || '7z';
      continue;
    }
    const p = probe(entry.path, args);
    if (p.ok) entry.version = p.version;
  }

  cfg.updatedAt = new Date().toISOString();
  // Atomic write (tmp + rename) for crash safety
  const tmp = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  try {
    fs.renameSync(tmp, configPath);
  } catch {
    try {
      fs.unlinkSync(configPath);
    } catch {
      /* ignore */
    }
    fs.renameSync(tmp, configPath);
  }
  log('');
  log(`Wrote ${configPath}`);
  log('Contents:');
  for (const [k, v] of Object.entries(cfg.tools)) {
    log(`  ${k}: ${v.path}`);
  }
  log('');
  log('Next: npm run tools:check');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
