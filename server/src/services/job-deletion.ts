import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, type JobRow } from '../db/index.js';
import { AppError, conflict } from '../lib/errors.js';

export type JobDeletionCounts = {
  outputs: number;
  activity: number;
  jobFiles: number;
  resultCache: number;
  jobs: number;
};

export type JobDeletionResult = {
  ok: true;
  id: string;
  deletedOutput: boolean;
  cleanup: JobDeletionCounts;
};

function isStrictlyInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

function assertSafeJobId(jobId: string): void {
  if (!jobId || jobId === '.' || jobId === '..' || path.basename(jobId) !== jobId || /[\\/]/.test(jobId)) {
    throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Job output ownership could not be verified');
  }
}

function assertNoReparseEscape(root: string): void {
  if (!fs.existsSync(root)) return;
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Job output directory is not an owned directory');
  }
  const realRoot = fs.realpathSync.native(root);
  if (!samePath(realRoot, root)) {
    throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Job output directory resolves outside its canonical path');
  }

  const pending = [root];
  while (pending.length) {
    const dir = pending.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Job output contains a symbolic link or reparse point');
      }
      const real = fs.realpathSync.native(entryPath);
      if (!samePath(real, entryPath) || !isStrictlyInside(realRoot, real)) {
        throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Job output resolves outside its owned directory');
      }
      if (stat.isDirectory()) pending.push(entryPath);
    }
  }
}

function assertOwnedPath(jobRoot: string, candidate: string): string {
  const resolved = path.resolve(candidate);
  if (!isStrictlyInside(jobRoot, resolved)) {
    throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Refusing to delete an output not owned by this job', {
      expectedDirectory: jobRoot,
    });
  }
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Owned job output must be a regular file');
    }
    const real = fs.realpathSync.native(resolved);
    if (!isStrictlyInside(jobRoot, real)) {
      throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Job output resolves outside its owned directory');
    }
  }
  return resolved;
}

/**
 * Delete one terminal job and every record that links to its owned output.
 * Filesystem cleanup happens before the database transaction so a disk failure
 * leaves ownership metadata available for a safe retry.
 */
export function deleteTerminalJob(job: JobRow): JobDeletionResult {
  if (job.status === 'queued' || job.status === 'running') {
    throw conflict('JOB_ACTIVE', 'Cannot delete an active job. Cancel it first, then delete it.');
  }
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    throw conflict('JOB_NOT_TERMINAL', `Job status "${job.status}" cannot be deleted`);
  }

  assertSafeJobId(job.id);
  const jobRoot = path.resolve(config.outputsDir, job.id);
  if (!isStrictlyInside(config.outputsDir, jobRoot)) {
    throw conflict('OUTPUT_OWNERSHIP_INVALID', 'Job output directory is outside the output root');
  }

  const db = getDb();
  const linkedOutputs = db
    .prepare('SELECT path FROM outputs WHERE job_id = ?')
    .all(job.id) as { path: string }[];
  const ownedPaths = new Set<string>();
  try {
    if (job.output_path) ownedPaths.add(assertOwnedPath(jobRoot, job.output_path));
    for (const row of linkedOutputs) ownedPaths.add(assertOwnedPath(jobRoot, row.path));
    assertNoReparseEscape(jobRoot);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      500,
      'OUTPUT_CLEANUP_FAILED',
      'Could not inspect the owned job output; deletion can be retried',
      { jobId: job.id, cause: error instanceof Error ? error.message : String(error) },
    );
  }

  let deletedOutput = false;
  if (fs.existsSync(jobRoot)) {
    try {
      fs.rmSync(jobRoot, { recursive: true, force: false });
      deletedOutput = true;
    } catch (error) {
      throw new AppError(
        500,
        'OUTPUT_CLEANUP_FAILED',
        'Could not remove the owned job output; deletion can be retried',
        { jobId: job.id, cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  const cleanup = db.transaction((): JobDeletionCounts => {
    let resultCache = 0;
    for (const outputPath of ownedPaths) {
      resultCache += db.prepare('DELETE FROM job_result_cache WHERE output_path = ?').run(outputPath).changes;
    }
    const outputs = db.prepare('DELETE FROM outputs WHERE job_id = ?').run(job.id).changes;
    const activity = db.prepare('DELETE FROM activity WHERE job_id = ?').run(job.id).changes;
    const jobFiles = db.prepare('DELETE FROM job_files WHERE job_id = ?').run(job.id).changes;
    const jobs = db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id).changes;
    return { outputs, activity, jobFiles, resultCache, jobs };
  })();

  return { ok: true, id: job.id, deletedOutput, cleanup };
}
