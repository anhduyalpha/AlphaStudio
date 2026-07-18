import type { FastifyInstance } from 'fastify';
import { getDb, type ProfileRow } from '../db/index.js';
import { badRequest } from '../lib/errors.js';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/profile', async () => {
    const row = getDb().prepare('SELECT * FROM profile WHERE id = 1').get() as ProfileRow;
    return {
      displayName: row.display_name,
      studioName: row.studio_name,
      role: row.role,
      locationLabel: row.location_label,
      bio: row.bio,
      updatedAt: row.updated_at,
    };
  });

  app.put('/api/profile', async (req) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const displayName = str(body.displayName, 80);
    const studioName = str(body.studioName, 80);
    const role = str(body.role, 120);
    const locationLabel = str(body.locationLabel, 120);
    const bio = str(body.bio, 2000);
    if (!displayName && !studioName) throw badRequest('Nothing to update');

    const now = new Date().toISOString();
    const current = getDb().prepare('SELECT * FROM profile WHERE id = 1').get() as ProfileRow;
    getDb()
      .prepare(
        `UPDATE profile SET display_name = ?, studio_name = ?, role = ?, location_label = ?, bio = ?, updated_at = ? WHERE id = 1`,
      )
      .run(
        displayName || current.display_name,
        studioName || current.studio_name,
        role || current.role,
        locationLabel || current.location_label,
        bio !== undefined && body.bio !== undefined ? bio : current.bio,
        now,
      );
    const row = getDb().prepare('SELECT * FROM profile WHERE id = 1').get() as ProfileRow;
    return {
      displayName: row.display_name,
      studioName: row.studio_name,
      role: row.role,
      locationLabel: row.location_label,
      bio: row.bio,
      updatedAt: row.updated_at,
    };
  });
}

function str(v: unknown, max: number): string {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, max);
}
