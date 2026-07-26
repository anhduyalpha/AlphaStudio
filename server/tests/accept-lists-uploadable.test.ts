/**
 * S2 (SPEC §3.5) — the published contract must not over-promise.
 *
 * `convert/formats.ts` knows more formats than `POST /api/uploads` will accept:
 * the upload path gates on its own allowlist in `security/validation.ts`
 * (`EXT_MIME` union `TEXT_EXTS`), which has never included `.mobi`, `.azw`,
 * `.fb2`, `.htmlz`, `.rst`, `.adoc`, `.asciidoc` or `.parquet`. A client that
 * builds a file filter from a published list must therefore read `uploadable`,
 * not `extensions` — otherwise it offers the user a file the very next request
 * rejects, which is the queue-then-fail dishonesty §3.5 exists to remove.
 *
 * `uploadable` is marked in the one format table, so this test pins that
 * marking against the real allowlist — parsed from source — in BOTH directions.
 * Widen `security/validation.ts` and this fails until the table agrees; mark a
 * format uploadable that the endpoint refuses and it fails too.
 *
 * Also pins the two things the A3 spec review found unpinned: the job-type
 * accept rules against the real processor list, and the strictness of the
 * EXT_FAMILY source parser used by the sibling drift test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptListIdForJob,
  isFilenameAccepted,
  publishedAcceptLists,
} from '../src/convert/formats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(serverRoot, 'src', rel), 'utf8');
}

/** The extensions `validateStoredFileQuick` will let through, from source. */
function uploadableExtensions(): Set<string> {
  const src = readSrc('security/validation.ts');
  const extMimeStart = src.indexOf('const EXT_MIME');
  assert.ok(extMimeStart >= 0, 'EXT_MIME allowlist present in security/validation.ts');
  const extMimeBlock = src.slice(extMimeStart, src.indexOf('\n};', extMimeStart));
  const exts = [...extMimeBlock.matchAll(/'(\.[a-z0-9]+)':/g)].map((m) => m[1]);
  assert.ok(exts.length >= 50, `parsed ${exts.length} EXT_MIME entries`);

  const textStart = src.indexOf('const TEXT_EXTS');
  assert.ok(textStart >= 0, 'TEXT_EXTS present in security/validation.ts');
  const textBlock = src.slice(textStart, src.indexOf(']);', textStart));
  const textExts = [...textBlock.matchAll(/'(\.[a-z0-9]+)'/g)].map((m) => m[1]);
  assert.ok(textExts.length >= 5, `parsed ${textExts.length} TEXT_EXTS entries`);

  return new Set([...exts, ...textExts]);
}

describe('S2 published lists never over-promise what can be uploaded', () => {
  it('publishes `uploadable` as exactly the uploadable slice of each list', () => {
    const allowed = uploadableExtensions();
    const { lists } = publishedAcceptLists();
    const wrong: string[] = [];
    for (const [id, list] of Object.entries(lists)) {
      assert.ok(Array.isArray(list.uploadable), `${id}: uploadable published`);
      const expected = list.extensions.filter((ext) => allowed.has(ext)).sort();
      const actual = [...list.uploadable].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        wrong.push(
          `${id}: published [${actual.join(', ')}] but the upload endpoint accepts [${expected.join(', ')}]`,
        );
      }
    }
    assert.deepEqual(wrong, [], `uploadable drift:\n  ${wrong.join('\n  ')}`);
  });

  it('never publishes an uploadable extension the upload endpoint would refuse', () => {
    const allowed = uploadableExtensions();
    const overPromised: string[] = [];
    for (const [id, list] of Object.entries(publishedAcceptLists().lists)) {
      for (const ext of list.uploadable) {
        if (!allowed.has(ext)) overPromised.push(`${id}: ${ext}`);
      }
    }
    assert.deepEqual(
      overPromised,
      [],
      `published as uploadable but refused on upload:\n  ${overPromised.join('\n  ')}`,
    );
  });

  it('still leaves every list with something to offer', () => {
    for (const [id, list] of Object.entries(publishedAcceptLists().lists)) {
      assert.ok(list.uploadable.length > 0, `${id}: at least one uploadable extension`);
    }
  });
});

describe('S2 job accept rules stay pinned to the real processors', () => {
  it('every job type with a processor has an accept rule', () => {
    const src = readSrc('processors/index.ts');
    const start = src.indexOf('const processorLoaders');
    assert.ok(start >= 0, 'processorLoaders present');
    const block = src.slice(start, src.indexOf('\n};', start));
    const types = [...block.matchAll(/^ {2}([a-z]+):\s*async/gm)].map((m) => m[1]);
    assert.ok(types.length >= 9, `parsed ${types.length} processor types`);
    const { jobTypes } = publishedAcceptLists();
    const missing = types.filter((t) => !Object.prototype.hasOwnProperty.call(jobTypes, t));
    assert.deepEqual(
      missing,
      [],
      `job types with a processor but no published accept rule (they would silently be unrestricted):\n  ${missing.join('\n  ')}`,
    );
  });

  it('keeps the media and audio inputs the shipped client already allows', () => {
    // FilePicker does not filter drops against `accept`, so these reach the
    // server today and ffmpeg handles them. The gate must not narrow them.
    assert.ok(
      isFilenameAccepted(acceptListIdForJob('media', 'transcode'), 'animation.gif'),
      'media:transcode still accepts an animated GIF',
    );
    assert.ok(
      isFilenameAccepted(acceptListIdForJob('audio', 'convert'), 'clip.mp4'),
      'audio:convert still accepts a video container (audio is extracted)',
    );
    assert.ok(
      !isFilenameAccepted(acceptListIdForJob('media', 'transcode'), 'notes.txt'),
      'media:transcode still refuses a text file',
    );
  });

  it('gates archive inspection the same way as extraction', () => {
    assert.equal(acceptListIdForJob('archive', 'inspect'), 'archive');
    assert.equal(acceptListIdForJob('archive', 'extract'), 'archive');
    assert.equal(acceptListIdForJob('archive', 'create'), null, 'creating packs arbitrary files');
  });
});

describe('S2 drift parser is strict', () => {
  it('the EXT_FAMILY row parser matches every key in the table', () => {
    const src = readSrc('convert/detect.ts');
    const start = src.indexOf('const EXT_FAMILY');
    const block = src.slice(start, src.indexOf('\n};', start));
    const keys = [...block.matchAll(/'(\.[a-z0-9]+)':/g)].map((m) => m[1]);
    const rows = [
      ...block.matchAll(
        /'(\.[a-z0-9]+)':\s*\{\s*family:\s*'([a-z]+)',\s*format:\s*'([a-z0-9]+)'\s*\}/g,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(
      rows,
      keys,
      'the single-line regex used by the drift test must see every EXT_FAMILY entry — ' +
        'a reformatted (multi-line) entry would otherwise skip drift checking',
    );
  });
});
