/**
 * Unit tests for quality presets (fast / balanced / high).
 * Ensures preset differentiation and default resolution without starting the HTTP server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_QUALITY_PRESET,
  QUALITY_PRESETS,
  assertValidOutput,
  audioEncodeSettings,
  canStreamCopy,
  imageEncodeOptions,
  pdfCompressOptions,
  resolveNumericQuality,
  resolveQualityPreset,
  sharpFormatOptions,
  videoEncodeSettings,
} from '../src/convert/quality.js';

describe('resolveQualityPreset', () => {
  it('defaults to balanced', () => {
    assert.equal(resolveQualityPreset(undefined), 'balanced');
    assert.equal(resolveQualityPreset({}), 'balanced');
    assert.equal(resolveQualityPreset({ quality: undefined }), 'balanced');
    assert.equal(resolveQualityPreset(null), 'balanced');
    assert.equal(DEFAULT_QUALITY_PRESET, 'balanced');
  });

  it('accepts fast | balanced | high strings', () => {
    assert.equal(resolveQualityPreset({ quality: 'fast' }), 'fast');
    assert.equal(resolveQualityPreset({ quality: 'balanced' }), 'balanced');
    assert.equal(resolveQualityPreset({ quality: 'high' }), 'high');
    assert.equal(resolveQualityPreset('fast'), 'fast');
    assert.equal(resolveQualityPreset('HIGH'), 'high');
  });

  it('maps common aliases', () => {
    assert.equal(resolveQualityPreset({ quality: 'small' }), 'fast');
    assert.equal(resolveQualityPreset({ quality: 'max' }), 'high');
    assert.equal(resolveQualityPreset({ quality: 'best' }), 'high');
    assert.equal(resolveQualityPreset({ quality: 'low' }), 'fast');
  });

  it('numeric quality falls back to balanced preset (number applied separately)', () => {
    assert.equal(resolveQualityPreset({ quality: 70 }), 'balanced');
    assert.equal(resolveNumericQuality({ quality: 70 }), 70);
    assert.equal(resolveNumericQuality({ quality: 'fast' }), undefined);
    assert.equal(resolveNumericQuality({ quality: 'high' }), undefined);
  });
});

describe('imageEncodeOptions preset differentiation', () => {
  it('fast options !== high options for jpeg/webp/avif/png', () => {
    for (const format of ['jpeg', 'webp', 'avif', 'png'] as const) {
      const fast = imageEncodeOptions('fast', format);
      const high = imageEncodeOptions('high', format);
      const balanced = imageEncodeOptions('balanced', format);

      assert.notDeepEqual(
        fast,
        high,
        `fast and high image options must differ for ${format}`,
      );
      assert.notDeepEqual(fast, balanced, `fast and balanced must differ for ${format}`);
      assert.notDeepEqual(high, balanced, `high and balanced must differ for ${format}`);

      // Quality ladder for lossy formats
      if (format !== 'png') {
        assert.ok(fast.quality < high.quality, `${format}: fast.quality < high.quality`);
        assert.ok(
          fast.quality <= balanced.quality && balanced.quality <= high.quality,
          `${format}: quality ladder fast ≤ balanced ≤ high`,
        );
      }

      // Kernels: high/balanced use lanczos3; fast uses faster cubic
      assert.equal(high.kernel, 'lanczos3');
      assert.equal(balanced.kernel, 'lanczos3');
      assert.equal(fast.kernel, 'cubic');

      // withoutEnlargement default always true
      assert.equal(fast.withoutEnlargementDefault, true);
      assert.equal(high.withoutEnlargementDefault, true);
    }
  });

  it('sharpFormatOptions differ between fast and high', () => {
    const fastJpeg = sharpFormatOptions('fast', 'jpeg');
    const highJpeg = sharpFormatOptions('high', 'jpeg');
    assert.notDeepEqual(fastJpeg, highJpeg);
    assert.ok((fastJpeg.quality as number) < (highJpeg.quality as number));
    assert.equal(highJpeg.mozjpeg, true);
    assert.equal(highJpeg.chromaSubsampling, '4:4:4');
    assert.equal(fastJpeg.chromaSubsampling, '4:2:0');

    const fastPng = sharpFormatOptions('fast', 'png');
    const highPng = sharpFormatOptions('high', 'png');
    assert.notDeepEqual(fastPng, highPng);
    assert.ok((fastPng.compressionLevel as number) < (highPng.compressionLevel as number));

    const fastWebp = sharpFormatOptions('fast', 'webp');
    const highWebp = sharpFormatOptions('high', 'webp');
    assert.notDeepEqual(fastWebp, highWebp);
    assert.ok((fastWebp.effort as number) < (highWebp.effort as number));
  });

  it('numeric quality overrides preset quality number only', () => {
    const opts = sharpFormatOptions('high', 'jpeg', 50);
    assert.equal(opts.quality, 50);
    assert.equal(opts.mozjpeg, true); // still high preset flags
    assert.equal(opts.chromaSubsampling, '4:4:4');
  });
});

describe('pdfCompressOptions preset differentiation', () => {
  it('fast options !== high options', () => {
    const fast = pdfCompressOptions('fast');
    const high = pdfCompressOptions('high');
    const balanced = pdfCompressOptions('balanced');

    assert.notDeepEqual(fast, high, 'fast and high PDF options must differ');
    assert.notDeepEqual(fast, balanced);
    // Structural-only always
    assert.equal(fast.structuralOnly, true);
    assert.equal(high.structuralOnly, true);
    assert.equal(balanced.structuralOnly, true);
    // Fast skips object streams for speed; balanced/high enable them
    assert.equal(fast.useObjectStreams, false);
    assert.equal(balanced.useObjectStreams, true);
    assert.equal(high.useObjectStreams, true);
    // objectsPerTick ladder: fast higher (fewer yields) than high
    assert.ok(fast.objectsPerTick > high.objectsPerTick);
  });
});

describe('QUALITY_PRESETS', () => {
  it('lists exactly fast, balanced, high', () => {
    assert.deepEqual([...QUALITY_PRESETS], ['fast', 'balanced', 'high']);
  });
});

describe('assertValidOutput', () => {
  it('accepts non-empty files and rejects missing/empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-quality-'));
    const ok = path.join(dir, 'ok.bin');
    const empty = path.join(dir, 'empty.bin');
    fs.writeFileSync(ok, Buffer.from([1, 2, 3]));
    fs.writeFileSync(empty, Buffer.alloc(0));

    assert.doesNotThrow(() => assertValidOutput(ok));
    assert.throws(() => assertValidOutput(empty), /empty file/);
    assert.throws(() => assertValidOutput(path.join(dir, 'missing.bin')), /does not exist/);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('validates expected extension (jpg/jpeg aliases)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-quality-ext-'));
    const jpg = path.join(dir, 'a.jpg');
    fs.writeFileSync(jpg, Buffer.from([1, 2, 3, 4]));
    assert.doesNotThrow(() => assertValidOutput(jpg, { expectedExt: '.jpeg' }));
    assert.throws(() => assertValidOutput(jpg, { expectedExt: '.png' }), /expected extension/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('videoEncodeSettings / audioEncodeSettings', () => {
  it('differentiates fast / balanced / high for video', () => {
    const fast = videoEncodeSettings('fast');
    const balanced = videoEncodeSettings('balanced');
    const high = videoEncodeSettings('high');

    assert.equal(fast.x264Preset, 'ultrafast');
    assert.equal(balanced.x264Preset, 'medium');
    assert.equal(high.x264Preset, 'slow');
    assert.ok(fast.crf > balanced.crf && balanced.crf > high.crf);
    assert.ok(fast.vp9Crf > high.vp9Crf);
    assert.equal(fast.pixelFormat, 'yuv420p');
    assert.equal(high.pixelFormat, 'yuv420p');
    assert.equal(fast.mp4MovFlags, '+faststart');
    assert.notEqual(fast.audioBitrate, high.audioBitrate);
  });

  it('differentiates audio sample rate / qscale / bitrate', () => {
    const fast = audioEncodeSettings('fast');
    const high = audioEncodeSettings('high');
    assert.ok(fast.mp3Qscale > high.mp3Qscale, 'lower mp3 qscale = higher quality');
    assert.equal(fast.channelLayout, 'stereo');
    assert.equal(high.channelLayout, 'stereo');
    assert.ok(Number.parseInt(fast.aacBitrate, 10) < Number.parseInt(high.aacBitrate, 10));
    assert.ok(fast.sampleRate <= high.sampleRate);
  });

  it('canStreamCopy only when codecs fit container', () => {
    assert.equal(
      canStreamCopy('mp4', [
        { type: 'video', codec: 'h264' },
        { type: 'audio', codec: 'aac' },
      ]),
      true,
    );
    assert.equal(canStreamCopy('mp4', [{ type: 'video', codec: 'vp9' }]), false);
    assert.equal(canStreamCopy('gif', [{ type: 'video', codec: 'gif' }]), false);
    assert.equal(canStreamCopy('webm', [{ type: 'video', codec: 'vp9' }, { type: 'audio', codec: 'opus' }]), true);
  });
});

describe('processImage quality presets', () => {
  it('applies fast vs high presets and produces non-empty outputs', async () => {
    const sharp = (await import('sharp')).default;
    const { processImage } = await import('../src/processors/image.js');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-img-q-'));
    const input = path.join(root, 'in.png');
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 40, g: 80, b: 160 } },
    })
      .png()
      .toFile(input);

    const mkCtx = (quality: string, outSub: string) => {
      const outputDir = path.join(root, outSub);
      fs.mkdirSync(outputDir, { recursive: true });
      return {
        jobId: `q-${quality}`,
        inputPaths: [input],
        inputNames: ['in.png'],
        options: { operation: 'convert', format: 'jpeg', quality },
        workDir: root,
        outputDir,
        onProgress: () => {},
        isCancelled: () => false,
      };
    };

    const fast = await processImage(mkCtx('fast', 'fast'));
    const high = await processImage(mkCtx('high', 'high'));
    const balanced = await processImage(mkCtx('balanced', 'balanced'));

    assert.equal(fast.meta?.qualityPreset, 'fast');
    assert.equal(high.meta?.qualityPreset, 'high');
    assert.equal(balanced.meta?.qualityPreset, 'balanced');
    assert.ok((fast.meta?.size as number) > 0);
    assert.ok((high.meta?.size as number) > 0);
    // High quality JPEG of solid color may be larger or similar; both valid
    assert.notEqual(fast.meta?.size, high.meta?.size);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
