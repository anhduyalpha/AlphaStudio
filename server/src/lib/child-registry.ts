/**
 * Track external child processes by job ID and kill process trees on cancel/timeout.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { logger } from './logger.js';

const childrenByJob = new Map<string, Set<ChildProcess>>();

type ChildLifecycleEvent = {
  type: 'started' | 'exited';
  jobId: string;
  pid: number;
};

let lifecycleObserver: ((event: ChildLifecycleEvent) => void) | null = null;

/** Worker-process hook used to mirror external child PIDs to the API parent. */
export function setChildLifecycleObserver(
  observer: ((event: ChildLifecycleEvent) => void) | null,
): void {
  lifecycleObserver = observer;
}

export function registerChild(jobId: string, child: ChildProcess): void {
  if (!jobId) return;
  let set = childrenByJob.get(jobId);
  if (!set) {
    set = new Set();
    childrenByJob.set(jobId, set);
  }
  set.add(child);
  if (child.pid) lifecycleObserver?.({ type: 'started', jobId, pid: child.pid });
  const cleanup = () => {
    set!.delete(child);
    if (set!.size === 0) childrenByJob.delete(jobId);
    if (child.pid) lifecycleObserver?.({ type: 'exited', jobId, pid: child.pid });
  };
  child.once('exit', cleanup);
  child.once('error', cleanup);
}

export function clearJobChildren(jobId: string): void {
  childrenByJob.delete(jobId);
}

/** Kill all tracked children for a job (process tree on Windows via taskkill). */
export function killJobChildren(jobId: string): number {
  const set = childrenByJob.get(jobId);
  if (!set || set.size === 0) return 0;
  let killed = 0;
  for (const child of [...set]) {
    if (killProcessTree(child)) killed += 1;
  }
  childrenByJob.delete(jobId);
  return killed;
}

export function killProcessTree(child: ChildProcess): boolean {
  if (!child.pid || child.exitCode != null || child.killed) return false;
  const killed = killProcessTreeByPid(child.pid);
  try {
    child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
  } catch {
    /* process group kill may already have terminated it */
  }
  return killed;
}

/** Kill a process tree from a PID reported over worker IPC. Never uses a shell. */
export function killProcessTreeByPid(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 10_000 },
        () => {
          /* best-effort */
        },
      );
      return true;
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ESRCH') logger.warn({ err, pid }, 'Failed to kill process tree');
    return code === 'ESRCH';
  }
}

/** Shutdown helper for worker disconnect/signals. */
export function killAllJobChildren(): number {
  let killed = 0;
  for (const jobId of [...childrenByJob.keys()]) {
    killed += killJobChildren(jobId);
  }
  return killed;
}

export type JobExecOptions = {
  jobId?: string;
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
};

/**
 * Spawn + track by jobId; returns promise of stdout/stderr like execFile.
 * Killable via killJobChildren(jobId).
 */
export function execFileTracked(
  file: string,
  args: string[],
  opts: JobExecOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      windowsHide: opts.windowsHide !== false,
      cwd: opts.cwd,
      env: opts.env,
      // On POSIX, new process group enables kill(-pid)
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    const child = spawn(file, args, spawnOpts);
    if (opts.jobId) registerChild(opts.jobId, child);

    let stdout = '';
    let stderr = '';
    const max = opts.maxBuffer ?? 20 * 1024 * 1024;
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > max) stdout = stdout.slice(-max);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > max) stderr = stderr.slice(-max);
    });

    let timedOut = false;
    const timer =
      opts.timeout && opts.timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            killProcessTree(child);
          }, opts.timeout)
        : null;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        const e = new Error(`Command timed out: ${file}`) as Error & { killed?: boolean; code?: string };
        e.killed = true;
        e.code = 'ETIMEDOUT';
        reject(e);
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const e = new Error(
        `Command failed: ${file} ${args.slice(0, 4).join(' ')}… code=${code} signal=${signal}\n${stderr.slice(0, 500)}`,
      ) as Error & { code?: number | null; stdout?: string; stderr?: string };
      e.code = code;
      e.stdout = stdout;
      e.stderr = stderr;
      reject(e);
    });
  });
}

/** Unit-test helper: count tracked children for a job */
export function trackedChildCount(jobId: string): number {
  return childrenByJob.get(jobId)?.size ?? 0;
}
