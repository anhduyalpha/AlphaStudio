import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

describe('live converter / client structural', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/ConverterView.jsx'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src/api/client.js'), 'utf8');
  const hook = fs.readFileSync(path.join(root, 'src/hooks/useWorkspaceEvents.js'), 'utf8');
  const live = fs.readFileSync(path.join(root, 'src/lib/liveState.js'), 'utf8');

  it('ConverterView upserts by id and uses workspace events', () => {
    assert.match(view, /upsertById/);
    assert.match(view, /useWorkspaceEvents/);
    assert.match(view, /applyWorkspaceEvent|mergeWorkspaceSnapshot/);
    assert.match(view, /localOnly|uiStatus/);
    // Must not only setServerFiles from full getWorkspace after all uploads
    assert.match(view, /Optimistic card|local-\$\{|localId/);
  });

  it('client has workspace SSE subscribe + rich upload metrics', () => {
    assert.match(client, /subscribeWorkspaceEvents/);
    assert.match(client, /workspaceEventsUrl/);
    assert.match(client, /computeUploadMetrics|speedBps/);
  });

  it('useWorkspaceEvents reconnects with backoff', () => {
    assert.match(hook, /EventSource|subscribeWorkspaceEvents/);
    assert.match(hook, /backoff|MAX_BACKOFF|onReconnect/);
  });

  it('liveState has ordered merge helpers', () => {
    assert.match(live, /isNewerEvent/);
    assert.match(live, /mergeWorkspaceSnapshot/);
    assert.match(live, /upsertById/);
  });
});
