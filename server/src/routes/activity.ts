import type { FastifyInstance } from 'fastify';
import { getDb, type ActivityRow } from '../db/index.js';
import { badRequest } from '../lib/errors.js';

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

  app.delete('/api/activity', async () => {
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
