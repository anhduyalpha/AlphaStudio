import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import mediaHub from '../hubs/media';
import {
  buildMediaWorkbenchJobOptions,
  defaultMediaForm,
  mediaOperationCapability,
  mediaOperationsFor,
  validateMediaWorkbench,
} from '../lib/mediaJobOptions.js';
import {
  clampCropRect,
  defaultCropRect,
  naturalToDisplayPercent,
} from '../lib/imageCrop.js';
import MediaPreviewPanel from '../workbench/panels/MediaPreviewPanel.jsx';
import CropPanel from '../workbench/panels/CropPanel.jsx';
import TimelinePanel, { normalizeTimelineRange } from '../workbench/panels/TimelinePanel.jsx';
import WaveformPanel, { waveformPeaks } from '../workbench/panels/WaveformPanel.jsx';
import { getPanelLoader, validateHubReferences } from '../workbench/registry.jsx';

const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/hooks/useMediaWorkbench.js', import.meta.url)),
  'utf8',
);
const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/App.jsx', import.meta.url)),
  'utf8',
);
const PREVIEW_SOURCE = readFileSync(
  fileURLToPath(new URL('../workbench/panels/MediaPreviewPanel.jsx', import.meta.url)),
  'utf8',
);
const CROP_SOURCE = readFileSync(
  fileURLToPath(new URL('../workbench/panels/CropPanel.jsx', import.meta.url)),
  'utf8',
);
const PREVIEW_HOOK_SOURCE = readFileSync(
  fileURLToPath(new URL('../hooks/useJobPreviewUrl.js', import.meta.url)),
  'utf8',
);

describe('E4 Media Studio config', () => {
  it('declares executable video, audio, and image modes', () => {
    expect(mediaHub.modes.map((mode) => mode.id)).toEqual(['video', 'audio', 'image']);
    expect(mediaHub.modes[0]).toMatchObject({
      input: { kind: 'files', multiple: false, acceptFromJob: 'media' },
      panels: ['media-preview', 'timeline'],
      run: { job: { jobType: 'media', buildOptions: 'buildMediaJobOptions' } },
    });
    expect(mediaHub.modes[1]).toMatchObject({
      panels: ['media-preview', 'waveform', 'timeline'],
      run: { job: { jobType: 'audio' } },
    });
    expect(mediaHub.modes[2]).toMatchObject({
      panels: ['media-preview', 'crop'],
      run: { job: { jobType: 'image' } },
    });
  });

  it('resolves every hub config reference through the shared registry', () => {
    expect(validateHubReferences(mediaHub, {
      hasCapability: () => false,
      hasAcceptList: () => false,
      hasBuilder: (id) => id === 'buildMediaJobOptions',
      hasCompute: () => false,
      hasPanel: (id) => ['media-preview', 'crop', 'waveform', 'timeline'].includes(id),
    })).toEqual([]);
    expect(getPanelLoader('media-preview', {
      './panels/MediaPreviewPanel.jsx': () => Promise.resolve({ default: MediaPreviewPanel }),
    })).toBeTypeOf('function');
    expect(getPanelLoader('crop', {
      './panels/CropPanel.jsx': () => Promise.resolve({ default: CropPanel }),
    })).toBeTypeOf('function');
  });

  it('resolves the editor panel modules added after the media foundation', () => {
    expect(getPanelLoader('waveform', {
      './panels/WaveformPanel.jsx': () => Promise.resolve({ default: WaveformPanel }),
    })).toBeTypeOf('function');
    expect(getPanelLoader('timeline', {
      './panels/TimelinePanel.jsx': () => Promise.resolve({ default: TimelinePanel }),
    })).toBeTypeOf('function');
  });

  it('mounts a dedicated controller without media-name branches in Workbench', () => {
    expect(APP_SOURCE).toContain("import useMediaWorkbench from './hooks/useMediaWorkbench.js'");
    expect(APP_SOURCE).toContain('mode: mediaEnabled ? mode : null');
    expect(CONTROLLER_SOURCE).toContain('buildMediaWorkbenchJobOptions');
    expect(CONTROLLER_SOURCE).toContain("rememberActiveJob('media', modeId");
    expect(CONTROLLER_SOURCE).not.toMatch(/\b(fetch|XMLHttpRequest|EventSource)\b/);
  });
});

describe('E4 media option contracts', () => {
  it('covers every legacy video, audio, and image operation with a capability', () => {
    expect(mediaOperationsFor('video').map((entry) => entry.id)).toEqual([
      'trim',
      'transcode',
      'extract-audio',
      'inspect',
    ]);
    expect(mediaOperationsFor('audio').map((entry) => entry.id)).toEqual([
      'convert',
      'trim',
      'normalize',
      'inspect',
    ]);
    expect(mediaOperationsFor('image').map((entry) => entry.id)).toEqual([
      'optimize',
      'resize',
      'crop',
      'rotate',
      'convert',
      'compress',
      'strip-metadata',
    ]);
    expect(mediaOperationCapability('image', 'optimize')).toBe('image.compress');
    expect(mediaOperationCapability('video', 'extract-audio')).toBe('media.extract-audio');
  });

  it('keeps trim stream-copy honest and sends re-encode only when requested', () => {
    const base = defaultMediaForm('video', 'trim');
    expect(buildMediaWorkbenchJobOptions('video', base)).toEqual({
      operation: 'trim',
      start: '0',
      duration: '10',
    });
    expect(buildMediaWorkbenchJobOptions('video', {
      ...base,
      reencodeOnTrim: true,
      format: 'webm',
      quality: 'high',
    })).toMatchObject({
      operation: 'trim',
      forceReencode: true,
      reencode: true,
      format: 'webm',
      quality: 'high',
    });
  });

  it('builds natural-pixel crop jobs and validates destructive inputs', () => {
    const form = {
      ...defaultMediaForm('image', 'crop'),
      crop: { left: 10, top: 20, width: 300, height: 200 },
    };
    expect(buildMediaWorkbenchJobOptions('image', form)).toMatchObject({
      operation: 'crop',
      left: 10,
      top: 20,
      width: 300,
      height: 200,
    });
    expect(validateMediaWorkbench('image', { ...form, crop: null }, { id: 'image' }))
      .toMatch(/valid crop region/i);
    expect(validateMediaWorkbench('video', {
      ...defaultMediaForm('video', 'trim'),
      duration: '0',
    }, { id: 'video' })).toMatch(/at least 0.05/i);
  });

  it('keeps crop math centered, clamped, and display-independent', () => {
    const dimensions = { naturalWidth: 1000, naturalHeight: 800 };
    expect(defaultCropRect(dimensions)).toEqual({
      left: 250,
      top: 200,
      width: 500,
      height: 400,
    });
    expect(clampCropRect(
      { left: 950, top: -20, width: 500, height: 900 },
      dimensions,
    )).toEqual({ left: 500, top: 0, width: 500, height: 800 });
    expect(naturalToDisplayPercent(
      { left: 250, top: 200, width: 500, height: 400 },
      dimensions,
    )).toEqual({ left: 25, top: 25, width: 50, height: 50 });
  });
});

describe('E4 media panel states and layering', () => {
  it('renders preview empty, loading, and recovery states', () => {
    const empty = renderToStaticMarkup(
      <MediaPreviewPanel state={{ mode: 'video' }} dispatch={() => {}} />,
    );
    const loading = renderToStaticMarkup(
      <MediaPreviewPanel
        state={{ mode: 'audio', file: { originalName: 'track.wav' }, previewStatus: 'loading' }}
        dispatch={() => {}}
      />,
    );
    const error = renderToStaticMarkup(
      <MediaPreviewPanel
        state={{
          mode: 'image',
          file: { originalName: 'broken.png' },
          previewStatus: 'error',
          previewError: 'Read failed',
        }}
        dispatch={() => {}}
      />,
    );
    expect(empty).toContain('No video selected');
    expect(loading).toContain('Loading audio preview');
    expect(error).toContain('Could not load the source preview');
    expect(error).toContain('Retry preview');
  });

  it('renders crop empty/recovery state and hides outside crop mode', () => {
    expect(renderToStaticMarkup(
      <CropPanel state={{ visible: false }} dispatch={() => {}} />,
    )).toBe('');
    const empty = renderToStaticMarkup(
      <CropPanel state={{ visible: true }} dispatch={() => {}} />,
    );
    const error = renderToStaticMarkup(
      <CropPanel
        state={{
          visible: true,
          file: { originalName: 'broken.png' },
          previewStatus: 'error',
          previewError: 'Decode failed',
        }}
        dispatch={() => {}}
      />,
    );
    expect(empty).toContain('No image selected');
    expect(error).toContain('Could not render the crop canvas');
  });

  it('keeps API/protocol/store ownership outside lazy panels and revokes blob URLs', () => {
    for (const source of [PREVIEW_SOURCE, CROP_SOURCE]) {
      expect(source).not.toMatch(/from ['"].*(api|protocol|store)/);
      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
    expect(PREVIEW_SOURCE).toContain('useJobPreviewUrl');
    expect(PREVIEW_HOOK_SOURCE).toContain('URL.revokeObjectURL');
    expect(PREVIEW_HOOK_SOURCE).toContain('api.fetchJobBlob(jobId)');
  });

  it('has pointer crop and undecodable-media recovery paths', () => {
    expect(CROP_SOURCE).toContain('onPointerDown');
    expect(CROP_SOURCE).toContain('setPointerCapture');
    expect(CROP_SOURCE).toContain('clientToNatural');
    expect(PREVIEW_SOURCE).toContain('onError');
    expect(PREVIEW_SOURCE).toContain('This media cannot be decoded in the browser');
  });
});

describe('E5 waveform and timeline editors', () => {
  it('reduces decoded samples into bounded waveform peaks', () => {
    const samples = Float32Array.from([0, 0.2, -0.8, 0.1, 0.5, -0.1, 0.3, 1]);
    const peaks = waveformPeaks(samples, 8);
    expect(peaks).toHaveLength(8);
    expect(peaks.every((peak) => peak >= 0.08 && peak <= 1)).toBe(true);
    expect(Math.max(...peaks)).toBe(1);
  });

  it('clamps timeline start/end/duration to the decoded media duration', () => {
    expect(normalizeTimelineRange({
      total: 10,
      start: 9.98,
      duration: 4,
    })).toEqual({
      total: 10,
      start: 9.95,
      end: 10,
      duration: 0.05,
    });
    expect(normalizeTimelineRange({ total: 0, start: -2, duration: 0 }))
      .toEqual({ total: 10, start: 0, end: 10, duration: 10 });
  });

  it('renders waveform fallback entry and an accessible trim timeline', () => {
    const waveform = renderToStaticMarkup(
      <WaveformPanel state={{ visible: true }} />,
    );
    const timeline = renderToStaticMarkup(
      <TimelinePanel
        state={{ visible: true, total: 12, start: 2, duration: 4 }}
        dispatch={() => {}}
      />,
    );
    expect(waveform).toContain('Waveform waiting for audio');
    expect(timeline).toContain('Trim selection');
    expect(timeline).toContain('4.00s selected');
    expect(timeline).toContain('aria-label="Trim start"');
    expect(timeline).toContain('aria-label="Trim end"');
  });
});
