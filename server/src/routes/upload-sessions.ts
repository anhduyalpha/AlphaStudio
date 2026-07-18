import type { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { badRequest } from '../lib/errors.js';
import {
  cancelUploadSession,
  createUploadSession,
  finalizeUploadSession,
  getUploadSession,
  listWorkspaceUploadSessions,
  pauseUploadSession,
  resumeUploadSession,
  storeUploadChunk,
} from '../services/upload-session.js';

export async function uploadSessionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/upload-sessions/init', async (req, reply) => {
    const body = (req.body || {}) as {
      workspaceId?: string;
      originalName?: string;
      size?: number;
      mime?: string;
      chunkSize?: number;
    };
    const session = createUploadSession(body);
    return reply.code(201).send(session);
  });

  app.get('/api/upload-sessions', async (req) => {
    const { workspaceId } = (req.query || {}) as { workspaceId?: string };
    if (!workspaceId) throw badRequest('workspaceId query parameter required');
    return { sessions: listWorkspaceUploadSessions(workspaceId) };
  });

  app.get('/api/upload-sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    return getUploadSession(id);
  });

  app.put('/api/upload-sessions/:id/chunks/:index', async (req, reply) => {
    const { id, index: rawIndex } = req.params as { id: string; index: string };
    if (!/^\d+$/.test(rawIndex)) throw badRequest('Chunk index must be a non-negative integer');
    const index = Number(rawIndex);
    const body = req.body as Readable | undefined;
    if (!body || typeof body.pipe !== 'function') throw badRequest('Chunk body required');
    const result = await storeUploadChunk({
      sessionId: id,
      index,
      contentRange: req.headers['content-range'],
      checksum: Array.isArray(req.headers['x-chunk-sha256'])
        ? req.headers['x-chunk-sha256'][0]
        : req.headers['x-chunk-sha256'],
      body,
    });
    return reply.code(result.idempotent ? 200 : 201).send(result);
  });

  app.post('/api/upload-sessions/:id/pause', async (req) => {
    const { id } = req.params as { id: string };
    return pauseUploadSession(id);
  });

  app.post('/api/upload-sessions/:id/resume', async (req) => {
    const { id } = req.params as { id: string };
    return resumeUploadSession(id);
  });

  app.post('/api/upload-sessions/:id/finalize', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await finalizeUploadSession(id);
    return reply.code(201).send(result);
  });

  app.delete('/api/upload-sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    return cancelUploadSession(id);
  });
}
