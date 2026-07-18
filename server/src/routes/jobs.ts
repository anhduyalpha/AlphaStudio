import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound } from '../lib/errors.js';
import {
  cancelJob,
  createJob,
  getJob,
  jobEvents,
  jobPublic,
  listJobs,
} from '../workers/jobs.js';
import { corsAllowOriginHeader } from '../lib/cors-origin.js';

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/jobs', async (req, reply) => {
    const body = (req.body || {}) as {
      type?: string;
      uploadIds?: string[];
      options?: Record<string, unknown>;
      workspaceId?: string;
      clientRequestId?: string;
      dedupeKey?: string;
    };
    if (!body.type) throw badRequest('type is required');
    const job = createJob({
      type: body.type,
      uploadIds: body.uploadIds,
      options: body.options,
      workspaceId: body.workspaceId,
      clientRequestId: body.clientRequestId,
      dedupeKey: body.dedupeKey,
    });
    return reply.code(201).send(jobPublic(job));
  });

  app.get('/api/jobs', async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Number(q.limit || 50), 200);
    return { jobs: listJobs(limit).map(jobPublic) };
  });

  app.get('/api/jobs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) throw notFound('Job not found');
    return jobPublic(job);
  });

  app.post('/api/jobs/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    return jobPublic(cancelJob(id));
  });

  app.get('/api/jobs/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) throw notFound('Job not found');
    if (job.status !== 'completed' || !job.output_path) {
      throw badRequest('Job has no downloadable output');
    }
    if (!fs.existsSync(job.output_path)) throw notFound('Output file missing');
    const filename = job.output_name || 'download';
    reply.header('Content-Type', job.output_mime || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    return reply.send(fs.createReadStream(job.output_path));
  });

  // SSE progress stream
  app.get('/api/jobs/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) throw notFound('Job not found');

    const origin = req.headers.origin as string | undefined;
    const allowOrigin = corsAllowOriginHeader(origin);
    if (origin && !allowOrigin) {
      return reply.code(403).send({ error: { code: 'CORS_BLOCKED', message: 'Origin not allowed' } });
    }
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };
    // Never reflect arbitrary Origin — same allowlist as Fastify CORS
    if (allowOrigin) {
      headers['Access-Control-Allow-Origin'] = allowOrigin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    reply.hijack();
    reply.raw.writeHead(200, headers);

    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send(jobPublic(job));

    const onUpdate = (payload: unknown) => {
      send(payload);
      const p = payload as { status?: string };
      if (p.status && ['completed', 'failed', 'cancelled'].includes(p.status)) {
        cleanup();
        reply.raw.end();
      }
    };

    const cleanup = () => {
      jobEvents.off(`job:${id}`, onUpdate);
    };

    jobEvents.on(`job:${id}`, onUpdate);
    req.raw.on('close', cleanup);
    return reply;
  });

  // WebSocket progress
  app.get('/api/jobs/:id/ws', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) {
      socket.close();
      return;
    }
    socket.send(JSON.stringify(jobPublic(job)));
    const onUpdate = (payload: unknown) => {
      try {
        socket.send(JSON.stringify(payload));
        const p = payload as { status?: string };
        if (p.status && ['completed', 'failed', 'cancelled'].includes(p.status)) {
          socket.close();
        }
      } catch {
        /* ignore */
      }
    };
    jobEvents.on(`job:${id}`, onUpdate);
    socket.on('close', () => jobEvents.off(`job:${id}`, onUpdate));
  });
}
