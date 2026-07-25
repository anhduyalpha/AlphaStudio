import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Security typed results structural (RQ7)', () => {
  it('SecurityView uses JobOutputCard with mode titles and showTyped', () => {
    const src = read('src/views/SecurityView.jsx');
    assert.match(src, /JobOutputCard/);
    assert.match(src, /showTyped/);
    assert.match(src, /security-mode-hash/);
    assert.match(src, /security-mode-compare/);
    assert.match(src, /security-mode-password/);
    assert.match(src, /Checksums ready|Checksum comparison|Generated password/);
  });

  it('JobResultBody can render security payload kinds', () => {
    const body = read('src/components/results/JobResultBody.jsx');
    assert.match(body, /job-result-hash/);
    assert.match(body, /job-result-compare/);
    assert.match(body, /job-result-password/);
    assert.match(body, /job-result-signature/);
    assert.match(body, /job-result-metadata/);
  });
});
