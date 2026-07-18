import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { badRequest, payloadTooLarge } from '../lib/errors.js';
import { randomServerName, sanitizeFilename } from '../lib/paths.js';
import {
  acceptUploadedFile,
  ensureWorkspace,
  filePublic,
  getFile,
} from '../services/workspace.js';

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Streaming upload: pipe multipart → disk, then quick detect + fingerprint.
   * Full SHA-256 and deep metadata (ffprobe/sharp/PDF) run async after 201.
   * Never buffers the entire large file in memory.
   */
  app.post('/api/uploads', async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('multipart file field required');

    const fields = (file.fields || {}) as Record<string, { value?: string }>;
    const q = (req.query || {}) as { workspaceId?: string };
    const workspaceIdField = fields.workspaceId?.value || q.workspaceId;

    const originalName = sanitizeFilename(file.filename || 'upload');
    const ext = path.extname(originalName).toLowerCase();
    const storedName = randomServerName(ext || '');
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    const dest = path.join(config.uploadsDir, storedName);

    let size = 0;
    file.file.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > config.maxUploadBytes) {
        file.file.destroy();
      }
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
      const ws = ensureWorkspace(workspaceIdField || null);
      const publicFile = await acceptUploadedFile({
        workspaceId: ws.id,
        originalName,
        storedName,
        path: dest,
        size,
        declaredMime: file.mimetype,
      });

      return reply.code(201).send({
        ...publicFile,
        workspaceId: ws.id,
      });
    } catch (err) {
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }
      throw err;
    }
  });

  app.get('/api/uploads/:id', async (req) => {
    const { id } = req.params as { id: string };
    const file = getFile(id);
    if (file) return filePublic(file);
    // legacy fallback
    const row = getDb()
      .prepare('SELECT id, original_name, mime, size, ext, created_at FROM uploads WHERE id = ?')
      .get(id) as
      | { id: string; original_name: string; mime: string; size: number; ext: string; created_at: string }
      | undefined;
    if (!row) throw badRequest('Upload not found');
    return {
      id: row.id,
      originalName: row.original_name,
      mime: row.mime,
      size: row.size,
      ext: row.ext,
      createdAt: row.created_at,
      downloadUrl: `/api/files/${row.id}/download`,
      previewUrl: `/api/files/${row.id}/preview`,
    };
  });
}
