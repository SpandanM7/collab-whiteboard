import { defineConfig, devices } from '@playwright/test';

// Own port, so a dev server you already have running on 5173 is never reused or disturbed.
const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  // The layout and drawing tests work offline, so only the client is needed.
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'phone', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
    { name: 'phone-landscape', use: { ...devices['Pixel 7 landscape'], browserName: 'chromium' } },
    { name: 'tablet', use: { ...devices['iPad Mini'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
