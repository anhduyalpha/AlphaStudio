import type { FastifyInstance } from 'fastify';
import { getDb, type ActivityRow } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/activity', async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Number(q.limit || 50), 200);
    const rows = getDb()
      .prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?')
      .all(limit) as ActivityRow[];
    return {
      activity: rows.map((r) => ({
        id: r.id,
        jobId: r.job_id,
        tool: r.tool,
        action: r.action,
        status: r.status,
        detail: r.detail,
        createdAt: r.created_at,
      })),
    };
  });

  /**
   * Delete a single activity timeline row.
   * When the row references a job, prefer deleting the job (which also cleans output + activity).
   * Query: ?withJob=1 (default) attempts job delete when job_id is set and terminal.
   */
  app.delete('/api/activity/:id', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { withJob?: string };
    const withJob = q.withJob !== '0' && q.withJob !== 'false';
    const row = getDb().prepare('SELECT * FROM activity WHERE id = ?').get(id) as ActivityRow | undefined;
    if (!row) throw notFound('Activity entry not found');

    if (withJob && row.job_id) {
      const { getJob, deleteJob } = await import('../workers/jobs.js');
      const job = getJob(row.job_id);
      if (job) {
        // deleteJob rejects active jobs with a clear error
        const result = deleteJob(row.job_id);
        return { deletedJob: true, ...result };
      }
    }

    getDb().prepare('DELETE FROM activity WHERE id = ?').run(id);
    return { ok: true, deletedJob: false, id };
  });

  app.delete('/api/activity', async () => {
    // Bulk clear activity log only — does not delete jobs or output files
    getDb().prepare('DELETE FROM activity').run();
    return { ok: true };
  });

  app.get('/api/stats', async () => {
    const db = getDb();
    const jobs = db.prepare(`SELECT COUNT(*) as c FROM jobs`).get() as { c: number };
    const completed = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'completed'`).get() as {
      c: number;
    };
    const uploads = db.prepare(`SELECT COUNT(*) as c FROM uploads`).get() as { c: number };
    const failed = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'failed'`).get() as {
      c: number;
    };
    return {
      totalJobs: jobs.c,
      completedJobs: completed.c,
      failedJobs: failed.c,
      uploads: uploads.c,
    };
  });

  app.post('/api/activity', async (req) => {
    // optional manual activity entry
    const body = (req.body || {}) as { tool?: string; action?: string; status?: string; detail?: string };
    if (!body.tool || !body.action) throw badRequest('tool and action required');
    const { logActivity } = await import('../workers/jobs.js');
    logActivity({
      tool: body.tool,
      action: body.action,
      status: body.status || 'info',
      detail: body.detail,
    });
    return { ok: true };
  });
}
