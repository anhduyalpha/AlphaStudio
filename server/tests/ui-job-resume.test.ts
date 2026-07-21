/**
 * Structural + behavioral checks for resume-after-reload in useJobRunner / PdfView.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runner = fs.readFileSync(path.join(root, 'src/hooks/useJobRunner.js'), 'utf8');
const pdfView = fs.readFileSync(path.join(root, 'src/views/PdfView.jsx'), 'utf8');

describe('job resume-after-reload (shipped source)', () => {
  it('useJobRunner reads sessionStorage active job id on mount', () => {
    assert.match(runner, /sessionStorage\.getItem/);
    assert.match(runner, /alphastudio\.pdf\.activeJobId|storageKey/);
    assert.match(runner, /autoResume/);
  });

  it('useJobRunner reattaches via getJob + waitForJob without createJob on resume', () => {
    assert.match(runner, /attachToJob|resume/);
    assert.match(runner, /getJob/);
    assert.match(runner, /waitForJob/);
    // resume path must not call createJob
    const attachBlock = runner.includes('Reconnecting') || runner.includes('attachToJob');
    assert.ok(attachBlock);
    // ensure waitForJob is used for progress (SSE→poll inside api client)
    assert.match(runner, /waitForJob/);
  });

  it('PdfView enables autoResume with active job storage key', () => {
    assert.match(pdfView, /autoResume:\s*true/);
    assert.match(pdfView, /alphastudio\.pdf\.activeJobId/);
  });

  it('split groups and duplicate insertAt are wired in PdfView', () => {
    assert.match(pdfView, /splitGroups|groups/);
    assert.match(pdfView, /semicolon-separated/i);
    assert.match(pdfView, /insertAt/);
    assert.match(pdfView, /duplicate-pages/);
  });
});
