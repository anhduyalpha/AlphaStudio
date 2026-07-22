#!/usr/bin/env node
/**
 * npm run python:install [-- --profile core] | python:check | python:repair
 *
 * Creates and validates an OPTIONAL Python virtualenv used by the Python
 * conversion engine (server/src/convert/engines/python.ts). Nothing here runs
 * during `npm run bootstrap` / `runtime:prepare` — Python stays opt-in.
 *
 * Venv layout mirrors the engine's resolver:
 *   .runtime/python/<platform>-<arch>/venv/{bin|Scripts}/python
 *
 * A fingerprint (SHA-256 of the profile requirements + interpreter version) is
 * stored so repeat installs are skipped when nothing changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './lib/platform.mjs';
import { hashString } from './lib/checksum.mjs';
import { safeRemoveUnderTools } from './lib/paths.mjs';

const PROFILES = ['core', 'data', 'documents', 'vision', 'ocr', 'ai'];
const MIN_MAJOR = 3;
const MIN_MINOR = 10;

const cmd = process.argv[2] || 'check';
const help = process.argv.includes('--help') || process.argv.includes('-h');
const profile = readProfile(process.argv.slice(3));

const pythonRoot = path.join(projectRoot, '.runtime', 'python');
const platformArch = `${process.platform}-${process.arch}`;
const venvDir = path.join(pythonRoot, platformArch, 'venv');
const venvPython =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
const fingerprintPath = path.join(pythonRoot, 'fingerprint.json');
const pythonSourceDir = path.join(projectRoot, 'python');

if (help) {
  console.log(`Usage: node scripts/maint/python.mjs <install|check|repair|test> [--profile <name>]

  install  Create the venv (if needed) and install the profile requirements.
  check    Report venv health, interpreter version, and fingerprint match.
  repair   Delete and recreate the venv for the profile.
  test     Run the Python bridge unit tests (python/tests) with the venv or system interpreter.

  Profiles: ${PROFILES.join(', ')} (default: core; heavy profiles are never auto-installed)
`);
  process.exit(0);
}

function readProfile(args) {
  const index = args.indexOf('--profile');
  const value = index >= 0 ? args[index + 1] : undefined;
  const selected = (value || 'core').toLowerCase();
  if (!PROFILES.includes(selected)) {
    console.error(`Unknown profile "${selected}". Valid: ${PROFILES.join(', ')}`);
    process.exit(1);
  }
  return selected;
}

function requirementsPath(name) {
  return path.join(pythonSourceDir, `requirements-${name}.txt`);
}

/** Non-comment, non-blank requirement lines (empty for the core profile). */
function requirementLines(name) {
  const file = requirementsPath(name);
  if (!fs.existsSync(file)) return null;
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function parseVersion(output) {
  const match = /Python\s+(\d+)\.(\d+)\.(\d+)/i.exec(String(output || ''));
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), raw: match[0] };
}

function versionOk(version) {
  return Boolean(version && (version.major > MIN_MAJOR || (version.major === MIN_MAJOR && version.minor >= MIN_MINOR)));
}

function probeVersion(executable, extraArgs = []) {
  const result = spawnSync(executable, [...extraArgs, '--version'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) return null;
  return parseVersion(`${result.stdout || ''}\n${result.stderr || ''}`);
}

/** Locate a system Python >= 3.10. On Windows also tries the `py -3` launcher. */
function findSystemPython() {
  const candidates = [
    { exe: 'python3', args: [] },
    { exe: 'python', args: [] },
  ];
  if (process.platform === 'win32') candidates.push({ exe: 'py', args: ['-3'] });
  for (const candidate of candidates) {
    const version = probeVersion(candidate.exe, candidate.args);
    if (versionOk(version)) return { ...candidate, version };
  }
  return null;
}

function run(executable, args, { label, cwd } = {}) {
  const result = spawnSync(executable, args, {
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
    cwd,
  });
  if (result.error) throw new Error(`${label || executable} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label || executable} exited with code ${result.status}`);
}

function computeFingerprint(lines, version) {
  return hashString(`${profile}\n${(lines || []).join('\n')}\n${version?.raw || ''}`);
}

function readFingerprint() {
  try {
    return JSON.parse(fs.readFileSync(fingerprintPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeFingerprint(entry) {
  fs.mkdirSync(pythonRoot, { recursive: true });
  fs.writeFileSync(fingerprintPath, `${JSON.stringify(entry, null, 2)}\n`);
}

function install() {
  const lines = requirementLines(profile);
  if (lines === null) {
    console.error(`Missing requirements file: ${path.relative(projectRoot, requirementsPath(profile))}`);
    process.exit(1);
  }

  const existing = versionOk(probeVersion(venvPython)) ? probeVersion(venvPython) : null;
  const stored = readFingerprint();
  const targetVersion = existing || findSystemPython()?.version || null;
  const fingerprint = computeFingerprint(lines, targetVersion);

  if (existing && stored && stored.fingerprint === fingerprint && stored.profile === profile) {
    console.log(`Python venv already satisfies profile "${profile}" (${existing.raw}). Nothing to do.`);
    return;
  }

  if (!existing) {
    const system = findSystemPython();
    if (!system) {
      console.error(
        `No system Python ${MIN_MAJOR}.${MIN_MINOR}+ found on PATH. Install Python and re-run.`,
      );
      process.exit(1);
    }
    console.log(`Creating venv at ${path.relative(projectRoot, venvDir)} using ${system.version.raw}`);
    fs.mkdirSync(path.dirname(venvDir), { recursive: true });
    run(system.exe, [...system.args, '-m', 'venv', '--copies', venvDir], { label: 'venv creation' });
  }

  if (lines.length > 0) {
    console.log(`Installing ${lines.length} requirement(s) for profile "${profile}"`);
    run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', requirementsPath(profile)], {
      label: 'pip install',
    });
  } else {
    console.log(`Profile "${profile}" is stdlib-only; skipping pip install.`);
  }

  // Pre-compile bytecode so the first job does not pay import latency.
  run(venvPython, ['-m', 'compileall', '-q', pythonSourceDir], { label: 'compileall' });

  const finalVersion = probeVersion(venvPython);
  writeFingerprint({
    profile,
    fingerprint: computeFingerprint(lines, finalVersion),
    pythonVersion: finalVersion?.raw || null,
    venvPython,
    platform: platformArch,
    updatedAt: new Date().toISOString(),
  });
  console.log(`Python venv ready for profile "${profile}" (${finalVersion?.raw || 'unknown version'}).`);
}

function check() {
  if (!fs.existsSync(venvPython)) {
    console.log(`Python venv not found at ${path.relative(projectRoot, venvDir)}. Run: npm run python:install`);
    process.exit(1);
  }
  const version = probeVersion(venvPython);
  if (!versionOk(version)) {
    console.log(`Venv interpreter is missing or below ${MIN_MAJOR}.${MIN_MINOR}. Run: npm run python:repair`);
    process.exit(1);
  }
  const lines = requirementLines(profile) || [];
  const stored = readFingerprint();
  const expected = computeFingerprint(lines, version);
  const match = stored && stored.fingerprint === expected && stored.profile === profile;
  console.log(`Python: ${version.raw}`);
  console.log(`Venv:   ${path.relative(projectRoot, venvDir)}`);
  console.log(`Profile: ${profile} — ${match ? 'up to date' : 'fingerprint mismatch (run python:install)'}`);
  process.exit(match ? 0 : 1);
}

function repair() {
  const result = safeRemoveUnderTools(venvDir);
  if (!result.ok && !result.skipped) {
    console.error(`Could not remove venv: ${result.error}`);
    process.exit(1);
  }
  console.log(`Removed ${path.relative(projectRoot, venvDir)} (${result.skipped || 'deleted'}). Reinstalling…`);
  install();
}

/** Prefer the managed venv interpreter for tests; fall back to a system Python. */
function resolveTestInterpreter() {
  if (fs.existsSync(venvPython) && versionOk(probeVersion(venvPython))) {
    return { exe: venvPython, args: [] };
  }
  const system = findSystemPython();
  return system ? { exe: system.exe, args: system.args } : null;
}

function runTests() {
  const interp = resolveTestInterpreter();
  if (!interp) {
    console.error(`No Python ${MIN_MAJOR}.${MIN_MINOR}+ found (venv or system). Run: npm run python:install`);
    process.exit(1);
  }
  const testsDir = path.join(pythonSourceDir, 'tests');
  if (!fs.existsSync(testsDir)) {
    console.log('No python/tests directory; nothing to run.');
    return;
  }
  run(
    interp.exe,
    [...interp.args, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'],
    { label: 'python unittest', cwd: pythonSourceDir },
  );
}

try {
  if (cmd === 'install') install();
  else if (cmd === 'check') check();
  else if (cmd === 'repair') repair();
  else if (cmd === 'test') runTests();
  else {
    console.error(`Unknown command "${cmd}". Use install | check | repair | test (see --help).`);
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
