/**
 * Discover FFmpeg, ffprobe, LibreOffice, Pandoc, ImageMagick, 7-Zip, bundled sharp.
 * Prefers valid system installs, then project .tools (platform layout + legacy).
 * Fast path: trust atomic manifest when size+mtime still match (no re-exec).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  projectRoot,
  toolsRoot,
  toolsPlatformDir,
  toolSearchRoots,
  legacyToolsRoot,
  which,
  detectPlatform,
  featureFlags,
  isExecutableFile,
  migrateLegacyTools,
} from './platform.mjs';
import { loadManifest, isEntryCacheValid } from './manifest.mjs';

/**
 * Tool definitions.
 * required: fail tools:check when missing (unless feature-gated off)
 * feature: optional gate key from featureFlags()
 * tier: 'required' | 'optional' | 'bundled' | 'feature'
 */
const TOOL_DEFS = [
  {
    name: 'ffmpeg',
    tier: 'required',
    pathNames: ['ffmpeg'],
    probeArgs: ['-version'],
    projectBins: (isWin) => [
      isWin ? 'ffmpeg.exe' : 'ffmpeg',
      path.join('bin', isWin ? 'ffmpeg.exe' : 'ffmpeg'),
    ],
  },
  {
    name: 'ffprobe',
    tier: 'required',
    pathNames: ['ffprobe'],
    probeArgs: ['-version'],
    projectBins: (isWin) => [
      isWin ? 'ffprobe.exe' : 'ffprobe',
      path.join('bin', isWin ? 'ffprobe.exe' : 'ffprobe'),
    ],
  },
  {
    name: 'libreoffice',
    tier: 'required',
    pathNames: ['soffice', 'libreoffice'],
    probeArgs: ['--version'],
    projectBins: (isWin) => [
      path.join('program', isWin ? 'soffice.com' : 'soffice'),
      path.join('program', isWin ? 'soffice.exe' : 'soffice'),
      isWin ? 'soffice.com' : 'soffice',
    ],
    wellKnown: () => {
      if (process.platform === 'win32') {
        return [
          'C:\\Program Files\\LibreOffice\\program\\soffice.com',
          'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        ];
      }
      if (process.platform === 'darwin') {
        return ['/Applications/LibreOffice.app/Contents/MacOS/soffice'];
      }
      return ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/lib/libreoffice/program/soffice'];
    },
  },
  {
    name: 'pandoc',
    tier: 'optional', // required only when ALPHA_REQUIRE_PANDOC=1
    featureGate: 'pandocRequired',
    pathNames: ['pandoc'],
    probeArgs: ['--version'],
    projectBins: (isWin) => [isWin ? 'pandoc.exe' : 'pandoc', path.join('bin', isWin ? 'pandoc.exe' : 'pandoc')],
  },
  {
    name: '7z',
    tier: 'required',
    pathNames: ['7z', '7za', '7zz'],
    probeArgs: null, // version probe flaky; existence is enough
    projectBins: (isWin) =>
      // Prefer full 7za/7z over reduced 7zr
      isWin ? ['7za.exe', '7z.exe', '7zz.exe', '7zr.exe'] : ['7zz', '7za', '7z'],
    wellKnown: () =>
      process.platform === 'win32' ? ['C:\\Program Files\\7-Zip\\7z.exe'] : [],
  },
  {
    name: 'imagemagick',
    tier: 'optional', // always reported; never required for core AlphaStudio
    pathNames: process.platform === 'win32' ? ['magick', 'convert'] : ['magick', 'convert'],
    probeArgs: ['-version'],
    projectBins: (isWin) => [isWin ? 'magick.exe' : 'magick', isWin ? 'convert.exe' : 'convert'],
  },
  {
    name: 'sharp',
    tier: 'bundled',
    pathNames: [],
    probeArgs: null,
    projectBins: () => [],
  },
  // OCR / PDF extras only when feature flags enabled
  {
    name: 'tesseract',
    tier: 'feature',
    featureGate: 'ocr',
    pathNames: ['tesseract'],
    probeArgs: ['--version'],
    projectBins: (isWin) => [isWin ? 'tesseract.exe' : 'tesseract'],
  },
  {
    name: 'pdftoppm',
    tier: 'feature',
    featureGate: 'pdfExtras',
    pathNames: ['pdftoppm'],
    probeArgs: ['-v'],
    projectBins: (isWin) => [isWin ? 'pdftoppm.exe' : 'pdftoppm'],
  },
];

export function listToolDefs() {
  return TOOL_DEFS.map((t) => t.name);
}

export function getToolDef(name) {
  return TOOL_DEFS.find((t) => t.name === name) || null;
}

/** Names that tools:check treats as primary (missing → exit 2). */
export function requiredToolNames(features = featureFlags()) {
  const names = [];
  for (const d of TOOL_DEFS) {
    if (d.tier === 'bundled') continue;
    if (d.tier === 'required') {
      names.push(d.name);
      continue;
    }
    if (d.name === 'pandoc' && features.pandocRequired) {
      names.push(d.name);
      continue;
    }
    if (d.tier === 'feature' && d.featureGate && features[d.featureGate]) {
      names.push(d.name);
    }
  }
  return names;
}

/** Tools that setup-tools can install portably. */
export function installableToolNames() {
  return ['ffmpeg', 'ffprobe', 'libreoffice', 'pandoc', '7z'];
}

export function probeExec(cmd, args) {
  let tryCmd = cmd;
  if (process.platform === 'win32' && /soffice\.exe$/i.test(cmd)) {
    const com = cmd.replace(/\.exe$/i, '.com');
    if (fs.existsSync(com)) tryCmd = com;
  }
  if (args == null) {
    return fs.existsSync(tryCmd) ? { ok: true, version: path.basename(tryCmd), path: tryCmd } : { ok: false };
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
    if (/LibreOffice|ImageMagick|Version|tesseract|pdftoppm/i.test(msg)) {
      return { ok: true, version: msg.split(/\r?\n/)[0]?.trim(), path: tryCmd };
    }
    // pdftoppm often writes version to stderr with exit 99
    if (e && typeof e === 'object' && e.stderr) {
      const err = String(e.stderr);
      if (/pdftoppm|poppler/i.test(err)) {
        return { ok: true, version: err.split(/\r?\n/)[0]?.trim(), path: tryCmd };
      }
    }
    if (fs.existsSync(tryCmd) && /soffice/i.test(tryCmd)) {
      return { ok: true, version: 'soffice', path: tryCmd };
    }
    return { ok: false };
  }
}

function walkFind(rootDir, basenames) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  const want = new Set(basenames.map((b) => b.toLowerCase()));
  const stack = [rootDir];
  let depthGuard = 0;
  while (stack.length && depthGuard++ < 20_000) {
    const dir = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(dir, withFileTypesSafe());
    } catch {
      continue;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // Skip huge / irrelevant trees (LO help, nested tool downloads, etc.)
        if (
          /node_modules|\.git|help[/\\]media|downloads|ffmpeg-extract|pandoc-extract|libreoffice-msi-extract|share[/\\]extensions/i.test(
            full,
          )
        ) {
          continue;
        }
        stack.push(full);
      } else if (want.has(ent.name.toLowerCase())) return full;
    }
  }
  return null;
}

function withFileTypesSafe() {
  return { withFileTypes: true };
}

function projectSearchRoots(root, toolName) {
  try {
    migrateLegacyTools(root);
  } catch {
    /* ignore */
  }
  // ffprobe lives next to ffmpeg in the same portable build
  const toolDirs = toolName === 'ffprobe' ? ['ffmpeg', 'ffprobe'] : [toolName];
  const roots = [];
  for (const base of toolSearchRoots(root)) {
    for (const td of toolDirs) {
      roots.push(path.join(base, td));
    }
  }
  // Also legacy nested platform folder under .tools
  const { platform, archLabel } = detectPlatform();
  for (const td of toolDirs) {
    roots.push(path.join(legacyToolsRoot(root), platform, archLabel, td));
  }
  return roots;
}

function siblingFfprobe(ffmpegPath) {
  const dir = path.dirname(ffmpegPath);
  const isWin = process.platform === 'win32';
  const candidates = [
    path.join(dir, isWin ? 'ffprobe.exe' : 'ffprobe'),
    path.join(path.dirname(dir), 'bin', isWin ? 'ffprobe.exe' : 'ffprobe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function siblingFfmpeg(ffprobePath) {
  const dir = path.dirname(ffprobePath);
  const isWin = process.platform === 'win32';
  const candidates = [
    path.join(dir, isWin ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(path.dirname(dir), 'bin', isWin ? 'ffmpeg.exe' : 'ffmpeg'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function normalizeLibreOfficePath(execPath) {
  if (process.platform !== 'win32') return execPath;
  if (/soffice\.exe$/i.test(execPath)) {
    const com = execPath.replace(/\.exe$/i, '.com');
    if (fs.existsSync(com)) return com;
  }
  return execPath;
}

function preferFull7z(p) {
  if (!p || !/7zr/i.test(p)) return p;
  const dir = path.dirname(p);
  for (const n of process.platform === 'win32' ? ['7za.exe', '7z.exe'] : ['7zz', '7za', '7z']) {
    const c = path.join(dir, n);
    if (fs.existsSync(c)) return c;
  }
  return p;
}

/**
 * Try system PATH + well-known installs.
 * @returns {{ path: string, version: string, source: 'system' } | null}
 */
function resolveSystem(def) {
  for (const n of def.pathNames || []) {
    const hit = which(n);
    if (!hit) continue;
    if (def.probeArgs == null) {
      return { path: preferFull7z(hit), version: 'path', source: 'system' };
    }
    const p = probeExec(hit, def.probeArgs);
    if (p.ok) return { path: p.path || hit, version: p.version || '', source: 'system' };
  }
  for (const w of def.wellKnown?.() || []) {
    if (!fs.existsSync(w)) continue;
    if (def.probeArgs == null) {
      return { path: preferFull7z(w), version: 'system', source: 'system' };
    }
    const p = probeExec(w, def.probeArgs);
    if (p.ok) return { path: p.path || w, version: p.version || '', source: 'system' };
  }
  return null;
}

/**
 * Try project-local .tools trees.
 * @returns {{ path: string, version: string, source: 'project' } | null}
 */
function resolveProject(def, root) {
  const isWin = process.platform === 'win32';
  const binNames = (def.projectBins?.(isWin) || []).map((b) => path.basename(b));
  for (const searchRoot of projectSearchRoots(root, def.name)) {
    for (const rel of def.projectBins?.(isWin) || []) {
      const candidate = path.isAbsolute(rel) ? rel : path.join(searchRoot, rel);
      if (!fs.existsSync(candidate)) continue;
      if (def.probeArgs == null) {
        return { path: preferFull7z(candidate), version: 'project', source: 'project' };
      }
      const p = probeExec(candidate, def.probeArgs);
      if (p.ok) return { path: p.path || candidate, version: p.version || '', source: 'project' };
    }
    if (binNames.length) {
      const walked = walkFind(searchRoot, binNames);
      if (walked) {
        if (def.probeArgs == null) {
          return { path: preferFull7z(walked), version: 'project', source: 'project' };
        }
        const p = probeExec(walked, def.probeArgs);
        if (p.ok) return { path: p.path || walked, version: p.version || '', source: 'project' };
      }
    }
  }
  return null;
}

/**
 * Resolve one tool.
 * Fast path (default): valid manifest cache → return without re-exec.
 * Prefer system when forceProbe / cold resolve; install path uses same preference.
 *
 * @param {string} name
 * @param {string} [root]
 * @param {{ forceProbe?: boolean, preferSystem?: boolean }} [opts]
 * @returns {{ name: string, available: boolean, path: string, version: string, source: string, cached?: boolean, tier?: string }}
 */
export function resolveTool(name, root = projectRoot, opts = {}) {
  const forceProbe = !!opts.forceProbe;
  const preferSystem = opts.preferSystem !== false; // default true for cold resolve
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return { name, available: false, path: '', version: '', source: '', tier: '' };

  // Bundled (sharp / libvips via npm sharp)
  if (def.tier === 'bundled') {
    return {
      name,
      available: true,
      path: 'bundled',
      version: 'bundled',
      source: 'bundled',
      cached: true,
      tier: 'bundled',
    };
  }

  // Feature-gated tools skipped when flag off (report as skipped, not missing)
  const features = featureFlags();
  if (def.tier === 'feature' && def.featureGate && !features[def.featureGate]) {
    return {
      name,
      available: false,
      path: '',
      version: '',
      source: '',
      skipped: true,
      tier: 'feature',
    };
  }

  const manifest = loadManifest(root);
  const man = manifest.tools[name];

  // Fast cache: trust manifest when identity matches (tools:check hot path)
  if (!forceProbe && man) {
    const cache = isEntryCacheValid(man);
    if (cache.ok) {
      let p = man.executablePath;
      if (name === 'libreoffice') p = normalizeLibreOfficePath(p);
      if (name === '7z') p = preferFull7z(p);
      return {
        name,
        available: true,
        path: p,
        version: man.version || '',
        source: man.source || 'manifest',
        cached: true,
        tier: def.tier,
      };
    }
  }

  // Cold resolve / forceProbe: prefer system, then project, then re-check manifest path via probe
  if (preferSystem) {
    const sys = resolveSystem(def);
    if (sys) {
      let p = sys.path;
      if (name === 'libreoffice') p = normalizeLibreOfficePath(p);
      return { name, available: true, path: p, version: sys.version, source: 'system', cached: false, tier: def.tier };
    }
  }

  const proj = resolveProject(def, root);
  if (proj) {
    let p = proj.path;
    if (name === 'libreoffice') p = normalizeLibreOfficePath(p);
    return { name, available: true, path: p, version: proj.version, source: 'project', cached: false, tier: def.tier };
  }

  if (!preferSystem) {
    const sys = resolveSystem(def);
    if (sys) {
      let p = sys.path;
      if (name === 'libreoffice') p = normalizeLibreOfficePath(p);
      return { name, available: true, path: p, version: sys.version, source: 'system', cached: false, tier: def.tier };
    }
  }

  // Last resort: probe stale manifest path even if identity changed
  if (man?.executablePath && fs.existsSync(man.executablePath)) {
    if (def.probeArgs == null) {
      return {
        name,
        available: true,
        path: preferFull7z(man.executablePath),
        version: man.version || 'ok',
        source: man.source || 'manifest',
        cached: false,
        tier: def.tier,
      };
    }
    const p = probeExec(man.executablePath, def.probeArgs);
    if (p.ok) {
      return {
        name,
        available: true,
        path: p.path || man.executablePath,
        version: p.version || man.version || '',
        source: man.source || 'manifest',
        cached: false,
        tier: def.tier,
      };
    }
  }

  return { name, available: false, path: '', version: '', source: '', cached: false, tier: def.tier };
}

/**
 * Resolve all tools; force ffmpeg+ffprobe from the same install directory.
 * @param {string} [root]
 * @param {{ forceProbe?: boolean }} [opts]
 */
export function checkAllTools(root = projectRoot, opts = {}) {
  const features = featureFlags();
  // Only include feature tools when enabled (plus always-listed core set for UI)
  const defs = TOOL_DEFS.filter((d) => {
    if (d.tier === 'feature' && d.featureGate && !features[d.featureGate]) return false;
    return true;
  });

  /** @type {Map<string, ReturnType<typeof resolveTool>>} */
  const byName = new Map();
  for (const d of defs) {
    byName.set(d.name, resolveTool(d.name, root, opts));
  }

  // Co-locate ffmpeg + ffprobe (same build)
  let ffmpeg = byName.get('ffmpeg');
  let ffprobe = byName.get('ffprobe');
  if (ffmpeg?.available && ffmpeg.path && ffmpeg.path !== 'bundled') {
    const sib = siblingFfprobe(ffmpeg.path);
    if (sib) {
      if (opts.forceProbe) {
        const p = probeExec(sib, ['-version']);
        if (p.ok) {
          ffprobe = {
            name: 'ffprobe',
            available: true,
            path: p.path || sib,
            version: p.version || '',
            source: ffmpeg.source,
            cached: false,
            tier: 'required',
          };
        }
      } else if (fs.existsSync(sib)) {
        // Prefer sibling when cache/path mismatched
        if (!ffprobe?.available || path.dirname(ffprobe.path) !== path.dirname(ffmpeg.path)) {
          ffprobe = {
            name: 'ffprobe',
            available: true,
            path: sib,
            version: ffprobe?.version || '',
            source: ffmpeg.source,
            cached: ffmpeg.cached,
            tier: 'required',
          };
        }
      }
    }
  } else if (ffprobe?.available && ffprobe.path) {
    const sib = siblingFfmpeg(ffprobe.path);
    if (sib && fs.existsSync(sib)) {
      if (opts.forceProbe) {
        const p = probeExec(sib, ['-version']);
        if (p.ok) {
          ffmpeg = {
            name: 'ffmpeg',
            available: true,
            path: p.path || sib,
            version: p.version || '',
            source: ffprobe.source,
            cached: false,
            tier: 'required',
          };
        }
      } else {
        ffmpeg = {
          name: 'ffmpeg',
          available: true,
          path: sib,
          version: ffmpeg?.version || '',
          source: ffprobe.source,
          cached: ffprobe.cached,
          tier: 'required',
        };
      }
    }
  }
  if (ffmpeg) byName.set('ffmpeg', ffmpeg);
  if (ffprobe) byName.set('ffprobe', ffprobe);

  return defs.map((d) => byName.get(d.name) || resolveTool(d.name, root, opts));
}

/**
 * Which required tools are missing (for install).
 * @param {string} [root]
 * @param {{ forceProbe?: boolean }} [opts]
 */
export function missingRequiredTools(root = projectRoot, opts = {}) {
  const required = new Set(requiredToolNames());
  return checkAllTools(root, opts).filter((t) => required.has(t.name) && !t.available && !t.skipped);
}

export function repairInstructions(missingNames) {
  const lines = [
    'ACTION REQUIRED: Install or repair missing tools:',
    '  npm run tools:install     # project-local portable binaries under .runtime/tools/ (no admin)',
    '  npm run tools:repair      # re-scan + fix paths / checksums',
    '  Or install system packages and re-run npm run tools:check',
  ];
  if (missingNames?.length) {
    lines.push(`  Missing: ${missingNames.join(', ')}`);
  }
  lines.push(
    '  Manual: place binaries under .runtime/tools/<platform>-<arch>/<tool>/ then npm run tools:repair',
    '  OCR extras: set ALPHA_FEATURE_OCR=1  |  PDF extras: ALPHA_FEATURE_PDF_EXTRAS=1',
  );
  return lines.join('\n');
}

export { isExecutableFile, siblingFfprobe, siblingFfmpeg, normalizeLibreOfficePath };
