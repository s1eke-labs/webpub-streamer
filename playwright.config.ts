import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  timeout: 90_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
  },
  webServer: {
    command: 'vite --host 127.0.0.1 --config tests/harness/vite.config.ts',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
