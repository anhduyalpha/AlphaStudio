import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { detectFile, type InspectResult } from '../convert/detect.js';
import { intersectOutputs, type OutputOption } from '../convert/matrix.js';
import {
  capabilitySnapshot,
  invalidateEngineRegistry,
  publicCapabilitySnapshot,
} from '../convert/engines/index.js';
import { allFormatDefinitions } from '../convert/formats.js';

type UploadInspectRow = {
  id: string;
  path: string;
  original_name: string;
  checksum?: string | null;
};

function parseDetectJson(raw: string | null | undefined): InspectResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InspectResult;
  } catch {
    return null;
  }
}

async function inspectUploadRow(row: UploadInspectRow): Promise<InspectResult> {
  // Prefer files.detect_json + checksum when bridged from workspace files table
  const fileRow = getDb()
    .prepare(`SELECT checksum, detect_json FROM files WHERE id = ?`)
    .get(row.id) as { checksum: string | null; detect_json: string | null } | undefined;
  const checksum = fileRow?.checksum || row.checksum || undefined;
  const reuseDetect = parseDetectJson(fileRow?.detect_json || null);
  return detectFile(row.path, row.original_name, { checksum: checksum || undefined, reuseDetect });
}

export async function inspectRoutes(app: FastifyInstance): Promise<void> {
  /** Inspect a single stored upload */
  app.get('/api/uploads/:id/inspect', async (req) => {
    const { id } = req.params as { id: string };
    const row = getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(id) as
      | UploadInspectRow
      | undefined;
    if (!row) throw notFound('Upload not found');
    return inspectUploadRow(row);
  });

  /** Inspect one or many uploads; compute common outputs */
  app.post('/api/inspect', async (req) => {
    const body = (req.body || {}) as { uploadIds?: string[] };
    const ids = body.uploadIds || [];
    if (!ids.length) throw badRequest('uploadIds required');

    const files = [];
    const outputLists: OutputOption[][] = [];

    for (const id of ids) {
      const row = getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(id) as
        | UploadInspectRow
        | undefined;
      if (!row) throw badRequest(`Unknown upload id: ${id}`);
      const ins = await inspectUploadRow(row);
      files.push({ uploadId: id, ...ins });
      outputLists.push(ins.outputs);
    }

    const { outputs, conflict } = intersectOutputs(outputLists);
    const recommended =
      outputs.find((o) => o.available)?.format ||
      files[0]?.recommendedOutput ||
      null;

    // family consensus
    const families = [...new Set(files.map((f) => f.family))];
    const family = families.length === 1 ? families[0] : 'mixed';

    return {
      files,
      family,
      outputs,
      recommendedOutput: conflict ? null : recommended,
      conflict: conflict || null,
      valid: !conflict && outputs.some((o) => o.available),
    };
  });

  /** Conversion matrix / capability snapshot for converter UI */
  app.get('/api/convert/matrix', async () => {
    const { getToolsSnapshot, listOutputsFor } = await import('../convert/matrix.js');
    const tools = getToolsSnapshot();
    const families = [
      'image',
      'audio',
      'video',
      'document',
      'spreadsheet',
      'presentation',
      'archive',
      'ebook',
      'text',
      'pdf',
    ] as const;
    const samples: Record<string, OutputOption[]> = {};
    for (const fam of families) {
      const sampleFmt =
        fam === 'image'
          ? 'png'
          : fam === 'audio'
            ? 'mp3'
            : fam === 'video'
              ? 'mp4'
              : fam === 'document'
                ? 'docx'
                : fam === 'spreadsheet'
                  ? 'xlsx'
                  : fam === 'presentation'
                    ? 'pptx'
                    : fam === 'archive'
                      ? 'zip'
                      : fam === 'ebook'
                        ? 'epub'
                        : fam === 'text'
                          ? 'txt'
                          : 'pdf';
      samples[fam] = listOutputsFor(
        { family: fam, format: sampleFmt, ext: `.${sampleFmt}`, mime: '' },
        tools,
      );
    }
    return {
      tools: Object.fromEntries(
        Object.entries(tools).map(([k, v]) => [
          k,
          { available: v.available, version: v.version || null, source: v.source },
        ]),
      ),
      ...publicCapabilitySnapshot(capabilitySnapshot()),
      formats: allFormatDefinitions(),
      families: samples,
    };
  });

  /** Re-probe tools and rebuild the registry snapshot without a server restart. */
  app.post('/api/convert/matrix/refresh', async () => {
    invalidateEngineRegistry();
    return {
      refreshed: true,
      ...publicCapabilitySnapshot(capabilitySnapshot(true)),
    };
  });
}
