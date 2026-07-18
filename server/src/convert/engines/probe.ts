import { spawnSync } from 'node:child_process';

export type ProbeCommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
};

export type ProbeRunner = (
  executablePath: string,
  args: string[],
  timeoutMs?: number,
) => ProbeCommandResult;

export const runProbeCommand: ProbeRunner = (
  executablePath,
  args,
  timeoutMs = 10_000,
) => {
  try {
    const result = spawnSync(executablePath, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    });
    const error = result.error;
    const timedOut =
      Boolean(error && 'code' in error && error.code === 'ETIMEDOUT') ||
      Boolean(result.signal === 'SIGTERM' && result.status == null);
    return {
      ok: !error && result.status === 0,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      timedOut,
      error: error?.message,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      timedOut: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export function firstProbeLine(result: ProbeCommandResult): string | undefined {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 240);
}

export function safeProbeReason(
  label: string,
  result: ProbeCommandResult,
  missingReason: string,
): string {
  if (result.timedOut) return `${label} capability probe timed out`;
  if (result.error && /ENOENT|not found|cannot find/i.test(result.error)) return missingReason;
  return `${label} capability probe failed`;
}
