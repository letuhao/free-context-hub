import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // Authenticate once against the hardened (auth-ON) stack; every spec inherits the session.
  globalSetup: './global-setup.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../../docs/qc/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.GUI_URL ?? 'http://localhost:3002',
    storageState: 'test/e2e/gui/.auth/state.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
