import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E configuration.
 *
 * Default mode is fully offline: specs install page.route() handlers for the
 * browser's `/api/v1` calls, so no database, Redis or API process is required.
 * Set `RUN_E2E_TESTS=1` to opt into live mode; see `e2e/support/api.ts` for the
 * credential and seeded-data expectations of that mode.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm --filter @examnexus/web dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
