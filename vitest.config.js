import { defineConfig } from 'vitest/config';

// Client test harness (PLAN A1, SPEC §7.2). Runs only client tests under src/;
// the server suite stays on node:test (`npm test`) and e2e stays on Playwright.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    environment: 'node',
  },
});
