import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './support/browser-audit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => path.join(root, 'fixtures', 'pdf', name);

async function openPdfStudio(page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByRole('button', { name: 'PDF Studio', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'PDF Studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Document workspace' })).toBeVisible();
}

async function choosePdf(page, name) {
  await page.locator('.file-picker-block input[type="file"]').setInputFiles(fixture(name));
  await expect(page.getByText(name, { exact: false })).toBeVisible();
}

/** Prefer the select control — workbench rail aria-label also contains "operation". */
function operationSelect(page) {
  return page.locator('select#field-operation, select[name="operation"]').first();
}

function categorySelect(page) {
  // Prefer legacy select if present; otherwise segmented control tab buttons.
  const select = page.locator('select#field-category, select[name="category"]').first();
  return select;
}

async function selectPdfGroup(page, groupLabel) {
  const select = page.locator('select#field-category, select[name="category"]');
  if (await select.count()) {
    await select.first().selectOption({ label: groupLabel }).catch(async () => {
      await select.first().selectOption(groupLabel.toLowerCase());
    });
    return;
  }
  await page.getByRole('tab', { name: groupLabel, exact: true }).click();
}

test.describe.serial('PDF Studio browser baseline', () => {
  test('loads the bundled preview worker, renders bounded thumbnails, and replaces files safely', async ({ page, browserAudit }) => {
    await openPdfStudio(page);
    await operationSelect(page).selectOption('reorder');
    await choosePdf(page, 'organizer-8-pages.pdf');

    await page.getByRole('tab', { name: 'Preview' }).click();
    const organizer = page.locator('[data-pdf-organizer="true"]');
    await expect(organizer.getByRole('heading', { name: '8 pages' })).toBeVisible();
    await expect(organizer.locator('img')).toHaveCount(8);
    expect(browserAudit.workerRequests.length).toBeGreaterThan(0);
    expect(browserAudit.workerRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBeTruthy();

    await page.locator('.file-picker-block input[type="file"]').setInputFiles(fixture('unicode-ภาษาไทย-报告.pdf'));
    await expect(organizer.getByRole('heading', { name: '2 pages' })).toBeVisible();
    await expect(organizer.locator('img')).toHaveCount(2);
    await expect(organizer.getByRole('button', { name: 'Page 1', exact: true })).toBeDisabled();
    await expect(organizer.getByRole('button', { name: 'Move page 1 later', exact: true })).toBeEnabled();

    await page.locator('.file-picker-block input[type="file"]').setInputFiles(fixture('large-205-pages.pdf'));
    await expect(organizer.getByText(/205 pages \(limit 200\)/)).toBeVisible();
    await expect(organizer.getByText(/Backend processing is still available/)).toBeVisible();
    await expect(organizer.locator('img')).toHaveCount(0);
  });

  test('cancels a delayed upload without creating a late backend job', async ({ page, browserAudit }) => {
    browserAudit.allowRequestFailure(/\/api\/uploads(?:\?|$)/);
    let uploadIntercepted;
    const sawUpload = new Promise((resolve) => { uploadIntercepted = resolve; });
    const createdJobs = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/jobs$/.test(request.url())) createdJobs.push(request.url());
    });
    await page.route('**/api/uploads*', async (route) => {
      uploadIntercepted();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      try {
        await route.continue();
      } catch {
        // The expected AbortController/XHR cancellation can dispose the intercepted route.
      }
    });

    await openPdfStudio(page);
    await selectPdfGroup(page, 'Analyze');
    await choosePdf(page, 'text-basic.pdf');
    await page.getByRole('button', { name: 'Run PDF operation' }).click();
    await sawUpload;
    await page.getByTestId('workbench-layout').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(1_500);
    expect(createdJobs).toEqual([]);
  });

  test('submits one idempotent payload, restores its completed result, and deletes it', async ({ page, browserAudit }) => {
    await openPdfStudio(page);
    await selectPdfGroup(page, 'Analyze');
    await expect(operationSelect(page)).toHaveValue('inspect');
    await choosePdf(page, 'quarterly.report.final.v1.pdf');

    const createRequestPromise = page.waitForRequest(
      (request) => request.method() === 'POST' && /\/api\/jobs$/.test(request.url()),
    );
    await page.getByRole('button', { name: 'Run PDF operation' }).click();
    const createRequest = await createRequestPromise;
    const payload = createRequest.postDataJSON();
    expect(payload.type).toBe('pdf');
    expect(payload.options.operation).toBe('inspect');
    expect(payload.clientRequestId).toMatch(/^[0-9a-f-]{20,}$/i);
    expect(createRequest.headers()['content-type']).toContain('application/json');

    const result = page.locator('.job-output-card');
    await expect(result.getByText('completed', { exact: true })).toBeVisible({ timeout: 30_000 });
    const outputName = await result.locator('.file-info strong').innerText();
    expect(outputName).toMatch(/inspection\.json$/);
    expect(
      browserAudit.requests.some((request) => /\/api\/jobs\/[^/]+(?:\/events)?$/.test(request.url)),
      'SSE or polling progress request was captured',
    ).toBeTruthy();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Document workspace' })).toBeVisible();
    await expect(page.locator('.job-output-card .file-info strong')).toHaveText(outputName, { timeout: 15_000 });

    const deleteResponse = page.waitForResponse(
      (response) => response.request().method() === 'DELETE' && /\/api\/jobs\/[^/]+$/.test(response.url()),
    );
    await page.locator('.job-output-card').getByRole('button', { name: 'Delete' }).click();
    expect((await deleteResponse).status()).toBe(200);
    await expect(page.locator('.job-output-card')).toHaveCount(0);
  });

  test('keeps the PDF workspace usable at desktop, tablet, and mobile widths', async ({ page }) => {
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'tablet', width: 820, height: 1024 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/#/pdf', { waitUntil: 'commit' });
      await expect(page.getByRole('heading', { name: 'Document workspace' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Workspace' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${viewport.name} horizontal overflow`).toBeLessThanOrEqual(1);
      if (viewport.width < 900) await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    }
  });
});
