import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { bearerTokensEqual } from './lib/bearer.js';
import { AppError, toErrorBody } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { systemRoutes } from './routes/system.js';
import { uploadRoutes } from './routes/uploads.js';
import { uploadSessionRoutes } from './routes/upload-sessions.js';
import { jobRoutes } from './routes/jobs.js';
import { activityRoutes } from './routes/activity.js';
import { profileRoutes } from './routes/profile.js';
import { settingsRoutes } from './routes/settings.js';
import { inspectRoutes } from './routes/inspect.js';
import { workspaceRoutes, fileDownloadRoutes } from './routes/workspaces.js';
import { stopWorkerPool } from './workers/jobs.js';
import { beginFileFinalizerShutdown, enableFileFinalizers } from './services/workspace.js';

export { bearerTokensEqual } from './lib/bearer.js';

export async function buildApp() {
  enableFileFinalizers();
  const app = Fastify({
    logger: false,
    bodyLimit: config.maxUploadBytes + 1024 * 1024,
    requestTimeout: config.jobTimeoutMs + 10_000,
    // Drain active requests but close keep-alive sockets immediately during a
    // restart. Without this, process supervisors may hard-kill the API before
    // SQLite gets a chance to checkpoint its WAL.
    forceCloseConnections: 'idle',
  });

  // Tests and embedders may construct Fastify without server/src/index.ts.
  // Always stop child workers when their owning app closes.
  app.addHook('onClose', async () => {
    beginFileFinalizerShutdown();
    await stopWorkerPool();
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === config.corsOrigin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('CORS blocked'), false);
    },
    credentials: true,
  });

  // A non-loopback bind is only accepted when a token is configured by
  // bind-guard. Enforce that token here for every non-health API request.
  app.addHook('onRequest', async (req, reply) => {
    if (!config.apiToken) return;
    const pathname = req.url.split('?', 1)[0];
    if (!pathname.startsWith('/api/') || pathname === '/api/health') return;
    const authorization = String(req.headers.authorization || '');
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!bearerTokensEqual(supplied, config.apiToken)) {
      return reply
        .code(401)
        .send(toErrorBody(new AppError(401, 'UNAUTHORIZED', 'Valid API bearer token required')));
    }
  });

  // No application-level request rate limiting (single-user personal app).
  // Retained: max upload size (multipart), job concurrency, timeouts, validation.

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 20,
      fields: 30,
    },
  });
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
    done(null, payload);
  });

  await app.register(websocket);

  app.setErrorHandler((err: unknown, req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    const status = err instanceof AppError ? err.statusCode : e.statusCode || 500;
    if (status >= 500) {
      logger.error({ err, url: req.url }, 'Request error');
    } else {
      logger.warn({ err: e.message, url: req.url }, 'Client error');
    }
    // CORS error
    if (e.message === 'CORS blocked') {
      return reply.code(403).send(toErrorBody(new AppError(403, 'CORS_BLOCKED', 'Origin not allowed')));
    }
    return reply.code(status).send(toErrorBody(err));
  });

  await app.register(systemRoutes);
  await app.register(uploadRoutes);
  await app.register(uploadSessionRoutes);
  await app.register(workspaceRoutes);
  await app.register(fileDownloadRoutes);
  await app.register(inspectRoutes);
  await app.register(jobRoutes);
  await app.register(activityRoutes);
  await app.register(profileRoutes);
  await app.register(settingsRoutes);

  const frontendRoot = fileURLToPath(new URL('../../dist/', import.meta.url));
  const hasFrontend = config.serveFrontend && fs.existsSync(path.join(frontendRoot, 'index.html'));

  if (hasFrontend) {
    await app.register(fastifyStatic, {
      root: frontendRoot,
      prefix: '/',
      cacheControl: true,
      maxAge: '1h',
      immutable: false,
    });
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split('?', 1)[0];
      if (
        req.method === 'GET' &&
        !pathname.startsWith('/api/') &&
        String(req.headers.accept || '').includes('text/html')
      ) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send(toErrorBody(new AppError(404, 'NOT_FOUND', 'Route not found')));
    });
  } else {
    app.get('/', async () => ({
      name: 'AlphaStudio API',
      health: '/api/health',
      version: '/api/version',
      capabilities: '/api/capabilities',
    }));
  }

  return app;
}
