/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL =
  process.env.BASE_URL ||
  'https://service-3-little-worms-167345356687.us-west2.run.app';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    // Give the 3-D canvas time to paint before assertions
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
