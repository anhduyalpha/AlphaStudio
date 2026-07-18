import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { AppError, badRequest, notFound, payloadTooLarge } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { randomServerName, safeJoin, sanitizeFilename } from '../lib/paths.js';
import {
  acceptUploadedFile,
  ensureWorkspace,
  filePublic,
  getFile,
  type PublicFile,
} from './workspace.js';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const MIN_CHUNK_BYTES = 256 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

type SessionStatus = 'uploading' | 'paused' | 'finalizing' | 'completed' | 'failed';

export type UploadSessionRow = {
  id: string;
  workspace_id: string;
  original_name: string;
  declared_mime: string | null;
  size: number;
  chunk_size: number;
  total_chunks: number;
  status: SessionStatus;
  finalized_file_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type ChunkRow = {
  session_id: string;
  chunk_index: number;
  start_byte: number;
  end_byte: number;
  size: number;
  checksum: string;
  path: string;
  created_at: string;
};

function now(): string {
  return new Date().toISOString();
}

function expiresAt(ttlMs = config.uploadSessionTtlMs): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

function conflict(message: string, details?: unknown): AppError {
  return new AppError(409, 'UPLOAD_CONFLICT', message, details);
}

function assertSessionId(id: string): void {
  if (!SESSION_ID_RE.test(id)) throw badRequest('Invalid upload session id');
}

function sessionDir(id: string): string {
  assertSessionId(id);
  return safeJoin(config.uploadSessionsDir, id);
}

function chunkPath(id: string, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw badRequest('Invalid chunk index');
  return safeJoin(sessionDir(id), `${index}.chunk`);
}

function loadSession(id: string): UploadSessionRow {
  assertSessionId(id);
  const row = getDb()
    .prepare(`SELECT * FROM upload_sessions WHERE id = ?`)
    .get(id) as UploadSessionRow | undefined;
  if (!row) throw notFound('Upload session not found');
  return row;
}

function expectedRange(row: UploadSessionRow, index: number): { start: number; end: number; size: number } {
  if (!Number.isSafeInteger(index) || index < 0 || index >= row.total_chunks) {
    throw badRequest('Chunk index out of range', { index, totalChunks: row.total_chunks });
  }
  const start = index * row.chunk_size;
  const end = Math.min(row.size - 1, start + row.chunk_size - 1);
  return { start, end, size: end - start + 1 };
}

export function parseContentRange(value: string | undefined): {
  start: number;
  end: number;
  total: number;
} {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(value || '').trim());
  if (!match) throw badRequest('Content-Range must be bytes START-END/TOTAL');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total < 1) {
    throw badRequest('Invalid Content-Range values');
  }
  return { start, end, total };
}

export function createUploadSession(input: {
  workspaceId?: string | null;
  originalName?: string;
  size?: number;
  mime?: string | null;
  chunkSize?: number;
}): ReturnType<typeof uploadSessionPublic> {
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw badRequest('File size must be a positive integer');
  if (size > config.maxUploadBytes) throw payloadTooLarge(`File exceeds limit of ${config.maxUploadBytes} bytes`);

  const originalName = sanitizeFilename(String(input.originalName || 'upload'));
  if (!path.extname(originalName)) throw badRequest('Filename extension required');
  const requestedChunk = Number(input.chunkSize || config.uploadChunkBytes);
  const chunkSize = Math.max(
    MIN_CHUNK_BYTES,
    Math.min(MAX_CHUNK_BYTES, Number.isSafeInteger(requestedChunk) ? requestedChunk : config.uploadChunkBytes),
  );
  const totalChunks = Math.ceil(size / chunkSize);
  const declaredMime = input.mime ? String(input.mime).slice(0, 200) : null;
  const workspace = ensureWorkspace(input.workspaceId || null);
  const id = uuid();
  const t = now();
  fs.mkdirSync(sessionDir(id), { recursive: true });
  try {
    getDb()
      .prepare(
        `INSERT INTO upload_sessions
         (id, workspace_id, original_name, declared_mime, size, chunk_size, total_chunks,
          status, finalized_file_id, last_error, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', NULL, NULL, ?, ?, ?)`,
      )
      .run(id, workspace.id, originalName, declaredMime, size, chunkSize, totalChunks, t, t, expiresAt());
  } catch (err) {
    fs.rmSync(sessionDir(id), { recursive: true, force: true });
    throw err;
  }
  return uploadSessionPublic(loadSession(id));
}

export function uploadSessionPublic(row: UploadSessionRow) {
  const chunks = getDb()
    .prepare(
      `SELECT chunk_index, start_byte, end_byte, size, checksum
       FROM upload_chunks WHERE session_id = ? ORDER BY chunk_index`,
    )
    .all(row.id) as Array<{
    chunk_index: number;
    start_byte: number;
    end_byte: number;
    size: number;
    checksum: string;
  }>;
  const receivedBytes = chunks.reduce((sum, c) => sum + Number(c.size), 0);
  const indexes = chunks.map((c) => c.chunk_index);
  let nextMissingIndex: number | null = null;
  const have = new Set(indexes);
  for (let i = 0; i < row.total_chunks; i += 1) {
    if (!have.has(i)) {
      nextMissingIndex = i;
      break;
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    originalName: row.original_name,
    mime: row.declared_mime,
    size: row.size,
    chunkSize: row.chunk_size,
    totalChunks: row.total_chunks,
    receivedChunks: indexes,
    receivedBytes,
    nextMissingIndex,
    status: row.status,
    fileId: row.finalized_file_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export function getUploadSession(id: string): ReturnType<typeof uploadSessionPublic> {
  return uploadSessionPublic(loadSession(id));
}

export function listWorkspaceUploadSessions(workspaceId: string) {
  return (
    getDb()
      .prepare(
        `SELECT * FROM upload_sessions
         WHERE workspace_id = ? AND status IN ('uploading', 'paused', 'failed')
         ORDER BY created_at ASC`,
      )
      .all(workspaceId) as UploadSessionRow[]
  ).map(uploadSessionPublic);
}

export async function storeUploadChunk(input: {
  sessionId: string;
  index: number;
  contentRange?: string;
  checksum?: string;
  body: Readable;
}) {
  const row = loadSession(input.sessionId);
  if (row.status === 'paused') throw conflict('Upload session is paused');
  if (row.status !== 'uploading') throw conflict(`Upload session is ${row.status}`);
  const range = parseContentRange(input.contentRange);
  const expected = expectedRange(row, input.index);
  if (range.start !== expected.start || range.end !== expected.end || range.total !== row.size) {
    throw conflict('Content-Range does not match chunk index', { expected, received: range });
  }
  const checksum = String(input.checksum || '').toLowerCase();
  if (!SHA256_RE.test(checksum)) throw badRequest('X-Chunk-SHA256 must be a 64-character SHA-256 hex digest');

  const existing = getDb()
    .prepare(`SELECT * FROM upload_chunks WHERE session_id = ? AND chunk_index = ?`)
    .get(row.id, input.index) as ChunkRow | undefined;
  if (existing) {
    input.body.resume();
    if (
      existing.checksum === checksum &&
      existing.start_byte === range.start &&
      existing.end_byte === range.end &&
      existing.size === expected.size
    ) {
      return { idempotent: true, chunkIndex: input.index, receivedBytes: existing.size, session: getUploadSession(row.id) };
    }
    throw conflict('Chunk index already exists with different range, size, or checksum');
  }

  const dir = sessionDir(row.id);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = chunkPath(row.id, input.index);
  const partPath = safeJoin(dir, `${input.index}.${uuid()}.part`);
  const hash = createHash('sha256');
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > expected.size) {
        callback(payloadTooLarge('Chunk exceeds expected Content-Range size'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const timeout = setTimeout(() => {
    input.body.destroy(new AppError(408, 'UPLOAD_TIMEOUT', 'Chunk upload timed out'));
  }, config.uploadChunkTimeoutMs);
  timeout.unref?.();

  try {
    await pipeline(input.body, meter, fs.createWriteStream(partPath, { flags: 'wx' }));
    if (received !== expected.size) {
      throw badRequest('Chunk byte count does not match Content-Range', {
        expected: expected.size,
        received,
      });
    }
    const actualChecksum = hash.digest('hex');
    if (actualChecksum !== checksum) {
      throw badRequest('Chunk checksum mismatch', { expected: checksum, actual: actualChecksum });
    }

    let idempotent = false;
    getDb().transaction(() => {
      const current = getDb()
        .prepare(`SELECT * FROM upload_chunks WHERE session_id = ? AND chunk_index = ?`)
        .get(row.id, input.index) as ChunkRow | undefined;
      if (current) {
        if (
          current.checksum !== checksum ||
          current.start_byte !== range.start ||
          current.end_byte !== range.end ||
          current.size !== received
        ) {
          throw conflict('Concurrent chunk upload conflicts with stored chunk');
        }
        idempotent = true;
        return;
      }
      if (fs.existsSync(finalPath)) fs.rmSync(finalPath, { force: true });
      fs.renameSync(partPath, finalPath);
      const t = now();
      getDb()
        .prepare(
          `INSERT INTO upload_chunks
           (session_id, chunk_index, start_byte, end_byte, size, checksum, path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(row.id, input.index, range.start, range.end, received, checksum, finalPath, t);
      getDb()
        .prepare(
          `UPDATE upload_sessions SET updated_at = ?, expires_at = ?, last_error = NULL
           WHERE id = ? AND status = 'uploading'`,
        )
        .run(t, expiresAt(), row.id);
    })();
    return { idempotent, chunkIndex: input.index, receivedBytes: received, session: getUploadSession(row.id) };
  } finally {
    clearTimeout(timeout);
    try {
      fs.rmSync(partPath, { force: true });
    } catch {
      /* best effort partial cleanup */
    }
  }
}

export function pauseUploadSession(id: string) {
  const row = loadSession(id);
  if (row.status === 'paused') return uploadSessionPublic(row);
  if (row.status !== 'uploading') throw conflict(`Upload session is ${row.status}`);
  const t = now();
  getDb()
    .prepare(`UPDATE upload_sessions SET status = 'paused', updated_at = ?, expires_at = ? WHERE id = ?`)
    .run(t, expiresAt(), id);
  return getUploadSession(id);
}

export function resumeUploadSession(id: string) {
  const row = loadSession(id);
  if (row.status === 'uploading') return uploadSessionPublic(row);
  if (row.status !== 'paused' && row.status !== 'failed') throw conflict(`Upload session is ${row.status}`);
  const t = now();
  getDb()
    .prepare(
      `UPDATE upload_sessions SET status = 'uploading', last_error = NULL, updated_at = ?, expires_at = ? WHERE id = ?`,
    )
    .run(t, expiresAt(), id);
  return getUploadSession(id);
}

export async function finalizeUploadSession(id: string): Promise<{
  session: ReturnType<typeof uploadSessionPublic>;
  file: PublicFile;
}> {
  let row = loadSession(id);
  if (row.finalized_file_id) {
    const existing = getFile(row.finalized_file_id);
    if (existing) return { session: uploadSessionPublic(row), file: filePublic(existing) };
  }

  // Heal a narrow crash window: file commit succeeded but session completion did not.
  const produced = getDb()
    .prepare(`SELECT id FROM files WHERE upload_session_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(id) as { id: string } | undefined;
  if (produced) {
    const t = now();
    getDb()
      .prepare(
        `UPDATE upload_sessions SET status = 'completed', finalized_file_id = ?, updated_at = ?, expires_at = ? WHERE id = ?`,
      )
      .run(produced.id, t, expiresAt(60 * 60 * 1000), id);
    row = loadSession(id);
    return { session: uploadSessionPublic(row), file: filePublic(getFile(produced.id)!) };
  }

  if (row.status !== 'uploading') throw conflict(`Upload session is ${row.status}`);
  const chunks = getDb()
    .prepare(`SELECT * FROM upload_chunks WHERE session_id = ? ORDER BY chunk_index`)
    .all(id) as ChunkRow[];
  const byIndex = new Map(chunks.map((chunk) => [chunk.chunk_index, chunk]));
  const missing: number[] = [];
  for (let i = 0; i < row.total_chunks; i += 1) {
    if (!byIndex.has(i)) missing.push(i);
  }
  if (missing.length) throw conflict('Upload has missing chunks', { missing });
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  if (totalBytes !== row.size) throw conflict('Stored chunk byte total does not match file size');

  const locked = getDb()
    .prepare(
      `UPDATE upload_sessions SET status = 'finalizing', updated_at = ?, last_error = NULL
       WHERE id = ? AND status = 'uploading'`,
    )
    .run(now(), id);
  if (locked.changes !== 1) throw conflict('Upload session is already finalizing');

  const ext = path.extname(row.original_name).toLowerCase();
  const storedName = randomServerName(ext);
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const destination = safeJoin(config.uploadsDir, storedName);

  try {
    const source = Readable.from(
      (async function* () {
        for (let i = 0; i < row.total_chunks; i += 1) {
          const chunk = byIndex.get(i)!;
          const expectedPath = chunkPath(id, i);
          if (path.resolve(chunk.path) !== path.resolve(expectedPath) || !fs.existsSync(expectedPath)) {
            throw conflict('Stored chunk is missing or outside the session directory', { chunkIndex: i });
          }
          for await (const bytes of fs.createReadStream(expectedPath)) yield bytes;
        }
      })(),
    );
    await pipeline(source, fs.createWriteStream(destination, { flags: 'wx' }));
    const assembledSize = fs.statSync(destination).size;
    if (assembledSize !== row.size) throw conflict('Finalized file size does not match session size');

    const file = await acceptUploadedFile({
      workspaceId: row.workspace_id,
      originalName: row.original_name,
      storedName,
      path: destination,
      size: row.size,
      declaredMime: row.declared_mime || undefined,
      uploadSessionId: id,
    });
    const t = now();
    getDb()
      .prepare(
        `UPDATE upload_sessions
         SET status = 'completed', finalized_file_id = ?, last_error = NULL,
             updated_at = ?, expires_at = ? WHERE id = ?`,
      )
      .run(file.id, t, expiresAt(60 * 60 * 1000), id);
    try {
      fs.rmSync(sessionDir(id), { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, sessionId: id }, 'Could not remove completed upload chunks');
    }
    return { session: getUploadSession(id), file };
  } catch (err) {
    try {
      fs.rmSync(destination, { force: true });
    } catch {
      /* best effort */
    }
    const message = err instanceof Error ? err.message : 'Upload finalize failed';
    getDb()
      .prepare(
        `UPDATE upload_sessions SET status = 'failed', last_error = ?, updated_at = ?, expires_at = ? WHERE id = ?`,
      )
      .run(message.slice(0, 500), now(), expiresAt(), id);
    throw err;
  }
}

export function cancelUploadSession(id: string): { cancelled: true; id: string } {
  const row = loadSession(id);
  if (row.status === 'completed') throw conflict('Completed upload cannot be cancelled');
  if (row.status === 'finalizing') throw conflict('Upload is finalizing and cannot be cancelled');
  getDb().prepare(`DELETE FROM upload_sessions WHERE id = ?`).run(id);
  fs.rmSync(sessionDir(id), { recursive: true, force: true });
  return { cancelled: true, id };
}

/** Delete only expired DB-owned sessions and old UUID-shaped orphan directories. */
export function cleanupExpiredUploadSessions(): { sessions: number; orphanDirectories: number } {
  fs.mkdirSync(config.uploadSessionsDir, { recursive: true });
  const expired = getDb()
    .prepare(`SELECT id FROM upload_sessions WHERE expires_at < ?`)
    .all(now()) as { id: string }[];
  let sessions = 0;
  for (const { id } of expired) {
    if (!SESSION_ID_RE.test(id)) continue;
    getDb().prepare(`DELETE FROM upload_sessions WHERE id = ?`).run(id);
    fs.rmSync(sessionDir(id), { recursive: true, force: true });
    sessions += 1;
  }

  const known = new Set(
    (getDb().prepare(`SELECT id FROM upload_sessions`).all() as { id: string }[]).map((r) => r.id),
  );
  let orphanDirectories = 0;
  const cutoff = Date.now() - config.uploadSessionTtlMs;
  for (const entry of fs.readdirSync(config.uploadSessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SESSION_ID_RE.test(entry.name) || known.has(entry.name)) continue;
    const dir = sessionDir(entry.name);
    if (fs.statSync(dir).mtimeMs >= cutoff) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    orphanDirectories += 1;
  }
  return { sessions, orphanDirectories };
}
