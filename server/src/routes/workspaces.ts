import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import archiver from 'archiver';
import { config } from '../config.js';
import { corsAllowOriginHeader } from '../lib/cors-origin.js';
import { badRequest, notFound, payloadTooLarge } from '../lib/errors.js';
import { randomServerName, sanitizeFilename } from '../lib/paths.js';
import {
  nextEventVersion,
  onWorkspaceEvent,
} from '../lib/workspace-events.js';
import {
  acceptUploadedFile,
  clearWorkspace,
  createWorkspace,
  deleteWorkspace,
  ensureWorkspace,
  getFile,
  getOutput,
  getWorkspace,
  hydrateWorkspace,
  listOutputsForZip,
  patchWorkspace,
  softDeleteFile,
  updateFileDetect,
} from '../services/workspace.js';

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  /** Create a new workspace */
  app.post('/api/workspaces', async (req, reply) => {
    const body = (req.body || {}) as { route?: string };
    const ws = createWorkspace(body.route || 'dashboard');
    return reply.code(201).send({
      id: ws.id,
      route: ws.route,
      createdAt: ws.created_at,
    });
  });

  /** Recover or create: pass id to reopen */
  app.post('/api/workspaces/recover', async (req) => {
    const body = (req.body || {}) as { id?: string; route?: string };
    const ws = ensureWorkspace(body.id, body.route || 'dashboard');
    return hydrateWorkspace(ws.id);
  });

  /** Full hydrate */
  app.get('/api/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    return hydrateWorkspace(id);
  });

  /** Autosave patch */
  app.patch('/api/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as {
      route?: string;
      selectedFileIds?: string[];
      ui?: Record<string, unknown>;
      toolSettings?: Record<string, Record<string, unknown>>;
    };
    if (!getWorkspace(id)) throw notFound('Workspace not found');
    patchWorkspace(id, body);
    return hydrateWorkspace(id);
  });

  /** Soft-clear files + settings */
  app.post('/api/workspaces/:id/clear', async (req) => {
    const { id } = req.params as { id: string };
    clearWorkspace(id);
    return hydrateWorkspace(id);
  });

  /** Delete workspace */
  app.delete('/api/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteWorkspace(id);
    return { ok: true };
  });

  /** Upload file into workspace — streaming fast path (same as /api/uploads) */
  app.post('/api/workspaces/:id/files', async (req, reply) => {
    const { id: workspaceId } = req.params as { id: string };
    if (!getWorkspace(workspaceId)) throw notFound('Workspace not found');

    const file = await req.file();
    if (!file) throw badRequest('multipart file field required');

    const originalName = sanitizeFilename(file.filename || 'upload');
    const ext = path.extname(originalName).toLowerCase();
    const storedName = randomServerName(ext || '');
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    const dest = path.join(config.uploadsDir, storedName);

    let size = 0;
    file.file.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > config.maxUploadBytes) file.file.destroy();
    });

    try {
      await pipeline(file.file, fs.createWriteStream(dest));
    } catch (e) {
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }
      if (size > config.maxUploadBytes) throw payloadTooLarge('Upload exceeds size limit');
      throw e;
    }

    if (size > config.maxUploadBytes) {
      fs.rmSync(dest, { force: true });
      throw payloadTooLarge('Upload exceeds size limit');
    }

    try {
      const publicFile = await acceptUploadedFile({
        workspaceId,
        originalName,
        storedName,
        path: dest,
        size,
        declaredMime: file.mimetype,
      });
      return reply.code(201).send(publicFile);
    } catch (err) {
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }
      throw err;
    }
  });

  app.delete('/api/workspaces/:id/files/:fileId', async (req) => {
    const { id, fileId } = req.params as { id: string; fileId: string };
    softDeleteFile(id, fileId);
    return hydrateWorkspace(id);
  });

  /** Attach cached detect result */
  app.put('/api/workspaces/:id/files/:fileId/detect', async (req) => {
    const { id, fileId } = req.params as { id: string; fileId: string };
    const row = getFile(fileId);
    if (!row || row.workspace_id !== id) throw notFound('File not found');
    const body = (req.body || {}) as { detect?: unknown };
    if (body.detect) updateFileDetect(fileId, body.detect);
    const { filePublic } = await import('../services/workspace.js');
    return filePublic(getFile(fileId)!);
  });

  /**
   * Workspace-scoped SSE: file + job events so clients never need a full reload
   * to see uploads or progress. Subscribe before heavy work; reconnect + hydrate on drop.
   */
  app.get('/api/workspaces/:id/events', async (req, reply) => {
    const { id: workspaceId } = req.params as { id: string };
    if (!getWorkspace(workspaceId)) throw notFound('Workspace not found');

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
    // Never reflect arbitrary Origin — same allowlist as Fastify CORS / jobs SSE
    if (allowOrigin) {
      headers['Access-Control-Allow-Origin'] = allowOrigin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    reply.hijack();
    reply.raw.writeHead(200, headers);

    const send = (data: unknown) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* closed */
      }
    };

    send({
      type: 'connected',
      workspaceId,
      version: nextEventVersion(),
      updatedAt: new Date().toISOString(),
    });

    const unsub = onWorkspaceEvent(workspaceId, (ev) => {
      send(ev);
    });

    const ping = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        /* ignore */
      }
    }, 25_000);
    ping.unref?.();

    const cleanup = () => {
      clearInterval(ping);
      unsub();
    };
    req.raw.on('close', cleanup);
    return reply;
  });

  /**
   * Download workspace outputs as a single ZIP.
   * Body: { outputIds?: string[], jobIds?: string[] }
   * Empty selection → all on-disk outputs for the workspace.
   */
  app.post('/api/workspaces/:id/outputs/download-zip', async (req, reply) => {
    const { id: workspaceId } = req.params as { id: string };
    if (!getWorkspace(workspaceId)) throw notFound('Workspace not found');

    const body = (req.body || {}) as { outputIds?: string[]; jobIds?: string[] };
    const files = listOutputsForZip(workspaceId, {
      outputIds: body.outputIds,
      jobIds: body.jobIds,
    });

    if (!files.length) {
      throw badRequest('No valid output files to download');
    }

    const entryNames = uniqueZipEntryNames(files.map((f) => f.name));
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', (err) => {
      req.log?.error?.({ err }, 'ZIP archive error');
      if (!reply.sent) {
        reply.code(500).send({ error: { code: 'ZIP_ERROR', message: err.message } });
      }
    });

    for (let i = 0; i < files.length; i++) {
      archive.file(files[i].path, { name: entryNames[i] });
    }

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename="alphastudio-outputs.zip"');
    // Streaming response — do not await finalize before send
    void archive.finalize();
    return reply.send(archive);
  });
}

/** Deduplicate archive entry names (sanitize + (n) suffix). */
function uniqueZipEntryNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((raw) => {
    const base = sanitizeFilename(raw || 'download');
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    if (n === 0) return base;
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    return `${stem} (${n})${ext}`;
  });
}

export async function fileDownloadRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getFile(id);
    if (!row || row.status === 'deleted') throw notFound('File not found');
    if (!fs.existsSync(row.path)) throw notFound('File missing on disk');
    reply.header('Content-Type', row.mime || 'application/octet-stream');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${(row.original_name || 'file').replace(/"/g, '')}"`,
    );
    return reply.send(fs.createReadStream(row.path));
  });

  app.get('/api/files/:id/preview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getFile(id);
    if (!row || row.status === 'deleted') throw notFound('File not found');
    if (!fs.existsSync(row.path)) throw notFound('File missing on disk');
    reply.header('Content-Type', row.mime || 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(row.path));
  });

  app.get('/api/outputs/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getOutput(id);
    if (!row) throw notFound('Output not found');
    if (!fs.existsSync(row.path)) throw notFound('Output missing on disk');
    reply.header('Content-Type', row.mime || 'application/octet-stream');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${(row.name || 'download').replace(/"/g, '')}"`,
    );
    return reply.send(fs.createReadStream(row.path));
  });
}
