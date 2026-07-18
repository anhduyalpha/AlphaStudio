import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repo root: server/src/tools → ../../.. */
export const projectRoot = path.resolve(__dirname, '../../..');
/**
 * Canonical non-npm tool root: .runtime/
 * Legacy .tools/ still searched for discovery/migration.
 */
export const runtimeDir = path.join(projectRoot, '.runtime');
export const toolsDir = runtimeDir; // config/manifest live under .runtime
export const legacyToolsDir = path.join(projectRoot, '.tools');
export const toolsConfigPath = path.join(toolsDir, 'config.json');
export const toolsManifestPath = path.join(toolsDir, 'manifest.json');

const EXTERNAL_TOOLS = [
  'ffmpeg',
  'ffprobe',
  '7z',
  'libreoffice',
  'pandoc',
  'calibre',
] as const;

export type ToolEntry = {
  name: string;
  path: string;
  version?: string;
  available: boolean;
  source?: 'path' | 'project' | 'bundled' | 'manifest' | 'system';
};

export type ToolsConfig = {
  updatedAt: string;
  tools: Record<string, { path: string; version?: string }>;
};

/** Manifest entry shape written by scripts/maint/lib/manifest.mjs (v2). */
type ManifestToolEntry = {
  name?: string;
  version?: string;
  executablePath?: string;
  checksum?: string;
  size?: number;
  mtimeMs?: number;
  source?: string;
  validatedAt?: string;
};

type ToolsManifest = {
  version?: number;
  updatedAt?: string;
  platform?: string;
  architecture?: string;
  tools?: Record<string, ManifestToolEntry>;
};

/** In-memory cache of last resolveAllTools result (process lifetime). */
let toolsCache: Record<string, ToolEntry> | null = null;

export function loadToolsConfig(): ToolsConfig {
  try {
    if (fs.existsSync(toolsConfigPath)) {
      return JSON.parse(fs.readFileSync(toolsConfigPath, 'utf8')) as ToolsConfig;
    }
  } catch {
    /* ignore */
  }
  // Seed from atomic manifest when config.json is missing
  const fromMan = toolsConfigFromManifest();
  if (fromMan) return fromMan;
  return { updatedAt: '', tools: {} };
}

function loadToolsManifest(): ToolsManifest | null {
  try {
    if (!fs.existsSync(toolsManifestPath)) return null;
    return JSON.parse(fs.readFileSync(toolsManifestPath, 'utf8')) as ToolsManifest;
  } catch {
    return null;
  }
}

function toolsConfigFromManifest(): ToolsConfig | null {
  const man = loadToolsManifest();
  if (!man?.tools) return null;
  const tools: ToolsConfig['tools'] = {};
  for (const [name, entry] of Object.entries(man.tools)) {
    const p = entry.executablePath;
    if (!p || p === 'bundled') continue;
    tools[name] = { path: p, version: entry.version || '' };
  }
  if (!Object.keys(tools).length) return null;
  return { updatedAt: man.updatedAt || '', tools };
}

/**
 * Prefer configured path from config.json; fall back to manifest.json executablePath.
 * Both are written atomically by maint tools scripts.
 */
function configuredPath(name: string): { path: string; version?: string; source: ToolEntry['source'] } | null {
  const cfg = loadToolsConfig();
  const c = cfg.tools[name];
  if (c?.path && fs.existsSync(c.path)) {
    return { path: c.path, version: c.version, source: 'project' };
  }
  const man = loadToolsManifest();
  const m = man?.tools?.[name];
  if (m?.executablePath && m.executablePath !== 'bundled' && fs.existsSync(m.executablePath)) {
    // Fast identity trust: if size+mtime still match, skip heavy re-probe later when possible
    if (m.size != null || m.mtimeMs != null) {
      try {
        const st = fs.statSync(m.executablePath);
        if (
          (m.size == null || st.size === m.size) &&
          (m.mtimeMs == null || Math.trunc(st.mtimeMs) === m.mtimeMs)
        ) {
          return { path: m.executablePath, version: m.version, source: (m.source as ToolEntry['source']) || 'manifest' };
        }
      } catch {
        /* fall through */
      }
    }
    return { path: m.executablePath, version: m.version, source: 'manifest' };
  }
  return null;
}

/** Atomically write tools config after validation (tmp + rename) */
export function saveToolsConfigAtomic(cfg: ToolsConfig): void {
  fs.mkdirSync(toolsDir, { recursive: true });
  cfg.updatedAt = new Date().toISOString();
  const tmp = `${toolsConfigPath}.tmp.${process.pid}.${Date.now()}`;
  const body = JSON.stringify(cfg, null, 2);
  fs.writeFileSync(tmp, body, 'utf8');
  // Validate before rename
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  try {
    fs.renameSync(tmp, toolsConfigPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EACCES') {
      try {
        fs.unlinkSync(toolsConfigPath);
      } catch {
        /* ignore */
      }
      fs.renameSync(tmp, toolsConfigPath);
    } else {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
}

export function saveToolsConfig(cfg: ToolsConfig): void {
  // Always atomic (tmp + rename) — used by setup/repair paths
  saveToolsConfigAtomic(cfg);
}

/**
 * Keep config.json in sync with a resolved tool map (atomic).
 * Does not rewrite full manifest.json (owned by maint scripts).
 */
export function syncConfigFromResolved(entries: Record<string, ToolEntry>): void {
  const tools: ToolsConfig['tools'] = {};
  for (const [name, t] of Object.entries(entries)) {
    if (!t.available || !t.path || t.path === 'bundled' || t.source === 'bundled') continue;
    tools[name] = { path: t.path, version: t.version || '' };
  }
  saveToolsConfigAtomic({ updatedAt: '', tools });
}

function probe(execPath: string, args: string[]): { ok: boolean; version?: string } {
  // Windows LO: soffice.com is the reliable CLI entry
  let cmd = execPath;
  if (process.platform === 'win32' && /soffice\.exe$/i.test(cmd)) {
    const com = cmd.replace(/\.exe$/i, '.com');
    if (fs.existsSync(com)) cmd = com;
  }
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const first = String(out).split(/\r?\n/)[0]?.trim();
    return { ok: true, version: first };
  } catch (e) {
    const msg = e && typeof e === 'object' && 'stdout' in e ? String((e as { stdout?: string }).stdout || (e as { stderr?: string }).stderr || '') : '';
    if (/LibreOffice/i.test(msg)) return { ok: true, version: msg.split(/\r?\n/)[0]?.trim() };
    try {
      const out = execFileSync(cmd, ['--version'], {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, version: String(out).split(/\r?\n/)[0]?.trim() };
    } catch {
      // Binary exists — treat as available for LO (headless convert may still work)
      if (fs.existsSync(cmd) && /soffice/i.test(cmd)) {
        return { ok: true, version: 'soffice' };
      }
      return { ok: false };
    }
  }
}

function whichCandidates(name: string): string[] {
  const isWin = process.platform === 'win32';
  const names = isWin ? [`${name}.exe`, name] : [name];
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const hits: string[] = [];
  for (const dir of dirs) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) hits.push(p);
    }
  }
  return hits;
}

function platformArch(): { plat: string; arch: string; label: string } {
  const plat = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return { plat, arch, label: `${plat}-${arch}` };
}

/** Canonical: .runtime/tools/<platform>-<arch> */
function platformToolsRoot(): string {
  const { label } = platformArch();
  return path.join(runtimeDir, 'tools', label);
}

/** All roots to search for portable tool trees (modern + legacy). */
function projectToolRoots(): string[] {
  const { plat, arch, label } = platformArch();
  return [
    path.join(runtimeDir, 'tools', label),
    path.join(runtimeDir, 'tools'),
    runtimeDir,
    path.join(legacyToolsDir, plat, arch),
    legacyToolsDir,
  ];
}

/** Prefer full 7z.exe over reduced 7zr.exe */
function sevenZipCandidates(): string[] {
  const isWin = process.platform === 'win32';
  const roots = projectToolRoots();
  const names = isWin
    ? ['7z.exe', '7za.exe', '7zz.exe'] // full first; 7zr last (reduced)
    : ['7zz', '7z', '7za'];
  const reduced = isWin ? ['7zr.exe'] : [];
  const hits: string[] = [];
  for (const root of roots) {
    for (const n of names) {
      const p = path.join(root, '7z', n);
      if (fs.existsSync(p)) hits.push(p);
    }
    for (const n of names) {
      const p = path.join(root, n);
      if (fs.existsSync(p)) hits.push(p);
    }
  }
  // reduced only if nothing else
  if (hits.length === 0) {
    for (const root of roots) {
      for (const n of reduced) {
        const p = path.join(root, '7z', n);
        if (fs.existsSync(p)) hits.push(p);
      }
    }
  }
  return hits;
}

function projectCandidates(tool: string): string[] {
  const isWin = process.platform === 'win32';
  const roots = projectToolRoots();
  const rels: Record<string, string[]> = {
    ffmpeg: [
      isWin ? 'ffmpeg/bin/ffmpeg.exe' : 'ffmpeg/bin/ffmpeg',
      isWin ? 'ffmpeg/ffmpeg.exe' : 'ffmpeg/ffmpeg',
    ],
    ffprobe: [
      isWin ? 'ffmpeg/bin/ffprobe.exe' : 'ffmpeg/bin/ffprobe',
      isWin ? 'ffmpeg/ffprobe.exe' : 'ffmpeg/ffprobe',
    ],
    libreoffice: isWin
      ? [
          'libreoffice/program/soffice.com',
          'libreoffice/program/soffice.exe',
          'LibreOffice/program/soffice.com',
          'LibreOffice/program/soffice.exe',
        ]
      : ['libreoffice/program/soffice', 'libreoffice/soffice'],
    pandoc: [isWin ? 'pandoc/pandoc.exe' : 'pandoc/pandoc'],
    calibre: [
      isWin ? 'calibre/ebook-convert.exe' : 'calibre/ebook-convert',
      isWin ? 'Calibre2/ebook-convert.exe' : 'Calibre2/ebook-convert',
      isWin ? 'calibre/bin/ebook-convert.exe' : 'calibre/bin/ebook-convert',
    ],
  };
  if (tool === '7z') return sevenZipCandidates();
  const hits: string[] = [];
  for (const root of roots) {
    for (const rel of rels[tool] || []) {
      const p = path.join(root, rel);
      if (fs.existsSync(p)) hits.push(p);
    }
  }
  return hits;
}

function wellKnownCandidates(tool: string): string[] {
  if (tool !== 'calibre') return [];
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Calibre2\\ebook-convert.exe',
          'C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/calibre.app/Contents/MacOS/ebook-convert']
        : ['/usr/bin/ebook-convert', '/usr/local/bin/ebook-convert'];
  return candidates.filter((candidate) => fs.existsSync(candidate));
}

/** Windows: always prefer soffice.com over .exe when sibling exists */
export function normalizeLibreOfficePath(execPath: string): string {
  if (process.platform !== 'win32') return execPath;
  if (/soffice\.exe$/i.test(execPath)) {
    const com = execPath.replace(/\.exe$/i, '.com');
    if (fs.existsSync(com)) return com;
  }
  return execPath;
}

/**
 * True when LibreOffice install looks complete (not a bare copied executable).
 * Requires program dir + foundational files so "platform independent libraries <prefix>" is avoided.
 */
export function isLibreOfficeInstallComplete(execPath: string): boolean {
  if (!execPath || !fs.existsSync(execPath)) return false;
  const programDir = path.dirname(execPath);
  // Must live under a .../program directory
  if (!/program$/i.test(programDir)) {
    // Allow system PATH soffice that is a shim — still require sibling program layout when possible
    const siblingProgram = path.join(path.dirname(execPath), 'program');
    if (fs.existsSync(siblingProgram)) {
      return hasLoProgramFiles(siblingProgram);
    }
    // System install: executable exists and probe already succeeded
    return true;
  }
  return hasLoProgramFiles(programDir);
}

function hasLoProgramFiles(programDir: string): boolean {
  const required = [
    // Core binary presence
    process.platform === 'win32' ? 'soffice.bin' : 'soffice.bin',
  ];
  // Bootstrap / fundamental libraries
  const optionalMarkers = [
    'fundamentalrc',
    'fundamental.ini',
    'versionrc',
    'version.ini',
    'types.rdb',
    'services.rdb',
  ];
  let markers = 0;
  for (const f of required) {
    if (!fs.existsSync(path.join(programDir, f)) && process.platform === 'win32') {
      // soffice.bin required on Windows portable installs
      if (!fs.existsSync(path.join(programDir, 'soffice.exe'))) return false;
    }
  }
  for (const f of optionalMarkers) {
    if (fs.existsSync(path.join(programDir, f))) markers += 1;
  }
  // Also accept when python-core / resource dirs exist (full install)
  const resourceHints = ['resource', 'shell', 'services'];
  for (const d of resourceHints) {
    try {
      if (fs.existsSync(path.join(programDir, d))) markers += 1;
    } catch {
      /* ignore */
    }
  }
  // Bare single-file copy would have markers === 0
  return markers >= 1 || fs.existsSync(path.join(programDir, 'soffice.bin'));
}

/** If ffmpeg dir has ffprobe sibling, return it; else empty */
function siblingFfprobe(ffmpegPath: string): string | null {
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

function siblingFfmpeg(ffprobePath: string): string | null {
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

const PROBE_ARGS: Record<string, string[]> = {
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
  '7z': [],
  libreoffice: ['--version'],
  pandoc: ['--version'],
  calibre: ['--version'],
};

function finalizeEntry(name: string, execPath: string, version: string | undefined, source: ToolEntry['source']): ToolEntry {
  let p = execPath;
  if (name === 'libreoffice') p = normalizeLibreOfficePath(p);
  // Prefer full 7z over 7zr if we accidentally resolved reduced
  if (name === '7z' && /7zr/i.test(p)) {
    const better = sevenZipCandidates().find((c) => !/7zr/i.test(c));
    if (better) p = better;
  }
  return { name, path: p, available: true, version, source };
}

function bundledTools(): Record<string, ToolEntry> {
  return {
    sharp: { name: 'sharp', path: 'sharp', available: true, version: 'bundled', source: 'bundled' },
    'pdf-lib': { name: 'pdf-lib', path: 'pdf-lib', available: true, version: 'bundled', source: 'bundled' },
  };
}

/**
 * True when we can trust a configured path without execFileSync:
 * binary exists and a version string is stored in config and/or manifest.
 */
function canTrustWithoutProbe(
  name: string,
  execPath: string,
  version: string | undefined,
  source: ToolEntry['source'],
): boolean {
  if (!execPath || !fs.existsSync(execPath)) return false;
  if (version !== undefined && version !== '') return true;

  // Manifest size+mtime identity is an alternative to a stored version string
  if (source === 'manifest') {
    const man = loadToolsManifest()?.tools?.[name];
    if (!man || man.executablePath !== execPath) return false;
    if (man.size == null && man.mtimeMs == null) return false;
    try {
      const st = fs.statSync(execPath);
      return (
        (man.size == null || st.size === man.size) &&
        (man.mtimeMs == null || Math.trunc(st.mtimeMs) === man.mtimeMs)
      );
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Load tools from config/manifest without any execFileSync.
 * Valid when every configured entry has an existing path and a stored version
 * (or matching manifest identity). Returns null → caller must full-probe.
 */
function tryLoadValidatedCache(): Record<string, ToolEntry> | null {
  const cfg = loadToolsConfig();
  const man = loadToolsManifest();
  if ((!cfg.tools || !Object.keys(cfg.tools).length) && !man?.tools) return null;

  const out: Record<string, ToolEntry> = { ...bundledTools() };
  let sawConfigured = false;

  for (const name of EXTERNAL_TOOLS) {
    const conf = configuredPath(name);
    if (!conf) {
      out[name] = { name, path: '', available: false };
      continue;
    }
    let p = conf.path;
    if (name === 'libreoffice') p = normalizeLibreOfficePath(p);
    if (!canTrustWithoutProbe(name, p, conf.version, conf.source)) {
      // Incomplete / stale — force full re-probe of the whole set
      return null;
    }
    out[name] = {
      name,
      path: p,
      available: true,
      version: conf.version || man?.tools?.[name]?.version,
      source: conf.source,
    };
    sawConfigured = true;
  }

  if (!sawConfigured) return null;

  // Co-locate ffmpeg/ffprobe via sibling path existence only (no exec)
  if (out.ffmpeg?.available && out.ffmpeg.path) {
    const sib = siblingFfprobe(out.ffmpeg.path);
    if (sib) {
      const sameDir =
        out.ffprobe?.available &&
        path.normalize(path.dirname(out.ffprobe.path)).toLowerCase() ===
          path.normalize(path.dirname(out.ffmpeg.path)).toLowerCase();
      if (!sameDir) {
        out.ffprobe = {
          name: 'ffprobe',
          path: sib,
          available: true,
          version: out.ffprobe?.version || cfg.tools.ffprobe?.version || man?.tools?.ffprobe?.version,
          source: out.ffmpeg.source,
        };
      }
    }
  } else if (out.ffprobe?.available && out.ffprobe.path) {
    const sib = siblingFfmpeg(out.ffprobe.path);
    if (sib) {
      out.ffmpeg = {
        name: 'ffmpeg',
        path: sib,
        available: true,
        version: out.ffmpeg?.version || cfg.tools.ffmpeg?.version || man?.tools?.ffmpeg?.version,
        source: out.ffprobe.source,
      };
    }
  }

  return out;
}

/** Full single-tool resolve with execFileSync probing (slow path). */
function resolveToolProbing(name: string): ToolEntry {
  if (name === 'sharp') {
    return { name: 'sharp', path: 'sharp', available: true, version: 'bundled', source: 'bundled' };
  }
  if (name === 'pdf-lib') {
    return { name: 'pdf-lib', path: 'pdf-lib', available: true, version: 'bundled', source: 'bundled' };
  }

  const configured = configuredPath(name);
  let configuredExec = configured?.path;
  if (name === 'libreoffice' && configuredExec) configuredExec = normalizeLibreOfficePath(configuredExec);

  if (configuredExec && fs.existsSync(configuredExec)) {
    const args = PROBE_ARGS[name] ?? ['--version'];
    const p = probe(configuredExec, args.length ? args : name === '7z' ? [] : ['--version']);
    if (p.ok || (name === 'libreoffice' && fs.existsSync(configuredExec)) || name === '7z') {
      return finalizeEntry(
        name,
        configuredExec,
        p.version || configured?.version,
        configured?.source || 'project',
      );
    }
  }

  for (const candidate of projectCandidates(name)) {
    const args = PROBE_ARGS[name] ?? ['--version'];
    const p = probe(candidate, args.length ? args : []);
    if (p.ok || name === '7z') return finalizeEntry(name, candidate, p.version || 'project', 'project');
  }

  for (const candidate of wellKnownCandidates(name)) {
    const args = PROBE_ARGS[name] ?? ['--version'];
    const p = probe(candidate, args);
    if (p.ok) return finalizeEntry(name, candidate, p.version, 'system');
  }

  // PATH names
  const pathNames =
    name === 'libreoffice'
      ? process.platform === 'win32'
        ? ['soffice.com', 'soffice', 'soffice.exe']
        : ['soffice', 'libreoffice']
      : name === '7z'
        ? ['7z', '7za', '7zz'] // not 7zr first
        : name === 'calibre'
          ? ['ebook-convert']
        : [name];

  for (const pn of pathNames) {
    const hits = whichCandidates(pn);
    for (const h of hits) {
      const args = PROBE_ARGS[name] ?? ['--version'];
      const p = probe(h, name === '7z' ? [] : args);
      if (p.ok || name === '7z') {
        if (name === '7z') {
          try {
            execFileSync(h, [], { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/7-Zip|7z/i.test(msg) || /Command line error/i.test(msg)) {
              return finalizeEntry(name, h, '7z', 'path');
            }
          }
          try {
            const out = execFileSync(h, ['--help'], { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            if (/7-Zip|7z/i.test(out)) return finalizeEntry(name, h, '7z', 'path');
          } catch {
            /* continue */
          }
        } else if (p.ok) {
          return finalizeEntry(name, h, p.version, 'path');
        }
      }
    }
    if (name !== '7z') {
      const p = probe(pn, PROBE_ARGS[name] ?? ['--version']);
      if (p.ok) return finalizeEntry(name, pn, p.version, 'path');
    }
  }

  return { name, path: '', available: false };
}

/**
 * Resolve a tool: memory cache → config/manifest (no probe) → project .tools → PATH.
 */
export function resolveTool(name: string): ToolEntry {
  if (toolsCache?.[name]) return toolsCache[name];

  if (name === 'sharp' || name === 'pdf-lib') {
    return bundledTools()[name];
  }

  // Fast path: trust config/manifest when path exists + version/identity valid
  const configured = configuredPath(name);
  if (configured) {
    let p = configured.path;
    if (name === 'libreoffice') p = normalizeLibreOfficePath(p);
    if (canTrustWithoutProbe(name, p, configured.version, configured.source)) {
      return finalizeEntry(name, p, configured.version, configured.source);
    }
  }

  return resolveToolProbing(name);
}

/**
 * Resolve all tools with ffmpeg+ffprobe forced to the same install directory.
 * When force=false and .tools/config.json (or manifest) is valid, skips execFileSync probing.
 */
export function resolveAllTools(force = false): Record<string, ToolEntry> {
  if (toolsCache && !force) return toolsCache;

  if (!force) {
    const cached = tryLoadValidatedCache();
    if (cached) {
      toolsCache = cached;
      return cached;
    }
  }

  let ffmpeg = resolveToolProbing('ffmpeg');
  let ffprobe = resolveToolProbing('ffprobe');

  // Co-locate: prefer siblings from the same bin dir (same build)
  if (ffmpeg.available && ffmpeg.path) {
    const sib = siblingFfprobe(ffmpeg.path);
    if (sib) {
      const p = probe(sib, ['-version']);
      if (p.ok) {
        ffprobe = { name: 'ffprobe', path: sib, available: true, version: p.version, source: ffmpeg.source };
      } else if (fs.existsSync(sib)) {
        ffprobe = { name: 'ffprobe', path: sib, available: true, version: ffprobe.version, source: ffmpeg.source };
      }
    }
  } else if (ffprobe.available && ffprobe.path) {
    const sib = siblingFfmpeg(ffprobe.path);
    if (sib) {
      const p = probe(sib, ['-version']);
      if (p.ok) {
        ffmpeg = { name: 'ffmpeg', path: sib, available: true, version: p.version, source: ffprobe.source };
      }
    }
  }

  const result: Record<string, ToolEntry> = {
    ffmpeg,
    ffprobe,
    '7z': resolveToolProbing('7z'),
    libreoffice: resolveToolProbing('libreoffice'),
    pandoc: resolveToolProbing('pandoc'),
    calibre: resolveToolProbing('calibre'),
    ...bundledTools(),
  };

  try {
    syncConfigFromResolved(result);
  } catch {
    /* non-fatal — startup continues without disk cache write */
  }

  toolsCache = result;
  return result;
}

/** Clear in-memory tool resolution cache (tests / explicit refresh). */
export function clearToolsCache(): void {
  toolsCache = null;
}

export function requireTool(name: string): ToolEntry {
  const t = resolveTool(name);
  if (!t.available) {
    const hints: Record<string, string> = {
      ffmpeg: `Run "npm run tools:install" to install ffmpeg into .tools, or add ffmpeg to PATH.`,
      ffprobe: `Run "npm run tools:install" to install ffprobe with ffmpeg into .tools.`,
      libreoffice: `Install LibreOffice and ensure soffice is on PATH, or place a portable copy under .tools/libreoffice and run npm run tools:repair.`,
      '7z': `Install 7-Zip or place 7z.exe under .tools/7z, then run npm run tools:repair.`,
      pandoc: `Install pandoc or place binary under .tools/pandoc, then run npm run tools:repair.`,
      calibre: `Install Calibre's ebook-convert with "npm run tools:install -- --profile ebooks", or add ebook-convert to PATH.`,
    };
    // dynamic import avoided; construct AppError-compatible throw
    const err = new Error(hints[name] || `${name} is not available. Run npm run tools:check.`) as Error & {
      statusCode: number;
      code: string;
      details: unknown;
    };
    err.statusCode = 503;
    err.code = 'UNAVAILABLE';
    err.details = { tool: name };
    err.name = 'AppError';
    throw err;
  }
  return t;
}
