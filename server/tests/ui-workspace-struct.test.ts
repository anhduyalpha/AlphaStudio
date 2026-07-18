import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

describe('Workspace UI structural', () => {
  const client = fs.readFileSync(path.join(root, 'src/api/client.js'), 'utf8');
  const hook = fs.readFileSync(path.join(root, 'src/hooks/useWorkspace.js'), 'utf8');
  const converter = fs.readFileSync(path.join(root, 'src/views/ConverterView.jsx'), 'utf8');

  it('client has workspace recover/hydrate/patch APIs', () => {
    assert.match(client, /recoverWorkspace/);
    assert.match(client, /getWorkspace/);
    assert.match(client, /patchWorkspace/);
    assert.match(client, /clearWorkspace/);
    assert.match(client, /fileDownloadUrl|filePreviewUrl/);
  });

  it('useWorkspace stores only id in localStorage and debounces save', () => {
    assert.match(hook, /alphastudio-workspace-id/);
    assert.match(hook, /localStorage/);
    assert.match(hook, /debounceMs|setTimeout/);
    assert.match(hook, /recoverWorkspace|getWorkspace/);
  });

  it('Converter hydrates server files without re-upload and has loading state', () => {
    assert.match(converter, /useWorkspace/);
    assert.match(converter, /Restoring workspace|workspaceLoading/);
    assert.match(converter, /serverFiles|hydrated/);
    assert.match(converter, /skipUploadEffect|hydratedOnce/);
    assert.match(converter, /Clear|New workspace|removeFile|onClear|onNew/);
    assert.ok(!/localStorage\.setItem\(['"]files/.test(converter));
  });

  it('upload includes workspaceId', () => {
    assert.match(client, /workspaceId/);
    assert.match(converter, /workspaceId/);
  });
});
