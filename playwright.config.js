import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const clientPort = Number(process.env.E2E_CLIENT_PORT || 15173);
const serverPort = Number(process.env.E2E_SERVER_PORT || 18787);
const clientUrl = `http://127.0.0.1:${clientPort}`;
const serverUrl = `http://127.0.0.1:${serverPort}`;
const dataDir = path.resolve(
  process.env.ALPHASTUDIO_E2E_DATA_DIR || path.join(os.tmpdir(), 'alphastudio-e2e-direct'),
);

export default defineConfig({
  testDir: './e2e',
  outputDir: path.join(dataDir, 'playwright-results'),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: clientUrl,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --import tsx server/src/index.ts',
      url: `${serverUrl}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(serverPort),
        CORS_ORIGIN: clientUrl,
        SERVE_FRONTEND: '0',
        DATA_DIR: dataDir,
        DB_PATH: path.join(dataDir, 'alphastudio-e2e.db'),
        WORKER_POOL_SIZE: '1',
        PDF_WORKER_CONCURRENCY: '1',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'node scripts/test/start-e2e-client.mjs',
      url: clientUrl,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        VITE_API_URL: serverUrl,
        E2E_CLIENT_PORT: String(clientPort),
      },
    },
  ],
});
