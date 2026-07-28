import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ResumeStrip from '../next/components/ResumeStrip.jsx';
import Home, {
  formatRelativeTime,
  formatStorage,
  homeJobDestination,
  homeStats,
  homeUploadDestination,
} from '../next/views/Home.jsx';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/App.jsx', import.meta.url)),
  'utf8',
);
const HOME_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/views/Home.jsx', import.meta.url)),
  'utf8',
);
const WORKBENCH_SOURCE = readFileSync(
  fileURLToPath(new URL('../workbench/Workbench.jsx', import.meta.url)),
  'utf8',
);

describe('V1 Home view', () => {
  it('maps every job family to an owning hub and mode', () => {
    expect(homeJobDestination({ type: 'converter', options: {} })).toEqual({
      hubId: 'convert',
      modeId: 'convert',
    });
    expect(homeJobDestination({ type: 'pdf', options: {} })).toEqual({
      hubId: 'pdf',
      modeId: 'operations',
    });
    expect(homeJobDestination({ type: 'audio', options: {} })).toEqual({
      hubId: 'media',
      modeId: 'audio',
    });
    expect(homeJobDestination({ type: 'text', options: { _mode: 'dev' } })).toEqual({
      hubId: 'text',
      modeId: 'dev',
    });
    expect(homeJobDestination({ type: 'image', options: { _mode: 'color' } })).toEqual({
      hubId: 'utilities',
      modeId: 'color',
    });
    expect(homeJobDestination({ type: 'archive', options: {} })).toEqual({
      hubId: 'security',
      modeId: 'archive',
    });
  });

  it('routes resumable sessions by published file evidence with a safe Convert fallback', () => {
    expect(homeUploadDestination({ originalName: 'brief.pdf' })).toEqual({
      hubId: 'pdf',
      modeId: 'operations',
    });
    expect(homeUploadDestination({ originalName: 'clip.bin', mime: 'video/mp4' })).toEqual({
      hubId: 'media',
      modeId: 'video',
    });
    expect(homeUploadDestination({ originalName: 'bundle.7z' })).toEqual({
      hubId: 'security',
      modeId: 'archive',
    });
    expect(homeUploadDestination({ originalName: 'unknown.data' })).toEqual({
      hubId: 'convert',
      modeId: 'convert',
    });
  });

  it('derives command-center stats from the single workspace snapshot', () => {
    expect(homeStats({
      files: [{ size: 1024 }, { size: 2048 }],
      outputs: [{ size: 1024 }],
      jobs: [
        { status: 'completed' },
        { status: 'running' },
        { status: 'queued' },
        { status: 'failed' },
      ],
    })).toEqual({
      jobsRun: 4,
      storageBytes: 4096,
      activeJobs: 2,
      completedJobs: 1,
    });
    expect(formatStorage(4096)).toBe('4.0 KB');
    expect(formatRelativeTime('2026-07-28T10:29:00.000Z', Date.parse('2026-07-28T10:30:00.000Z')))
      .toBe('1 minute ago');
  });

  it('mounts Home at #/ with store-only workspace reads and registry-derived launchers', () => {
    expect(APP_SOURCE).toContain("import Home from './views/Home.jsx'");
    expect(APP_SOURCE).toContain("route.id === 'home'");
    expect(APP_SOURCE).toContain('<Home />');
    expect(HOME_SOURCE).toContain('useStore(selectSnapshot)');
    expect(HOME_SOURCE).toContain('hubRegistry.map');
    expect(HOME_SOURCE).toContain('<ResumeStrip');
    expect(HOME_SOURCE).not.toMatch(/\b(fetch|XMLHttpRequest|EventSource)\s*\(/);
    expect(renderToStaticMarkup(<Home />)).toContain('Loading Home');
  });
});

describe('V1 ResumeStrip placements', () => {
  it('renders the full Home placement with linked upload and active-job entries', () => {
    const html = renderToStaticMarkup(
      <ResumeStrip
        uploadSessions={[{
          id: 'session-1',
          originalName: 'large-video.mp4',
          size: 10_000,
          receivedBytes: 4_000,
          hubId: 'media',
          modeId: 'video',
        }]}
        jobs={[{
          id: 'job-1',
          type: 'qr',
          status: 'running',
          progress: 64,
          label: 'QR image',
          hubId: 'utilities',
          modeId: 'qr',
        }]}
        onResume={() => {}}
        onDiscard={() => {}}
      />,
    );
    expect(html).toContain('Continue where you left off');
    expect(html).toContain('large-video.mp4');
    expect(html).toContain('href="#/media?mode=video"');
    expect(html).toContain('href="#/utilities?mode=qr"');
    expect(html).toContain('Resume');
    expect(html).toContain('Discard');
  });

  it('keeps the uploads-only strip above Dropzone and never creates session file rows', () => {
    const inputStart = WORKBENCH_SOURCE.indexOf('function InputRegion');
    const configureStart = WORKBENCH_SOURCE.indexOf('function ConfigureRegion');
    const inputSource = WORKBENCH_SOURCE.slice(inputStart, configureStart);
    expect(inputSource).toContain('variant="uploads-only"');
    expect(inputSource.indexOf('<ResumeStrip')).toBeLessThan(inputSource.indexOf('<Dropzone'));
    expect(inputSource).not.toContain('localOnly: true');
    expect(inputSource).not.toContain('synthetic');
  });
});
