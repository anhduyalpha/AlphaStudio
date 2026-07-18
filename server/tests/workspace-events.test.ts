/**
 * Workspace event bus + versioning + SSE route structural checks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emitWorkspaceEvent,
  onWorkspaceEvent,
  nextEventVersion,
} from '../src/lib/workspace-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

describe('workspace-events bus', () => {
  it('emits versioned events to workspace subscribers', () => {
    const received: unknown[] = [];
    const unsub = onWorkspaceEvent('ws-test-1', (ev) => received.push(ev));
    const a = emitWorkspaceEvent({
      type: 'file.created',
      workspaceId: 'ws-test-1',
      fileId: 'f1',
      status: 'processing',
    });
    const b = emitWorkspaceEvent({
      type: 'file.updated',
      workspaceId: 'ws-test-1',
      fileId: 'f1',
      status: 'ready',
    });
    unsub();
    assert.equal(received.length, 2);
    assert.ok(a.version < b.version);
    assert.equal((received[1] as { status: string }).status, 'ready');
    assert.ok(nextEventVersion() > b.version);
  });

  it('does not deliver to other workspace ids', () => {
    const received: unknown[] = [];
    const unsub = onWorkspaceEvent('ws-a', (ev) => received.push(ev));
    emitWorkspaceEvent({ type: 'file.created', workspaceId: 'ws-b', fileId: 'x' });
    unsub();
    assert.equal(received.length, 0);
  });
});

describe('workspace SSE route present', () => {
  it('registers GET /api/workspaces/:id/events', () => {
    const src = fs.readFileSync(path.join(root, 'src/routes/workspaces.ts'), 'utf8');
    assert.match(src, /\/api\/workspaces\/:id\/events/);
    assert.match(src, /text\/event-stream/);
    assert.match(src, /onWorkspaceEvent/);
  });

  it('insertFile emits file.created', () => {
    const src = fs.readFileSync(path.join(root, 'src/services/workspace.ts'), 'utf8');
    assert.match(src, /file\.created/);
    assert.match(src, /emitWorkspaceEvent/);
  });

  it('jobs emit workspace job.updated', () => {
    const src = fs.readFileSync(path.join(root, 'src/workers/jobs.ts'), 'utf8');
    assert.match(src, /emitWorkspaceEvent/);
    assert.match(src, /job\.updated|job\.created/);
  });
});
