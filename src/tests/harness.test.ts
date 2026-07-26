import { describe, expect, it } from 'vitest';

// A1 harness sanity test (PLAN: "trivially green"). Real client suites land
// with their units (B2/B3/B4 protocol, hub config validation, structural).
describe('client test harness', () => {
  it('executes TypeScript tests under src/', () => {
    expect(1 + 1).toBe(2);
  });
});
