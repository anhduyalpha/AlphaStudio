import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('resumable upload frontend contract', () => {
  it('has persisted session recovery, bounded chunk hashing, and real lifecycle controls', () => {
    const client = read('src/api/resumableUpload.js');
    const api = read('src/api/client.js');
    const view = read('src/views/ConverterView.jsx');

    assert.match(client, /localStorage\.setItem/);
    assert.match(client, /receivedChunks/);
    assert.match(client, /file\.slice\(start, endExclusive\)/);
    assert.match(client, /crypto\.subtle\.digest\('SHA-256'/);
    assert.doesNotMatch(client, /this\.file\.arrayBuffer\(/);
    assert.match(client, /Content-Range/);
    assert.match(client, /X-Chunk-SHA256/);
    assert.match(api, /listUploadSessions/);
    assert.match(view, /MAX_CONCURRENT_UPLOADS = 3/);
    assert.match(view, />Pause</);
    assert.match(view, />Resume</);
    assert.match(view, />Retry</);
    assert.match(view, />Cancel</);
    assert.match(view, /receivedBytes/);
    assert.match(view, /speedBps/);
    assert.match(view, /etaSeconds/);
  });
});
