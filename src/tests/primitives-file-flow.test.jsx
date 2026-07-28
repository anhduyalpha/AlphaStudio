import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Dropzone,
  ErrorState,
  FileList,
  FileRow,
  ProgressBar,
  ResumeStrip,
  RunBar,
  Toast,
  ToastRegion,
  formatBytes,
  parseCssDuration,
} from '../next/components/index.jsx';

const COMPONENTS_DIR = fileURLToPath(new URL('../next/components/', import.meta.url));
const PRIMITIVES_CSS = fileURLToPath(new URL('../styles/primitives.css', import.meta.url));
const MOTION_CSS = fileURLToPath(new URL('../styles/motion.css', import.meta.url));

describe('C3 file primitives', () => {
  it.each(['files', 'paste'])('renders the %s Dropzone with one native browse input', (variant) => {
    const html = renderToStaticMarkup(
      <Dropzone variant={variant} accept=".png,.jpg" multiple />,
    );
    expect(html).toContain(`dropzone--${variant}`);
    expect(html.match(/type="file"/g) ?? []).toHaveLength(1);
    expect(html).toContain('accept=".png,.jpg"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('type="button"');
    expect(html).toContain('Browse files');
  });

  it('shows an explicit disabled Dropzone state', () => {
    const html = renderToStaticMarkup(<Dropzone disabled />);
    expect(html).toContain('is-disabled');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
  });

  it('renders visibly distinct empty and populated Dropzone copy', () => {
    const empty = renderToStaticMarkup(<Dropzone />);
    const populated = renderToStaticMarkup(<Dropzone empty={false} />);
    expect(empty).toContain('is-empty');
    expect(empty).toContain('Drop files here');
    expect(populated).not.toContain('is-empty');
    expect(populated).toContain('Add more files');
  });

  it('renders FileRow slots and state treatments', () => {
    const html = renderToStaticMarkup(
      <FileRow
        name="interview.mov"
        size={1572864}
        status="uploading"
        progress={42}
        selected
        actions={<button type="button">Remove</button>}
      />,
    );
    expect(html).toContain('is-selected');
    expect(html).toContain('is-loading');
    expect(html).toContain('interview.mov');
    expect(html).toContain('1.5 MB');
    expect(html).toContain('file-row__status');
    expect(html).toContain('file-row__meta');
    expect(html).toContain('file-row__progress');
    expect(html).toContain('file-row__actions');
  });

  it('uses one exported byte formatter for file metadata', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });

  it('renders a designed FileList empty state instead of a blank region', () => {
    const html = renderToStaticMarkup(<FileList items={[]} />);
    expect(html).toContain('file-list--empty');
    expect(html).toContain('No files yet');
    expect(html).toContain('empty-state');
  });
});

describe('C3 flow primitives', () => {
  it('clamps and announces determinate progress while using a transform scale', () => {
    const html = renderToStaticMarkup(<ProgressBar value={140} label="Uploading" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('--progress-scale:1');
  });

  it('keeps indeterminate progress value-free and supports silent visual progress', () => {
    const active = renderToStaticMarkup(<ProgressBar variant="indeterminate" label="Working" />);
    const reduced = renderToStaticMarkup(<ProgressBar variant="indeterminate" reduced label="Working" />);
    const silent = renderToStaticMarkup(<ProgressBar value={25} announce={false} />);
    expect(active).toContain('role="progressbar"');
    expect(active).not.toContain('aria-valuenow');
    expect(reduced).toContain('is-reduced');
    expect(silent).toContain('aria-hidden="true"');
    expect(silent).not.toContain('role="progressbar"');
  });

  it('requires a visible named recovery action in ErrorState', () => {
    expect(() => renderToStaticMarkup(
      <ErrorState title="Conversion failed" message="The source is truncated." />,
    )).toThrow(/named recovery action/i);

    const html = renderToStaticMarkup(
      <ErrorState
        title="Conversion failed"
        message="The source is truncated."
        actionLabel="Retry"
        onAction={() => {}}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Retry');
  });

  it.each([
    ['2600ms', 2600],
    ['2.6s', 2600],
    [' 220ms ', 220],
    ['', 0],
    ['invalid', 0],
  ])('parses token timing %s without a JS duration literal', (source, expected) => {
    expect(parseCssDuration(source)).toBe(expected);
  });

  it.each(['notice', 'success', 'danger'])('renders a %s Toast in a persistent live region', (tone) => {
    const html = renderToStaticMarkup(
      <ToastRegion><Toast tone={tone}>Saved locally</Toast></ToastRegion>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(`toast--${tone}`);
    expect(html).toContain('Saved locally');
  });

  it('does not separately announce RunBar aggregate progress', () => {
    const html = renderToStaticMarkup(
      <RunBar
        status="Converting 2 files"
        progress={48}
        primaryAction={<button type="button">Convert</button>}
        secondaryAction={<button type="button">Cancel</button>}
      />,
    );
    expect(html).toContain('run-bar');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="progressbar"');
  });

  it('keeps full and uploads-only ResumeStrip placement contracts distinct', () => {
    const uploads = [{
      id: 'upload-1',
      originalName: 'large-video.mov',
      receivedBytes: 512,
      size: 1024,
      href: '#/convert?mode=video',
    }];
    const jobs = [{
      id: 'job-1',
      label: 'Archive batch',
      status: 'queued',
      progress: 0,
      href: '#/security?mode=archive',
    }];
    const full = renderToStaticMarkup(
      <ResumeStrip uploadSessions={uploads} jobs={jobs} onResume={() => {}} onDiscard={() => {}} />,
    );
    const uploadsOnly = renderToStaticMarkup(
      <ResumeStrip variant="uploads-only" uploadSessions={uploads} jobs={jobs} onResume={() => {}} onDiscard={() => {}} />,
    );
    expect(full).toContain('large-video.mov');
    expect(full).toContain('Archive batch');
    expect(full).toContain('Resume');
    expect(full).toContain('Discard');
    expect(uploadsOnly).toContain('large-video.mov');
    expect(uploadsOnly).not.toContain('Archive batch');
  });

  it('renders the required ResumeStrip empty copy', () => {
    const html = renderToStaticMarkup(<ResumeStrip />);
    expect(html).toContain('Nothing to resume.');
  });

  it('refuses resumable entries that cannot link to their owning workflow', () => {
    expect(() => renderToStaticMarkup(
      <ResumeStrip uploadSessions={[{
        id: 'orphan',
        originalName: 'orphan.mov',
        size: 100,
        receivedBytes: 50,
      }]} onResume={() => {}} onDiscard={() => {}} />,
    )).toThrow(/owning workflow/i);
  });

  it('requires full mode ownership and functional upload recovery handlers', () => {
    const session = {
      id: 'upload',
      originalName: 'video.mov',
      size: 100,
      receivedBytes: 50,
      href: '#/media',
    };
    expect(() => renderToStaticMarkup(
      <ResumeStrip uploadSessions={[session]} />,
    )).toThrow(/handlers/i);
    expect(() => renderToStaticMarkup(
      <ResumeStrip uploadSessions={[session]} onResume={() => {}} onDiscard={() => {}} />,
    )).toThrow(/hub and mode/i);
    expect(() => renderToStaticMarkup(
      <ResumeStrip
        uploadSessions={[{ ...session, href: '?mode=convert' }]}
        onResume={() => {}}
        onDiscard={() => {}}
      />,
    )).toThrow(/hub and mode/i);
    expect(() => renderToStaticMarkup(
      <ResumeStrip
        uploadSessions={[{ ...session, href: 'https://example.test/?mode=convert' }]}
        onResume={() => {}}
        onDiscard={() => {}}
      />,
    )).toThrow(/hub and mode/i);
  });

  it('filters terminal jobs out of the full ResumeStrip', () => {
    const html = renderToStaticMarkup(<ResumeStrip jobs={[
      { id: 'running', label: 'Running job', status: 'running', progress: 50, href: '#/media?mode=convert' },
      { id: 'done', label: 'Completed job', status: 'completed', progress: 100, href: '#/media?mode=convert' },
      { id: 'failed', label: 'Failed job', status: 'failed', progress: 70, href: '#/media?mode=convert' },
    ]} />);
    expect(html).toContain('Running job');
    expect(html).not.toContain('Completed job');
    expect(html).not.toContain('Failed job');
  });

  it('makes disabled FileRow action descendants inert', () => {
    const html = renderToStaticMarkup(
      <FileRow name="locked.pdf" disabled actions={<button type="button">Remove</button>} />,
    );
    expect(html).toContain('inert=""');
  });
});

describe('C3 structural invariants', () => {
  it('has one file input, byte formatter, and progressbar implementation in the rebuild component layer', () => {
    const sources = fs
      .readdirSync(COMPONENTS_DIR)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => ({
        file,
        source: fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8'),
      }));
    expect(sources.filter(({ source }) => source.includes('type="file"')).map(({ file }) => file))
      .toEqual(['Dropzone.jsx']);
    expect(sources.filter(({ source }) => source.includes('export function formatBytes')).map(({ file }) => file))
      .toEqual(['FileRow.jsx']);
    expect(sources.filter(({ source }) => source.includes("role: 'progressbar'")).map(({ file }) => file))
      .toEqual(['ProgressBar.jsx']);
  });

  it('uses the exact glass recipe only for C3 glass surfaces and preserves an opaque fallback', () => {
    const css = fs.readFileSync(PRIMITIVES_CSS, 'utf8');
    expect(css).toContain('backdrop-filter: blur(var(--glass-blur))');
    expect(css).toMatch(/\.toast,[\s\S]*\.run-bar[\s\S]*background: var\(--glass-bg\)/);
    expect(css).toMatch(/\[data-power='low'\][\s\S]*background: var\(--surface\)/);
  });

  it('uses transform rather than width for progress motion and supplies reduced-motion forms', () => {
    const css = fs.readFileSync(PRIMITIVES_CSS, 'utf8');
    const motionCss = fs.readFileSync(MOTION_CSS, 'utf8');
    expect(css).toContain('transform: scaleX(var(--progress-scale))');
    const progressSource = fs.readFileSync(path.join(COMPONENTS_DIR, 'ProgressBar.jsx'), 'utf8');
    expect(progressSource).not.toMatch(/style=\{\{[^}]*width/s);
    expect(motionCss).toMatch(/prefers-reduced-motion:[\s\S]*\.progress-bar--indeterminate/);
    expect(motionCss).toMatch(/prefers-reduced-motion:[\s\S]*animation: none !important/);
    expect(motionCss).toMatch(/html\[data-motion='reduced'\][\s\S]*\.progress-bar--indeterminate/);
    expect(motionCss).toMatch(/html\[data-motion='reduced'\][\s\S]*animation: none !important/);
    expect(css).toContain('.toast--enter');
    expect(css).toContain('.toast--exit');
  });
});
