import { expect, test as base } from '@playwright/test';

const interestingApi = /\/api\/(?:activity|capabilities|jobs|uploads)(?:\/|\?|$)/;

export const test = base.extend({
  browserAudit: async ({ page }, use, testInfo) => {
    const audit = {
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
      httpFailures: [],
      requests: [],
      workerRequests: [],
      allowedRequestFailures: [],
      allowRequestFailure(pattern) {
        this.allowedRequestFailures.push(pattern);
      },
    };

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      audit.consoleErrors.push({ text: message.text(), location: message.location() });
    });
    page.on('pageerror', (error) => {
      audit.pageErrors.push({ name: error.name, message: error.message, stack: error.stack });
    });
    page.on('request', (request) => {
      if (/pdf\.worker\.min/i.test(request.url())) audit.workerRequests.push(request.url());
      if (!interestingApi.test(request.url())) return;
      const contentType = request.headers()['content-type'] || '';
      audit.requests.push({
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        payload: contentType.includes('application/json') ? request.postData() : null,
      });
    });
    page.on('requestfailed', (request) => {
      audit.requestFailures.push({
        method: request.method(),
        url: request.url(),
        error: request.failure()?.errorText || 'unknown request failure',
      });
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      audit.httpFailures.push({ status: response.status(), url: response.url() });
    });

    await use(audit);

    await testInfo.attach('browser-network-audit.json', {
      body: Buffer.from(JSON.stringify(audit, (key, value) => (key === 'allowedRequestFailures' ? undefined : value), 2)),
      contentType: 'application/json',
    });

    const unexpectedRequestFailures = audit.requestFailures.filter((failure) => {
      if (/\/api\/jobs\/[^/]+\/events(?:\?|$)/.test(failure.url)) return false;
      return !audit.allowedRequestFailures.some((pattern) => pattern.test(failure.url));
    });
    expect.soft(audit.consoleErrors, 'browser console errors').toEqual([]);
    expect.soft(audit.pageErrors, 'uncaught page errors').toEqual([]);
    expect.soft(unexpectedRequestFailures, 'unexpected failed requests').toEqual([]);
    expect.soft(audit.httpFailures, 'unexpected HTTP error responses').toEqual([]);
  },
});

export { expect } from '@playwright/test';
