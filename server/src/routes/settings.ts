import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { badRequest } from '../lib/errors.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    const rows = getDb().prepare('SELECT key, value, updated_at FROM settings').all() as {
      key: string;
      value: string;
      updated_at: string;
    }[];
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return { settings };
  });

  app.put('/api/settings', async (req) => {
    const body = (req.body || {}) as { settings?: Record<string, unknown> };
    if (!body.settings || typeof body.settings !== 'object') {
      throw badRequest('settings object required');
    }
    const now = new Date().toISOString();
    const upsert = getDb().prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const tx = getDb().transaction((entries: [string, string][]) => {
      for (const [k, v] of entries) {
        if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(k)) throw badRequest(`Invalid setting key: ${k}`);
        upsert.run(k, String(v).slice(0, 2000), now);
      }
    });
    tx(Object.entries(body.settings).map(([k, v]) => [k, String(v)] as [string, string]));

    const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return { settings };
  });
}
