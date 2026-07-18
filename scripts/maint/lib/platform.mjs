/**
 * Cross-platform environment detection for AlphaStudio maintenance scripts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '../../..');

/** @type {ReturnType<typeof detectPlatform> | null} */
let _platformCache = null;

/** @returns {{ os: 'windows'|'linux'|'macos'|'other', platform: string, arch: string, archLabel: string }} */
export function detectPlatform() {
  if (_platformCache) return _platformCache;
  const platform = process.platform;
  const arch = process.arch;
  let os = 'other';
  if (platform === 'win32') os = 'windows';
  else if (platform === 'linux') os = 'linux';
  else if (platform === 'darwin') os = 'macos';

  let archLabel = arch;
  if (arch === 'x64' || arch === 'x86_64') archLabel = 'x64';
  else if (arch === 'arm64' || arch === 'aarch64') archLabel = 'arm64';
  else if (arch === 'ia32') archLabel = 'x86';

  _platformCache = { os, platform, arch, archLabel };
  return _platformCache;
}

/** Clear platform cache (tests only). */
export function resetPlatformCache() {
  _platformCache = null;
}

/**
 * Feature flags for optional / extras tooling.
 * OCR/PDF extras install only when explicitly enabled.
 * @returns {{ ocr: boolean, pdfExtras: boolean, imagemagick: boolean, pandocRequired: boolean }}
 */
export function featureFlags(env = process.env) {
  const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));
  return {
    ocr: truthy(env.ALPHA_FEATURE_OCR) || truthy(env.ALPHASTUDIO_FEATURE_OCR),
    pdfExtras: truthy(env.ALPHA_FEATURE_PDF_EXTRAS) || truthy(env.ALPHASTUDIO_FEATURE_PDF_EXTRAS),
    imagemagick: truthy(env.ALPHA_FEATURE_IMAGEMAGICK) || truthy(env.ALPHASTUDIO_FEATURE_IMAGEMAGICK),
    // Pandoc is used by some text conversions; required unless explicitly disabled
    // AlphaStudio 3.6 does not invoke Pandoc at runtime. Keep it opt-in so a
    // default tool install does not consume ~200 MiB for an unused binary.
    pandocRequired:
      truthy(env.ALPHA_REQUIRE_PANDOC) &&
      !truthy(env.ALPHA_SKIP_PANDOC) &&
      !truthy(env.ALPHASTUDIO_SKIP_PANDOC),
  };
}

/** Detect available package managers (presence on PATH only — never installs via them by default). */
export function detectPackageManagers() {
  const candidates =
    process.platform === 'win32'
      ? ['npm', 'pnpm', 'yarn', 'choco', 'scoop', 'winget']
      : process.platform === 'darwin'
        ? ['npm', 'pnpm', 'yarn', 'brew', 'port']
        : ['npm', 'pnpm', 'yarn', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'apk', 'zypper'];

  const found = [];
  for (const name of candidates) {
    const p = which(name);
    if (p) found.push({ name, path: p });
  }
  return found;
}

/** Find executable on PATH (returns absolute path or null). */
export function which(name) {
  const isWin = process.platform === 'win32';
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = isWin ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
  for (const dir of dirs) {
    for (const n of names) {
      const full = path.join(dir, n);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/**
 * Canonical non-npm runtime root:
 *   .runtime/tools/<platform>-<arch>/
 *   .runtime/cache|downloads|manifests|tmp
 * Legacy `.tools/` is still discovered and migrated into `.runtime`.
 */
export function runtimeRoot(root = projectRoot) {
  return path.join(root, '.runtime');
}

/** Platform-arch segment e.g. win32-x64 */
export function platformArchLabel(root = projectRoot) {
  void root;
  const { platform, archLabel } = detectPlatform();
  return `${platform}-${archLabel}`;
}

/**
 * Project-local tools install dir:
 *   .runtime/tools/<platform>-<arch>
 * Falls back to legacy .tools/<platform>/<arch> when present and runtime empty.
 */
export function toolsPlatformDir(root = projectRoot) {
  const { platform, archLabel } = detectPlatform();
  const modern = path.join(root, '.runtime', 'tools', `${platform}-${archLabel}`);
  const legacyNested = path.join(root, '.tools', platform, archLabel);
  // Prefer modern path always for writes; discovery checks both
  return modern;
}

/** Legacy flat .tools root (still supported for discovery / migration). */
export function toolsRoot(root = projectRoot) {
  // Prefer .runtime for config/manifest storage; installers also read .tools
  const modern = path.join(root, '.runtime');
  const legacy = path.join(root, '.tools');
  // toolsRoot historically meant the parent of tool trees; keep API: return .runtime
  // when it exists OR always return .runtime as canonical write root
  void legacy;
  return modern;
}

/** Legacy .tools path for migration/discovery only. */
export function legacyToolsRoot(root = projectRoot) {
  return path.join(root, '.tools');
}

/**
 * All roots to search for portable binaries (order: modern platform, modern flat,
 * legacy platform, legacy flat).
 */
export function toolSearchRoots(root = projectRoot) {
  const { platform, archLabel } = detectPlatform();
  const roots = [
    path.join(root, '.runtime', 'tools', `${platform}-${archLabel}`),
    path.join(root, '.runtime', 'tools'),
    path.join(root, '.runtime'),
    path.join(root, '.tools', platform, archLabel),
    path.join(root, '.tools'),
  ];
  // de-dupe
  return [...new Set(roots.map((r) => path.resolve(r)))];
}

/**
 * Best-effort migrate .tools → .runtime/tools/<platform-arch> when destination missing.
 * Does not re-download; only copies existing trees.
 */
export function migrateLegacyTools(root = projectRoot) {
  const { platform, archLabel } = detectPlatform();
  const dest = path.join(root, '.runtime', 'tools', `${platform}-${archLabel}`);
  const sources = [
    path.join(root, '.tools', platform, archLabel),
    path.join(root, '.tools'),
  ];
  const moved = [];
  fs.mkdirSync(path.join(root, '.runtime', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, '.runtime', 'cache'), { recursive: true });
  fs.mkdirSync(path.join(root, '.runtime', 'downloads'), { recursive: true });
  fs.mkdirSync(path.join(root, '.runtime', 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.runtime', 'tmp'), { recursive: true });

  for (const tool of ['ffmpeg', '7z', 'pandoc', 'libreoffice', 'LibreOffice']) {
    const destTool = path.join(dest, tool === 'LibreOffice' ? 'libreoffice' : tool);
    if (fs.existsSync(destTool)) continue;
    for (const srcRoot of sources) {
      const srcTool = path.join(srcRoot, tool);
      if (!fs.existsSync(srcTool)) continue;
      try {
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(srcTool, destTool, { recursive: true, force: false, errorOnExist: false });
        moved.push({ from: srcTool, to: destTool });
        break;
      } catch {
        /* ignore partial */
      }
    }
  }

  // Migrate manifests/config
  const manDest = path.join(root, '.runtime', 'manifests', 'tools-manifest.json');
  const cfgDest = path.join(root, '.runtime', 'manifests', 'tools-config.json');
  const manSrc = [
    path.join(root, '.runtime', 'manifest.json'),
    path.join(root, '.tools', 'manifest.json'),
  ];
  const cfgSrc = [
    path.join(root, '.runtime', 'config.json'),
    path.join(root, '.tools', 'config.json'),
  ];
  for (const s of manSrc) {
    if (fs.existsSync(s) && !fs.existsSync(manDest)) {
      try {
        fs.mkdirSync(path.dirname(manDest), { recursive: true });
        fs.copyFileSync(s, manDest);
        // also place at toolsRoot for server compatibility
        fs.copyFileSync(s, path.join(root, '.runtime', 'manifest.json'));
      } catch {
        /* ignore */
      }
      break;
    }
  }
  for (const s of cfgSrc) {
    if (fs.existsSync(s) && !fs.existsSync(cfgDest)) {
      try {
        fs.mkdirSync(path.dirname(cfgDest), { recursive: true });
        fs.copyFileSync(s, cfgDest);
        fs.copyFileSync(s, path.join(root, '.runtime', 'config.json'));
      } catch {
        /* ignore */
      }
      break;
    }
  }
  return moved;
}

export function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort: can we read + execute a file (or treat as present on Windows)? */
export function isExecutableFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    // Unix: owner/group/other execute bit
    return (st.mode & 0o111) !== 0 || fs.constants.X_OK === undefined;
  } catch {
    return false;
  }
}

/**
 * Detect if process appears elevated/admin (informational — never required for portable tools).
 * @returns {{ elevated: boolean, method: string }}
 */
export function detectElevation() {
  if (process.platform === 'win32') {
    try {
      // net session requires admin; silent fail when not elevated
      const r = spawnSync('net', ['session'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 3000,
      });
      return { elevated: r.status === 0, method: 'net session' };
    } catch {
      return { elevated: false, method: 'net session failed' };
    }
  }
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    return { elevated: uid === 0, method: 'uid' };
  } catch {
    return { elevated: false, method: 'unknown' };
  }
}

/**
 * Full environment snapshot for doctor / tools header.
 * @returns {{
 *   os: string, platform: string, arch: string, archLabel: string,
 *   node: string, projectRoot: string, toolsRoot: string, toolsPlatformDir: string,
 *   packageManagers: {name:string,path:string}[],
 *   writable: { projectRoot: boolean, toolsRoot: boolean, toolsPlatform: boolean },
 *   elevation: { elevated: boolean, method: string },
 *   features: ReturnType<typeof featureFlags>
 * }}
 */
export function detectEnvironment(root = projectRoot) {
  const p = detectPlatform();
  // Ensure .runtime skeleton + migrate legacy .tools once for doctor/check
  try {
    migrateLegacyTools(root);
  } catch {
    /* non-fatal */
  }
  const tr = toolsRoot(root);
  const tp = toolsPlatformDir(root);
  return {
    ...p,
    node: nodeVersion(),
    projectRoot: root,
    toolsRoot: tr,
    toolsPlatformDir: tp,
    runtimeRoot: runtimeRoot(root),
    legacyToolsRoot: legacyToolsRoot(root),
    packageManagers: detectPackageManagers(),
    writable: {
      projectRoot: isWritableDir(root),
      toolsRoot: isWritableDir(tr),
      toolsPlatform: isWritableDir(tp),
    },
    elevation: detectElevation(),
    features: featureFlags(),
  };
}

export function nodeVersion() {
  return process.version;
}

/**
 * Locate npm-cli.js so we can invoke npm via `node npm-cli.js …` without
 * spawning .cmd shims (spawnSync('npm.cmd') → EINVAL on Windows with shell:false).
 */
export function findNpmCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib64', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  // Walk up from which('npm') / npm.cmd
  const npmWhich = which('npm');
  if (npmWhich) {
    const dir = path.dirname(npmWhich);
    candidates.push(
      path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(dir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    );
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return path.resolve(c);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Cross-platform npm runner. Never uses spawnSync('npm.cmd') without shell.
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
export function runNpm(args, opts = {}) {
  const npmCli = findNpmCli();
  const base = {
    windowsHide: true,
    encoding: opts.encoding,
    timeout: opts.timeout,
    cwd: opts.cwd,
    env: opts.env || process.env,
    stdio: opts.stdio,
    input: opts.input,
  };
  if (npmCli) {
    return spawnSync(process.execPath, [npmCli, ...args], base);
  }
  // Last resort: Windows cmd /c with quoted args; Unix plain npm
  if (process.platform === 'win32') {
    const line = ['npm', ...args].map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', line], base);
  }
  return spawnSync('npm', args, base);
}

export function npmVersion() {
  try {
    const r = runNpm(['--version'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status === 0 && r.stdout) return String(r.stdout).trim();
  } catch {
    /* ignore */
  }
  return null;
}
