import { defineConfig } from '@playwright/test';

// Browser: run `npx playwright install chromium` once, or set PW_CHANNEL=chrome to use installed Google Chrome.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel: process.env.PW_CHANNEL || undefined,
    ignoreHTTPSErrors: true, // staging rehearsals use a self-signed certificate
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
