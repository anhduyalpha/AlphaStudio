from __future__ import annotations

import subprocess
from pathlib import Path

STABILITY_REF = "origin/stabilize/alphastudio-stable-baseline"
UI_CONFLICTS = [
    "src/App.jsx",
    "src/components/CommandPalette.jsx",
    "src/components/Common.jsx",
    "src/components/Sidebar.jsx",
    "src/components/Topbar.jsx",
    "src/views/ModularWorkspaceView.jsx",
    "src/views/SettingsView.jsx",
]


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, text=True, check=False)
    if check and result.returncode != 0:
        raise SystemExit(result.returncode)
    return result


run("git", "config", "user.name", "AlphaStudio Diagnostic")
run("git", "config", "user.email", "diagnostic@example.invalid")
run("git", "fetch", "origin", "stabilize/alphastudio-stable-baseline")
merge = run("git", "merge", "--no-commit", "--no-ff", STABILITY_REF, check=False)
if merge.returncode not in (0, 1):
    raise SystemExit(merge.returncode)

for path in UI_CONFLICTS:
    run("git", "checkout", "--ours", "--", path)

run("git", "checkout", "--ours", "--", "server/src/processors/media.ts")
run("git", "checkout", "--theirs", "--", "scripts/maint/tests/maint-core.test.mjs")

media = Path("server/src/processors/media.ts")
text = media.read_text(encoding="utf-8")
anchor = "import type { EngineRoute } from '../convert/engines/index.js';\n"
validation = r'''

/** Allowlisted ffmpeg time for -ss / -t / -to. */
export function parseFfmpegTime(value: unknown, field = 'time'): string {
  if (value == null || value === '') throw badRequest(`Invalid ${field}`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 86400 * 24) {
      throw badRequest(`Invalid ${field}`);
    }
    return String(value);
  }
  const raw = String(value).trim();
  if (!raw || raw.length > 32) throw badRequest(`Invalid ${field}`);
  if (/[;|&$`\\\n\r\t,]/.test(raw) || raw.includes('://')) {
    throw badRequest(`Invalid ${field}`);
  }
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 86400 * 24) throw badRequest(`Invalid ${field}`);
    return raw;
  }
  if (/^(?:\d{1,2}:)?[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(raw)) return raw;
  throw badRequest(`Invalid ${field}`);
}

/** Loudnorm integrated loudness target in LUFS. */
export function parseTargetLoudness(value: unknown): number {
  const n = value == null || value === '' ? -16 : Number(value);
  if (!Number.isFinite(n) || n < -70 || n > -5) {
    throw badRequest('targetLoudness must be a finite number between -70 and -5 LUFS');
  }
  return n;
}
'''
if "export function parseFfmpegTime" not in text:
    text = text.replace(anchor, anchor + validation)
text = text.replace("const start = String(ctx.options.start || '0');", "const start = parseFfmpegTime(ctx.options.start ?? '0', 'start');")
text = text.replace("const duration = ctx.options.duration != null ? String(ctx.options.duration) : undefined;", "const duration = ctx.options.duration != null ? parseFfmpegTime(ctx.options.duration, 'duration') : undefined;")
text = text.replace("const end = ctx.options.end != null ? String(ctx.options.end) : undefined;", "const end = ctx.options.end != null ? parseFfmpegTime(ctx.options.end, 'end') : undefined;")
text = text.replace("const target = String(ctx.options.targetLoudness || '-16');", "const target = parseTargetLoudness(ctx.options.targetLoudness);")
media.write_text(text, encoding="utf-8")

maint = Path("scripts/maint/tests/maint-core.test.mjs")
text = maint.read_text(encoding="utf-8")
needle = "    assert.match(pkg.scripts.bootstrap, /runtime:prepare/);\n"
addition = "    assert.equal(pkg.scripts['runtime:prepare'], 'node scripts/maint/tools.mjs install --profile full');\n"
if addition not in text:
    text = text.replace(needle, needle + addition)
maint.write_text(text, encoding="utf-8")

run("git", "add", "-A")
unmerged = subprocess.check_output(["git", "diff", "--name-only", "--diff-filter=U"], text=True).strip()
if unmerged:
    raise SystemExit(f"Unresolved merge conflicts:\n{unmerged}")

for path in Path(".").rglob("*"):
    if not path.is_file() or ".git" in path.parts:
        continue
    try:
        value = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    if "<<<<<<<" in value or ">>>>>>>" in value:
        raise SystemExit(f"Conflict marker remains in {path}")

run("git", "status", "--short")
run("git", "diff", "--cached", "--stat")
