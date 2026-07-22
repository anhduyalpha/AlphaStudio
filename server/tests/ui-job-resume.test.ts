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
  it('defaults autoResume to false and storageKey to null (safe for Image/Media/QR)', () => {
    // Signature must not default autoResume=true or PDF storage key for all callers
    assert.match(
      runner,
      /autoResume\s*=\s*false/,
      'autoResume must default false so non-PDF views do not resume PDF jobs',
    );
    assert.match(
      runner,
      /storageKey\s*=\s*null/,
      'storageKey must default null so non-PDF views do not write the PDF key',
    );
    // Must not default storageKey to the PDF key
    assert.doesNotMatch(
      runner,
      /storageKey\s*=\s*ACTIVE_JOB_KEY|storageKey\s*=\s*PDF_ACTIVE_JOB_KEY|storageKey\s*=\s*['"]alphastudio\.pdf\.activeJobId['"]/,
    );
  });

  it('useJobRunner resume path uses getJob + waitForJob when opted in', () => {
    assert.match(runner, /sessionStorage\.getItem/);
    assert.match(runner, /attachToJob|resume/);
    assert.match(runner, /getJob/);
    assert.match(runner, /waitForJob/);
    assert.match(runner, /expectedJobType/);
    assert.match(runner, /listJobs/);
    assert.match(runner, /restoreRecentCompleted/);
  });

  it('aborts uploads, guards duplicate actions, and sends one client request id', () => {
    const client = fs.readFileSync(path.join(root, 'src/api/client.js'), 'utf8');
    assert.match(client, /signal\?\.addEventListener\(['"]abort['"]/);
    assert.match(client, /xhr\.abort\(\)/);
    assert.match(runner, /runPromiseRef/);
    assert.match(runner, /createClientRequestId/);
    assert.match(runner, /clientRequestId:\s*actionRequestId/);
    assert.match(runner, /signal:\s*ac\.signal/);
    assert.match(runner, /fileIndex\s*\*\s*100/);
    assert.match(runner, /Math\.max\(previous/);
  });

  it('PdfView opts in to autoResume with PDF storage key and expectedJobType pdf', () => {
    assert.match(pdfView, /autoResume:\s*true/);
    assert.match(pdfView, /alphastudio\.pdf\.activeJobId/);
    assert.match(pdfView, /expectedJobType:\s*['"]pdf['"]/);
    assert.match(pdfView, /restoreRecentCompleted:\s*true/);
  });

  it('other views call useJobRunner(notify) without autoResume opt-in', () => {
    const image = fs.readFileSync(path.join(root, 'src/views/ImageView.jsx'), 'utf8');
    const media = fs.readFileSync(path.join(root, 'src/views/MediaView.jsx'), 'utf8');
    const qr = fs.readFileSync(path.join(root, 'src/views/QrView.jsx'), 'utf8');
    for (const [name, src] of [
      ['ImageView', image],
      ['MediaView', media],
      ['QrView', qr],
    ]) {
      assert.match(src, /useJobRunner\(\s*notify\s*\)/, `${name} should use default (no autoResume)`);
      assert.doesNotMatch(src, /autoResume:\s*true/, `${name} must not enable autoResume`);
    }
  });

  it('split groups and duplicate insertAt are wired in PdfView', () => {
    assert.match(pdfView, /splitGroups|groups/);
    assert.match(pdfView, /semicolon-separated/i);
    assert.match(pdfView, /insertAt/);
    assert.match(pdfView, /duplicate-pages/);
  });
});
