/**
 * Tool install manifest (atomic cache):
 * name, version, platform, arch, checksum, size, mtime, path, install date, source.
 *
 * Server registry reads the legacy sibling config.json (also written atomically).
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, toolsRoot, detectPlatform } from './platform.mjs';
import { hashFile, fileIdentity, matchesIdentity, verifyChecksum } from './checksum.mjs';

export const MANIFEST_VERSION = 2;

export function manifestPath(root = projectRoot) {
  return path.join(toolsRoot(root), 'manifest.json');
}

export function legacyConfigPath(root = projectRoot) {
  return path.join(toolsRoot(root), 'config.json');
}

/**
 * @typedef {{
 *   name: string,
 *   version?: string,
 *   platform: string,
 *   architecture: string,
 *   checksum?: string,
 *   size?: number,
 *   mtimeMs?: number,
 *   executablePath: string,
 *   installedAt: string,
 *   validatedAt?: string,
 *   source?: string
 * }} ToolManifestEntry
 */

/**
 * @returns {{
 *   version: number,
 *   updatedAt: string,
 *   platform: string,
 *   architecture: string,
 *   tools: Record<string, ToolManifestEntry>
 * }}
 */
export function loadManifest(root = projectRoot) {
  const p = manifestPath(root);
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (raw && typeof raw === 'object') {
        const { platform, archLabel } = detectPlatform();
        return {
          version: raw.version || 1,
          updatedAt: raw.updatedAt || '',
          platform: raw.platform || platform,
          architecture: raw.architecture || archLabel,
          tools: raw.tools && typeof raw.tools === 'object' ? raw.tools : {},
        };
      }
    }
  } catch {
    /* ignore corrupt; start empty */
  }
  // Seed from legacy config.json when manifest missing
  const seeded = seedFromLegacyConfig(root);
  if (seeded) return seeded;
  const { platform, archLabel } = detectPlatform();
  return { version: MANIFEST_VERSION, updatedAt: '', platform, architecture: archLabel, tools: {} };
}

function seedFromLegacyConfig(root) {
  const cfgPath = legacyConfigPath(root);
  try {
    if (!fs.existsSync(cfgPath)) return null;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!cfg?.tools || typeof cfg.tools !== 'object') return null;
    const { platform, archLabel } = detectPlatform();
    /** @type {Record<string, ToolManifestEntry>} */
    const tools = {};
    for (const [name, entry] of Object.entries(cfg.tools)) {
      if (!entry?.path) continue;
      const id = fileIdentity(entry.path);
      tools[name] = {
        name,
        version: entry.version || '',
        platform,
        architecture: archLabel,
        checksum: '',
        size: id?.size,
        mtimeMs: id?.mtimeMs,
        executablePath: entry.path,
        installedAt: cfg.updatedAt || new Date().toISOString(),
        validatedAt: '',
        source: 'legacy-config',
      };
    }
    if (!Object.keys(tools).length) return null;
    return {
      version: MANIFEST_VERSION,
      updatedAt: cfg.updatedAt || '',
      platform,
      architecture: archLabel,
      tools,
    };
  } catch {
    return null;
  }
}

/** Atomic write: tmp file + rename (crash-safe). */
export function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, body, 'utf8');
  // Validate JSON before rename when we wrote an object
  if (typeof data !== 'string') {
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
  }
  // Windows: replace existing via rename — may need unlink if EPERM on some FS
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EACCES')) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      fs.renameSync(tmp, filePath);
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

export function saveManifest(manifest, root = projectRoot) {
  const p = manifestPath(root);
  const { platform, archLabel } = detectPlatform();
  const out = {
    version: MANIFEST_VERSION,
    updatedAt: new Date().toISOString(),
    platform: manifest.platform || platform,
    architecture: manifest.architecture || archLabel,
    tools: manifest.tools || {},
  };
  writeJsonAtomic(p, out);
  // Always keep legacy config.json in lockstep for server registry
  writeLegacyConfig(root, out);
  return out;
}

/**
 * Fast cache validity for a single tool entry.
 * Trusts size+mtime match without re-hash / re-exec.
 * @param {ToolManifestEntry | undefined} entry
 * @param {{ verifyChecksum?: boolean }} [opts]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isEntryCacheValid(entry, opts = {}) {
  if (!entry?.executablePath) return { ok: false, reason: 'no-path' };
  if (entry.executablePath === 'bundled') return { ok: true };
  if (!fs.existsSync(entry.executablePath)) return { ok: false, reason: 'missing-file' };
  if (entry.size != null || entry.mtimeMs != null) {
    if (!matchesIdentity(entry.executablePath, entry, { verifyChecksum: !!opts.verifyChecksum })) {
      return { ok: false, reason: 'identity-mismatch' };
    }
  } else if (opts.verifyChecksum && entry.checksum) {
    const v = verifyChecksum(entry.executablePath, entry.checksum);
    if (!v.ok) return { ok: false, reason: 'checksum-mismatch' };
  } else {
    // No identity stored — file exists only (weak cache)
    const id = fileIdentity(entry.executablePath);
    if (!id) return { ok: false, reason: 'unreadable' };
  }
  return { ok: true };
}

/**
 * Build a complete entry from a resolved executable.
 * @param {string} name
 * @param {{ version?: string, executablePath: string, source?: string, checksum?: string }} info
 * @returns {ToolManifestEntry}
 */
export function buildEntry(name, info) {
  const { platform, archLabel } = detectPlatform();
  const now = new Date().toISOString();
  const id = info.executablePath && info.executablePath !== 'bundled'
    ? fileIdentity(info.executablePath)
    : null;
  let checksum = info.checksum || '';
  if (!checksum && info.executablePath && info.executablePath !== 'bundled' && fs.existsSync(info.executablePath)) {
    try {
      // Skip hashing huge LO trees; only hash if < 80MB
      if (id && id.size > 0 && id.size < 80 * 1024 * 1024) {
        checksum = hashFile(info.executablePath);
      }
    } catch {
      checksum = '';
    }
  }
  return {
    name,
    version: info.version || '',
    platform,
    architecture: archLabel,
    checksum,
    size: id?.size,
    mtimeMs: id?.mtimeMs,
    executablePath: info.executablePath,
    installedAt: now,
    validatedAt: now,
    source: info.source || 'project',
  };
}

/**
 * Upsert one tool entry; computes checksum of executable when present.
 * @param {string} name
 * @param {{ version?: string, executablePath: string, source?: string, checksum?: string }} info
 */
export function upsertTool(name, info, root = projectRoot) {
  const m = loadManifest(root);
  m.tools[name] = buildEntry(name, info);
  return saveManifest(m, root);
}

/**
 * Batch upsert (single atomic write).
 * @param {Record<string, { version?: string, executablePath: string, source?: string, checksum?: string }>} map
 */
export function upsertTools(map, root = projectRoot) {
  const m = loadManifest(root);
  for (const [name, info] of Object.entries(map)) {
    if (!info?.executablePath) continue;
    m.tools[name] = buildEntry(name, info);
  }
  return saveManifest(m, root);
}

/** Remove a tool entry and rewrite manifest + config. */
export function removeTool(name, root = projectRoot) {
  const m = loadManifest(root);
  delete m.tools[name];
  return saveManifest(m, root);
}

/**
 * Write legacy config.json for server registry compatibility (atomic).
 * @param {string} [root]
 * @param {ReturnType<typeof loadManifest>} [manifest] if already loaded
 */
export function writeLegacyConfig(root = projectRoot, manifest) {
  const m = manifest || loadManifest(root);
  const tools = {};
  for (const [name, entry] of Object.entries(m.tools || {})) {
    if (!entry.executablePath || entry.executablePath === 'bundled') continue;
    tools[name] = {
      path: entry.executablePath,
      version: entry.version || '',
    };
  }
  const cfgPath = legacyConfigPath(root);
  writeJsonAtomic(cfgPath, {
    updatedAt: m.updatedAt || new Date().toISOString(),
    tools,
  });
  return cfgPath;
}

/**
 * Touch validatedAt + refresh identity for a working entry without re-hash.
 * @param {string} name
 * @param {ToolManifestEntry} entry
 */
export function touchValidated(name, entry, root = projectRoot) {
  const m = loadManifest(root);
  const id = fileIdentity(entry.executablePath);
  m.tools[name] = {
    ...entry,
    size: id?.size ?? entry.size,
    mtimeMs: id?.mtimeMs ?? entry.mtimeMs,
    validatedAt: new Date().toISOString(),
  };
  return saveManifest(m, root);
}
