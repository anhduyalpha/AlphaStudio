import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { test, expect } from './support/browser-audit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_URL = `http://127.0.0.1:${Number(process.env.E2E_SERVER_PORT || 18787)}`;
const DATA_DIR = path.resolve(
  process.env.ALPHASTUDIO_E2E_DATA_DIR
    || path.join(os.tmpdir(), 'alphastudio-e2e-direct'),
);
const RESTART_REQUEST = path.join(DATA_DIR, 'e2e-restart-request.json');
const RESTART_READY = path.join(DATA_DIR, 'e2e-restart-ready.json');
const CHUNK_ROUTE = '**/api/upload-sessions/*/chunks/*';

const PRODUCTION_ROUTES = [
  { hash: '#/', title: 'Home', ready: '.home-view' },
  { hash: '#/convert', title: 'Convert', ready: '.workbench' },
  { hash: '#/pdf', title: 'PDF', ready: '.workbench' },
  {
    hash: '#/media',
    expectedHash: '#/media?mode=video',
    title: 'Media Studio',
    ready: '.workbench',
  },
  {
    hash: '#/text',
    expectedHash: '#/text?mode=text',
    title: 'Text & Dev',
    ready: '.workbench',
  },
  {
    hash: '#/security',
    expectedHash: '#/security?mode=security',
    title: 'Security & Archive',
    ready: '.workbench',
  },
  { hash: '#/utilities', title: 'Utilities', ready: '.workbench' },
  { hash: '#/activity', title: 'Activity', ready: '.activity-view' },
  { hash: '#/settings', title: 'Settings', ready: '.settings-view' },
  { hash: '#/profile', title: 'Profile', ready: '.profile-view' },
];

const SIDEBAR_LINKS = [
  'Home',
  'Convert',
  'PDF',
  'Media Studio',
  'Text & Dev',
  'Security & Archive',
  'Utilities',
  'Activity',
  'Settings',
  'Profile',
];

function deterministicNoise(width, height, seed) {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  let value = seed >>> 0;
  for (let index = 0; index < pixels.length; index += 1) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    pixels[index] = value & 0xff;
  }
  return pixels;
}

async function createFixtures() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alphastudio-rebuild-fixtures-'));
  const corruptDir = path.join(root, 'corrupt');
  const repairedDir = path.join(root, 'repaired');
  await mkdir(corruptDir, { recursive: true });
  await mkdir(repairedDir, { recursive: true });

  const small = path.join(root, 'small-source.jpg');
  const large = path.join(root, 'large-source.png');
  const restart = path.join(root, 'restart-source.png');
  const motion = path.join(root, 'motion-source.png');
  const corrupt = path.join(corruptDir, 'broken-source.gif');
  const repaired = path.join(repairedDir, 'broken-source.gif');
  await copyFile(path.join(ROOT, 'fixtures', 'converter', 'sample.jpg'), small);

  await sharp(deterministicNoise(2300, 2300, 0x12345678), {
    raw: { width: 2300, height: 2300, channels: 3 },
  })
    .png({ compressionLevel: 0, adaptiveFiltering: false })
    .toFile(large);
  await sharp(deterministicNoise(1700, 1700, 0x87654321), {
    raw: { width: 1700, height: 1700, channels: 3 },
  })
    .png({ compressionLevel: 0, adaptiveFiltering: false })
    .toFile(restart);
  await sharp(deterministicNoise(3600, 3600, 0x31415926), {
    raw: { width: 3600, height: 3600, channels: 3 },
  })
    .png({ compressionLevel: 0, adaptiveFiltering: false })
    .toFile(motion);

  const gif = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    'base64',
  );
  await writeFile(corrupt, gif.subarray(0, 12));
  await writeFile(repaired, gif);

  expect((await stat(large)).size).toBeGreaterThan(8 * 1024 * 1024);
  return { root, small, large, restart, motion, corrupt, repaired };
}

async function setHash(page, hash) {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash;
  }, hash);
}

async function expectHash(page, hash) {
  await expect.poll(
    () => page.evaluate(() => window.location.hash),
    { timeout: 20_000 },
  ).toBe(hash);
}

async function visitRoute(page, route) {
  await setHash(page, route.hash);
  await expectHash(page, route.expectedHash || route.hash);
  await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible();
  await expect(page.locator(`main ${route.ready}`)).toBeVisible();
  await expect(page.locator('main .skeleton-wrap')).toHaveCount(0);
  await expect(page.locator('main > .error-state')).toHaveCount(0);
  await expect(page.locator('main h2').first()).toBeVisible();
}

function inputRow(page, name) {
  return page.locator('.workbench__input .file-row').filter({ hasText: name });
}

async function waitForInputReady(page, name, timeout = 120_000) {
  const row = inputRow(page, name);
  const ready = row.filter({
    has: page.locator('.file-row__state', { hasText: /^Ready$/ }),
  });
  await expect(ready).toHaveCount(1, { timeout });
  await expect(row).toHaveCount(1, { timeout });
  return row;
}

function groupFor(page, name) {
  return page.locator('.conversion-group').filter({ hasText: name });
}

async function configureGroup(group, { target, quality }) {
  await expect(group).toHaveCount(1);
  if (target) {
    const values = await group.getByLabel('Target').locator('option').evaluateAll(
      (options) => options.map((option) => option.value),
    );
    expect(values).toContain(target);
    await group.getByLabel('Target').selectOption(target);
  }
  if (quality) await group.getByLabel('Quality').selectOption(quality);
}

function resultFor(page, name) {
  return page.locator('.workbench__results [data-job-id]').filter({ hasText: name });
}

async function progressValue(row) {
  const progress = row.getByRole('progressbar');
  await expect(progress).toBeVisible();
  return Number(await progress.getAttribute('aria-valuenow'));
}

async function workspaceId(page) {
  return page.evaluate(() => localStorage.getItem('alphastudio-workspace-id'));
}

async function workspaceSnapshot(page, id) {
  const response = await page.request.get(`${SERVER_URL}/api/workspaces/${encodeURIComponent(id)}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

function uploadIds(job) {
  return [...(job?.options?._uploadIds || job?.options?.uploadIds || [])]
    .map(String)
    .sort();
}

async function waitForJobStatus(page, id, predicate, timeout = 180_000) {
  let latest = null;
  await expect.poll(async () => {
    latest = await workspaceSnapshot(page, id);
    return predicate(latest.jobs.map((job) => job.status));
  }, { timeout }).toBe(true);
  return latest;
}

function isWellFormedZip(bytes) {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  const tail = bytes.subarray(Math.max(0, bytes.length - 65_557));
  return tail.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0;
}

function isKnownArtifact(bytes) {
  if (isWellFormedZip(bytes)) return true;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return true;
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return true;
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') return true;
  if (bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')) return true;
  return false;
}

test('the rebuilt production client completes the full acceptance journey', async ({
  page,
  browserAudit,
}, testInfo) => {
  test.setTimeout(720_000);
  browserAudit.allowRequestFailure(/\/api\/upload-sessions\/[^/]+\/chunks\/\d+/);
  browserAudit.allowRequestFailure(/\/api\/workspaces\/[^/]+\/events(?:\?|$)/);

  const fixtures = await createFixtures();
  const jobCreateRequests = [];
  const jobCreateResponses = [];
  const workspaceEventRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/events') && url.pathname.includes('/api/workspaces/')) {
      workspaceEventRequests.push(request.url());
    }
    if (request.method() !== 'POST' || url.pathname !== '/api/jobs') return;
    try {
      jobCreateRequests.push(request.postDataJSON());
    } catch {
      jobCreateRequests.push(null);
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    const url = new URL(response.url());
    if (request.method() !== 'POST' || url.pathname !== '/api/jobs') return;
    void response.json().then((body) => jobCreateResponses.push(body));
  });

  await page.addInitScript(() => {
    localStorage.setItem('alpha-studio-theme', 'dark');
    localStorage.setItem('alpha-studio-motion', 'balanced');
  });

  try {
    // 1. Cold start: Home plus the complete 6-hub/account navigation.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(page.locator('.home-view')).toBeVisible();
    const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
    for (const label of SIDEBAR_LINKS) {
      await expect(sidebar.getByRole('link', { name: label, exact: true })).toHaveCount(1);
    }
    await expect(page.locator('.home-launcher')).toHaveCount(6);

    // 2. Every production route in dark and light; dev-only assets fail closed to Home.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    for (const route of PRODUCTION_ROUTES) await visitRoute(page, route);
    await page.getByRole('button', { name: 'Use light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    for (const route of PRODUCTION_ROUTES) await visitRoute(page, route);
    await setHash(page, '#/assets');
    await expectHash(page, '#/');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

    // 3. Legacy route mappings preserve both destination hub and mode.
    const redirects = [
      ['#/converter', '#/convert', 'Convert', 'Batch conversion'],
      ['#/image', '#/media?mode=image', 'Media Studio', 'Image'],
      ['#/developer', '#/text?mode=dev', 'Text & Dev', 'Developer tools'],
      ['#/qr', '#/utilities?mode=qr', 'Utilities', 'QR'],
    ];
    for (const [legacy, destination, title, mode] of redirects) {
      await setHash(page, legacy);
      await expectHash(page, destination);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole('tab', { name: mode })).toHaveAttribute('aria-selected', 'true');
    }

    // 4. Multipart + resumable upload, pause, reload, ResumeStrip resume.
    await setHash(page, '#/convert');
    await expectHash(page, '#/convert');
    await expect(page.getByRole('heading', { level: 1, name: 'Convert' })).toBeVisible();
    let chunkCount = 0;
    let sawSecondChunk;
    const secondChunkStarted = new Promise((resolve) => {
      sawSecondChunk = resolve;
    });
    await page.route(CHUNK_ROUTE, async (route) => {
      chunkCount += 1;
      if (chunkCount >= 2) {
        sawSecondChunk();
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      try {
        await route.continue();
      } catch {
        // Pause/reload is expected to dispose the in-flight chunk route.
      }
    });
    const input = page.locator('.workbench__input .dropzone__input');
    await input.setInputFiles([fixtures.small, fixtures.large]);
    await secondChunkStarted;
    const uploadingLarge = inputRow(page, 'large-source.png');
    await uploadingLarge.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('region', { name: 'Resumable uploads' })).toContainText(
      'large-source.png',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Convert' })).toBeVisible();
    const resumeStrip = page.getByRole('region', { name: 'Resumable uploads' });
    await expect(resumeStrip).toContainText('large-source.png');
    await page.unroute(CHUNK_ROUTE);
    const chooserPromise = page.waitForEvent('filechooser');
    await resumeStrip.getByRole('button', { name: 'Resume' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixtures.large);
    await waitForInputReady(page, 'small-source.jpg');
    await waitForInputReady(page, 'large-source.png');
    await expect(resumeStrip).toHaveCount(0);

    // 5–6. Two good groups + one accepted/truncated group; reload a live conversion.
    await input.setInputFiles(fixtures.corrupt);
    await waitForInputReady(page, 'broken-source.gif');
    const pngGroup = groupFor(page, 'large-source.png');
    await configureGroup(pngGroup, { target: 'gif', quality: 'high' });
    await page.locator('.run-bar').getByRole('button', { name: 'Convert all' }).click();
    const pngAttempt = resultFor(page, 'large-source.png').first();
    await expect(pngAttempt).toBeVisible({ timeout: 120_000 });
    await expect.poll(() => progressValue(pngAttempt), { timeout: 120_000 }).toBeGreaterThan(0);
    const beforeReload = await progressValue(pngAttempt);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Convert' })).toBeVisible();
    const reattached = resultFor(page, 'large-source.png').first();
    await expect(reattached).toBeVisible();
    const afterReload = await (async () => {
      const state = (await reattached.locator('.file-row__state').textContent()) || '';
      return state.includes('Completed') ? 100 : progressValue(reattached);
    })();
    expect(afterReload).toBeGreaterThanOrEqual(beforeReload);

    const id = await workspaceId(page);
    expect(id).toBeTruthy();
    let snapshot = await waitForJobStatus(
      page,
      id,
      (statuses) => statuses.filter((status) => status === 'completed').length >= 2
        && statuses.filter((status) => status === 'failed').length >= 1,
    );
    await expect(
      page.locator('.workbench__results .file-row').filter({ hasText: 'Completed' }),
    ).toHaveCount(2);
    const corruptError = resultFor(page, 'broken-source.gif').filter({
      has: page.locator('.error-state'),
    });
    await expect(corruptError).toHaveCount(1);
    await expect(corruptError.getByRole('alert')).toBeVisible();
    await expect(corruptError.getByRole('button', { name: 'Retry' })).toBeVisible();

    // 7. Retry is a new zero-progress attempt over the same upload, then repair it.
    const firstFailed = snapshot.jobs.find(
      (job) => job.status === 'failed' && uploadIds(job).length === 1,
    );
    expect(firstFailed).toBeTruthy();
    const retryResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/jobs'
    ));
    await corruptError.getByRole('button', { name: 'Retry' }).click();
    const retryCreated = await (await retryResponsePromise).json();
    expect(retryCreated.id).not.toBe(firstFailed.id);
    expect(retryCreated.status).toBe('queued');
    expect(retryCreated.progress).toBe(0);
    snapshot = await waitForJobStatus(
      page,
      id,
      (statuses) => statuses.filter((status) => status === 'failed').length >= 2,
    );
    const retriedFailure = snapshot.jobs.find((job) => job.id === retryCreated.id);
    expect(uploadIds(retriedFailure)).toEqual(uploadIds(firstFailed));
    const repeatedErrors = resultFor(page, 'broken-source.gif').filter({
      has: page.locator('.error-state'),
    });
    await expect(repeatedErrors).toHaveCount(2);
    await expect(repeatedErrors.first().getByRole('button', { name: 'Retry' })).toBeVisible();
    await repeatedErrors.first().getByRole('button', { name: 'Remove bad input' }).click();
    await expect(resultFor(page, 'broken-source.gif')).toHaveCount(0);
    await expect(inputRow(page, 'broken-source.gif')).toHaveCount(0);

    await input.setInputFiles(fixtures.repaired);
    await waitForInputReady(page, 'broken-source.gif');
    const repairedGroup = groupFor(page, 'broken-source.gif');
    await repairedGroup.getByRole('button', { name: 'Convert group' }).click();
    const repairedResult = resultFor(page, 'broken-source.gif').first();
    await expect(repairedResult.locator('.file-row__state')).toHaveText('Completed', {
      timeout: 180_000,
    });

    // 8. One output plus the workspace batch ZIP are real downloadable artifacts.
    const singleRow = resultFor(page, 'small-source.jpg').first();
    const singleDownloadPromise = page.waitForEvent('download');
    await singleRow.getByRole('button', { name: 'Download' }).click();
    const singleDownload = await singleDownloadPromise;
    expect(await singleDownload.failure()).toBeNull();
    const singlePath = path.join(fixtures.root, singleDownload.suggestedFilename());
    await singleDownload.saveAs(singlePath);
    const singleBytes = await readFile(singlePath);
    expect(singleBytes.length).toBeGreaterThan(0);
    expect(isKnownArtifact(singleBytes)).toBe(true);

    const zipDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download all' }).click();
    const zipDownload = await zipDownloadPromise;
    expect(await zipDownload.failure()).toBeNull();
    const zipPath = path.join(fixtures.root, 'alphastudio-outputs.zip');
    await zipDownload.saveAs(zipPath);
    const zipBytes = await readFile(zipPath);
    expect(zipBytes.length).toBeGreaterThan(22);
    expect(isWellFormedZip(zipBytes)).toBe(true);

    // 9. Kill/relaunch Fastify while its workspace SSE and a job are live.
    await input.setInputFiles(fixtures.restart);
    await waitForInputReady(page, 'restart-source.png');
    const restartGroup = groupFor(page, 'restart-source.png');
    await configureGroup(restartGroup, { target: 'gif', quality: 'high' });
    await restartGroup.getByRole('button', { name: 'Convert group' }).click();
    const interruptedRow = resultFor(page, 'restart-source.png').first();
    await expect.poll(() => progressValue(interruptedRow), { timeout: 120_000 }).toBeGreaterThan(0);
    const beforeRestartProgress = await progressValue(interruptedRow);
    const epochBefore = (await workspaceSnapshot(page, id)).epoch;
    const eventConnectionsBefore = workspaceEventRequests.length;
    const restartToken = randomUUID();
    await writeFile(RESTART_REQUEST, JSON.stringify({ token: restartToken }), 'utf8');
    await expect.poll(async () => {
      try {
        return JSON.parse(await readFile(RESTART_READY, 'utf8')).token;
      } catch {
        return '';
      }
    }, { timeout: 120_000 }).toBe(restartToken);
    snapshot = await workspaceSnapshot(page, id);
    expect(snapshot.epoch).not.toBe(epochBefore);
    const interruptedJob = snapshot.jobs
      .filter((job) => uploadIds(job).length > 1 && job.status === 'failed')
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    expect(interruptedJob).toBeTruthy();
    expect(interruptedJob.progress).toBeGreaterThanOrEqual(beforeRestartProgress);
    await expect.poll(() => workspaceEventRequests.length, { timeout: 30_000 })
      .toBeGreaterThan(eventConnectionsBefore);
    const interruptedError = resultFor(page, 'restart-source.png').filter({
      has: page.locator('.error-state'),
    }).first();
    await expect(interruptedError).toBeVisible({ timeout: 30_000 });
    const postRestartResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/jobs'
    ));
    await interruptedError.getByRole('button', { name: 'Retry' }).click();
    const postRestartJob = await (await postRestartResponsePromise).json();
    expect(postRestartJob.id).not.toBe(interruptedJob.id);
    await expect(
      page.locator(`.workbench__results [data-job-id="${postRestartJob.id}"] .file-row__state`),
    ).toHaveText('Completed', { timeout: 240_000 });
    const renderedJobIds = await page.locator('.workbench__results [data-job-id]').evaluateAll(
      (nodes) => nodes.map((node) => node.dataset.jobId),
    );
    expect(new Set(renderedJobIds).size).toBe(renderedJobIds.length);
    snapshot = await workspaceSnapshot(page, id);
    expect(snapshot.jobs.filter((job) => ['queued', 'running'].includes(job.status))).toEqual([]);

    // 10. Reduced motion keeps queued progress static while state still advances.
    await page.evaluate(() => {
      localStorage.setItem('alpha-studio-motion', 'reduced');
      document.documentElement.dataset.motion = 'reduced';
    });
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await input.setInputFiles(fixtures.motion);
    await waitForInputReady(page, 'motion-source.png', 180_000);
    await configureGroup(restartGroup, { target: 'gif', quality: 'balanced' });
    const firstReducedJobRequest = page.waitForRequest((request) => (
      request.method() === 'POST'
      && new URL(request.url()).pathname === '/api/jobs'
    ));
    await restartGroup.getByRole('button', { name: 'Convert group' }).click();
    await firstReducedJobRequest;
    const jpegGroup = groupFor(page, 'small-source.jpg');
    await configureGroup(jpegGroup, { quality: 'high' });
    await jpegGroup.getByRole('button', { name: 'Convert group' }).click();
    const staticBusy = page.locator('.run-bar .progress-bar--indeterminate');
    await expect(staticBusy).toBeVisible({ timeout: 30_000 });
    const staticFill = staticBusy.locator('.progress-bar__fill');
    const staticStyle = await staticFill.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationName: style.animationName,
        backgroundImage: style.backgroundImage,
        width: element.getBoundingClientRect().width,
      };
    });
    expect(staticStyle.animationName).toBe('none');
    expect(staticStyle.backgroundImage).toContain('repeating-linear-gradient');
    expect(staticStyle.width).toBeGreaterThan(0);
    await expect.poll(
      () => staticFill.evaluate((element) => getComputedStyle(element).transform),
      { timeout: 2_000 },
    ).toBe('none');
    await expect(
      page.locator('.workbench__results .file-row__state').filter({ hasText: /Queued|Converting/ }),
    ).not.toHaveCount(0);
    await waitForJobStatus(
      page,
      id,
      (statuses) => statuses.every((status) => !['queued', 'running'].includes(status)),
      300_000,
    );
    await expect(page.locator('.run-bar')).not.toHaveAttribute('aria-busy', 'true');

    // 11. Command palette search lands on Media Studio → Audio.
    await page.getByRole('button', { name: 'Search tools and modes' }).click();
    const palette = page.getByRole('dialog', { name: 'Search AlphaStudio' });
    await palette.getByRole('searchbox').fill('audio');
    const audioOption = palette.getByRole('option').filter({ hasText: 'Audio' });
    await expect(audioOption).toHaveCount(1);
    await audioOption.click();
    await expectHash(page, '#/media?mode=audio');
    await expect(page.getByRole('heading', { level: 1, name: 'Media Studio' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Audio' })).toHaveAttribute('aria-selected', 'true');

    // 12. Explicit whole-journey audit plus durable visual evidence.
    const unexpectedRequestFailures = browserAudit.requestFailures.filter((failure) => {
      if (/\/api\/jobs\/[^/]+\/events(?:\?|$)/.test(failure.url)) return false;
      return !browserAudit.allowedRequestFailures.some((pattern) => pattern.test(failure.url));
    });
    const unexpectedConsoleErrors = browserAudit.consoleErrors.filter((entry) => {
      if (!/^Failed to load resource: net::ERR_/i.test(entry.text)) return true;
      const url = entry.location?.url || '';
      return !browserAudit.allowedRequestFailures.some((pattern) => pattern.test(url));
    });
    expect(unexpectedConsoleErrors).toEqual([]);
    expect(browserAudit.pageErrors).toEqual([]);
    expect(unexpectedRequestFailures).toEqual([]);
    expect(browserAudit.httpFailures).toEqual([]);
    expect(jobCreateRequests.filter(Boolean).length).toBeGreaterThanOrEqual(9);
    expect(jobCreateResponses.length).toBeGreaterThanOrEqual(9);
    await page.screenshot({
      path: path.join(ROOT, 'evidence', 'unit-27-journey.png'),
      fullPage: false,
    });
    await testInfo.attach('unit-27-final-state.png', {
      path: path.join(ROOT, 'evidence', 'unit-27-journey.png'),
      contentType: 'image/png',
    });
  } finally {
    await page.close({ runBeforeUnload: false });
    await rm(fixtures.root, { recursive: true, force: true });
  }
});
