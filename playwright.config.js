import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/ui',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4377', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node test/playground/run.js --no-open --frozen --port 4377', url: 'http://127.0.0.1:4377/api/state', reuseExistingServer: false },
    { command: 'node test/playground/run.js --no-open --empty --port 4378', url: 'http://127.0.0.1:4378/api/state', reuseExistingServer: false }
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
