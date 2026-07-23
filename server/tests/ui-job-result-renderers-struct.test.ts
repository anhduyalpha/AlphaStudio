import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Job result typed renderers structural (RQ1)', () => {
  it('exports classifiers and JobResultBody kinds', () => {
    const kind = read('src/lib/jobResultKind.js');
    assert.match(kind, /export function classifyJobResult/);
    assert.match(kind, /export function classifyJsonPayload/);
    assert.match(kind, /checksum-compare/);
    assert.match(kind, /archive-listing/);
    assert.match(kind, /media-inspect/);

    const body = read('src/components/results/JobResultBody.jsx');
    assert.match(body, /job-result-hash/);
    assert.match(body, /job-result-compare/);
    assert.match(body, /job-result-password/);
    assert.match(body, /job-result-signature/);
    assert.match(body, /job-result-image/);
    assert.match(body, /fetchJobText|fetchJobBlob/);
  });

  it('JobOutputCard embeds typed body; ImageView uses auth-safe preview hook', () => {
    const card = read('src/components/JobOutputCard.jsx');
    assert.match(card, /JobResultBody/);
    assert.match(card, /showTyped/);

    const image = read('src/views/ImageView.jsx');
    assert.match(image, /useJobPreviewUrl/);
    assert.doesNotMatch(image, /job\.previewUrl/);
    assert.doesNotMatch(image, /api\.filePreviewUrl/);

    const api = read('src/api/client.js');
    assert.match(api, /async fetchJobBlob/);
  });
});
